import { ISender }              from "../facebook/types/ISender";
import {
  FBMessageEvent,
  FBPostbackEvent,
} from "../facebook/types/events";
import { Context }              from "./Context";
import {
  ContextUser,
  ContextThread,
  ContextMessage,
  ContextAttachment,
} from "./types";
import type { IUserService }    from "../users/types/IUserService";
import { LoggerManager }        from "../logger/LoggerManager";

const log = LoggerManager.getLogger("ContextBuilder");

/** Fallback user used when UserService is unavailable or throws. */
const FALLBACK_USER = (id: string): ContextUser => ({
  id,
  role:         "user",
  messageCount: 0,
  lastSeen:     new Date(),
  createdAt:    new Date(),
  preferences:  {},
  isNew:        false,
});

export class ContextBuilder {
  private readonly sender:  ISender;
  private userService?:     IUserService;
  private ownerIds:         Set<string> = new Set();
  private adminStore?:      { has(id: string): boolean };

  constructor(sender: ISender, userService?: IUserService) {
    this.sender      = sender;
    this.userService = userService;
  }

  /** Inject (or replace) the UserService after construction. */
  setUserService(svc: IUserService): void {
    this.userService = svc;
  }

  /** Set the owner IDs — these users always get role "owner" regardless of DB. */
  setOwnerIds(ids: string[]): void {
    this.ownerIds = new Set(ids);
    log.info(`ContextBuilder: ownerIds set — ${ids.length} owner(s).`);
  }

  /**
   * Set the AdminStore reference.
   * Users in this store always get at least role "admin" in every Context,
   * regardless of what the DB returns — mirroring the owner override pattern.
   * This is the critical fix: ctx.hasRole("admin") now reflects the live
   * AdminStore, not just the potentially-stale MongoDB role.
   */
  setAdminStore(store: { has(id: string): boolean }): void {
    this.adminStore = store;
    log.debug("ContextBuilder: adminStore attached.");
  }

  /**
   * Builds a Context asynchronously.
   *
   * thread.id  = event.senderId  (threadID in FCA — correct reply routing)
   * user lookup = event.senderFbId ?? event.senderId
   *   In group chats (FCA), senderFbId is the real Facebook user ID while
   *   senderId carries the threadID for routing. In DMs they are the same.
   *
   * On any error the builder falls back to a minimal user object so the
   * message is never silently dropped.
   */
  async build(event: FBMessageEvent | FBPostbackEvent): Promise<Context> {

    const buildStart = Date.now();

    const thread:  ContextThread  = { id: event.senderId, pageId: event.pageId };
    const message: ContextMessage = this.buildMessage(event);

    const userLookupId = event.senderFbId ?? event.senderId;

    log.debug("Building context.", {
      threadId:    event.senderId,
      userLookupId,
      eventType:   event.type,
      hasUserService: Boolean(this.userService),
    });

    // ── User resolution ───────────────────────────────────────────────────
    let user:   ContextUser = FALLBACK_USER(userLookupId);
    let source: "db" | "cache" | "fallback" = "fallback";

    if (this.userService) {
      try {
        log.debug("UserService.findOrCreate — start.", { fbId: userLookupId });
        const t0     = Date.now();
        const record = await this.userService.findOrCreate(userLookupId);
        const lookupMs = Date.now() - t0;

        user = {
          id:           record.fbId,
          name:         record.name,
          role:         record.role,
          messageCount: record.messageCount,
          lastSeen:     record.lastSeenAt,
          createdAt:    record.createdAt,
          preferences:  record.preferences,
          isNew:        record.isNew,
        };
        source = "db";

        log.debug("UserService.findOrCreate — done.", {
          fbId:         userLookupId,
          role:         user.role,
          isNew:        user.isNew,
          messageCount: user.messageCount,
          lookupMs,
        });
      } catch (err) {
        source = "fallback";
        log.warn("UserService lookup failed — using fallback user.", {
          fbId:  userLookupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      log.debug("No UserService injected — using fallback user.", {
        fbId: userLookupId,
      });
    }

    // ── Owner override ────────────────────────────────────────────────────
    // If the user's ID is in ownerIds, force role to "owner" regardless of DB.
    // NOTE: no guard on current role — owners must always win, even over DB "admin".
    if (this.ownerIds.has(userLookupId)) {
      log.debug(`ContextBuilder: user ${userLookupId} is in ownerIds — elevating role to owner.`);
      user = { ...user, role: "owner" };
    }

    // ── Admin store override ──────────────────────────────────────────────
    // If the user is in the live AdminStore and not already "owner",
    // elevate the role to "admin". This is the single fix that makes
    // ctx.hasRole("admin") work for all dynamically-added bot admins,
    // even when MongoDB is unavailable or the cached DB role is stale.
    if (
      this.adminStore?.has(userLookupId) &&
      user.role !== "owner" &&
      user.role !== "admin"
    ) {
      log.debug(
        `ContextBuilder: user ${userLookupId} is in AdminStore — elevating role to admin.`
      );
      user = { ...user, role: "admin" };
    }

    const totalMs = Date.now() - buildStart;
    log.debug("Context ready.", {
      threadId: event.senderId,
      userId:   user.id,
      role:     user.role,
      source,
      totalMs,
    });

    return new Context(user, thread, message, this.sender);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private buildMessage(
    event: FBMessageEvent | FBPostbackEvent
  ): ContextMessage {
    if (event.type === "postback") {
      return {
        id:              `postback-${event.timestamp}`,
        text:            event.payload,
        attachments:     [],
        timestamp:       event.timestamp,
        isPostback:      true,
        postbackPayload: event.payload,
      };
    }

    const attachments: ContextAttachment[] = event.attachments.map((att) => ({
      type:        att.type,
      url:         att.url,
      coordinates: att.coordinates,
    }));

    return {
      id:          event.messageId,
      text:        event.text,
      attachments,
      timestamp:   event.timestamp,
      isPostback:  false,
    };
  }
}
