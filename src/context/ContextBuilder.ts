import { ISender }              from "../facebook/types/ISender";
import {
  FBEvent,
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
  private readonly sender: ISender;
  private userService?: IUserService;

  constructor(sender: ISender, userService?: IUserService) {
    this.sender      = sender;
    this.userService = userService;
  }

  /** Inject (or replace) the UserService after construction. */
  setUserService(svc: IUserService): void {
    this.userService = svc;
  }

  /**
   * Builds a Context asynchronously.
   *
   * When UserService is available the user record is fetched/created from the
   * database (or served from cache) so ctx.user is fully populated with:
   *   - role, messageCount, lastSeen, createdAt, preferences, isNew
   *
   * On any error the builder falls back to a minimal user object so the
   * message is never silently dropped.
   */
  async build(event: FBEvent): Promise<Context> {
    if (event.type === "unknown") {
      throw new Error("Cannot build context for unknown event type.");
    }

    const thread:  ContextThread  = { id: event.senderId, pageId: event.pageId };
    const message: ContextMessage = this.buildMessage(event);

    let user: ContextUser = FALLBACK_USER(event.senderId);

    if (this.userService) {
      try {
        const record = await this.userService.findOrCreate(event.senderId);
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
      } catch (err) {
        log.warn("ContextBuilder: UserService lookup failed — using fallback user.", {
          fbId:  event.senderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
