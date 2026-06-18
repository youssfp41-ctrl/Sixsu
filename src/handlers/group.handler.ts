import { ISender }            from "../facebook/types/ISender";
import { FBMemberJoinedEvent,
         FBMemberLeftEvent,
         FBNameChangedEvent,
         FBNicknameChangedEvent } from "../facebook/types/events";
import { config }             from "../config/env";
import {
  getProtectionStore,
  recordNameEvent,
  recordRevert,
  recordProtectionEnabled,
} from "../protection/ProtectionRegistry";
import { LoggerManager }      from "../logger/LoggerManager";

const log = LoggerManager.getLogger("GroupHandler");

// ── FCA API interface (subset needed for protection) ───────────────────────

interface IFcaProtectionApi {
  getCurrentUserID(): string;
  setTitle(
    newTitle:  string,
    threadID:  string,
    callback:  (err: Error | null) => void,
  ): void;
  sendMessage(
    msg:      string | { body: string },
    threadID: string,
    callback?: (err: Error | null, info: unknown) => void,
  ): void;
  changeNickname(
    nickname:      string,
    threadID:      string,
    participantID: string,
    callback?:     (err: Error | null) => void,
  ): void;
}

// ── Singleton references (primary account defaults) ────────────────────────

let _sender:    ISender | undefined;
let _botUserId: string  = "";
let _apiGetter: (() => IFcaProtectionApi | null) | null = null;

export function setGroupSender(s: ISender):                          void { _sender    = s; }
export function setGroupBotUserId(id: string):                       void { _botUserId = id; }
export function setGroupApiGetter(g: () => IFcaProtectionApi | null): void { _apiGetter = g; }

// ── Helpers ────────────────────────────────────────────────────────────────

/** Returns the account-specific sender if provided, otherwise the global primary sender. */
function resolveSender(senderOverride?: ISender): ISender {
  const s = senderOverride ?? _sender;
  if (!s) throw new Error("GroupHandler: sender not wired.");
  return s;
}

function getFcaApi(): IFcaProtectionApi | null {
  return _apiGetter?.() ?? null;
}

async function notifyAdminBotAdded(
  sender:   ISender,
  threadId: string,
): Promise<void> {
  const adminIds = config.bot.adminIds;

  if (adminIds.length === 0) {
    log.warn(
      "GroupHandler: bot added to group but BOT_ADMIN_IDS is empty — no notification sent.",
      { threadId },
    );
    return;
  }

  const msg =
    `✅ تم إضافة البوت إلى مجموعة جديدة!\n` +
    `📌 معرّف المجموعة: ${threadId}\n` +
    `🤖 البوت يعمل بشكل صحيح ✔️`;

  for (const adminId of adminIds) {
    try {
      await sender.sendText(adminId, msg);
      log.info("GroupHandler: admin notified of bot group add.", { adminId, threadId });
    } catch (err) {
      log.error("GroupHandler: failed to notify admin.", {
        adminId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Public handlers ────────────────────────────────────────────────────────

export async function handleMemberJoined(
  event:          FBMemberJoinedEvent,
  senderOverride?: ISender,
): Promise<void> {
  if (event.members.length === 0) {
    log.debug("member_joined event with empty members list — skipping.", {
      senderId: event.senderId,
    });
    return;
  }

  log.info("Member(s) joined group.", {
    threadId:      event.senderId,
    addedByUserId: event.addedByUserId,
    members:       event.members,
  });

  const sender = resolveSender(senderOverride);

  const botWasAdded = !!_botUserId && event.members.includes(_botUserId);

  if (botWasAdded) {
    log.info("GroupHandler: bot was added to a new group!", {
      threadId: event.senderId,
      adminIds: config.bot.adminIds,
    });
    await notifyAdminBotAdded(sender, event.senderId);
  }

  // Welcome messages disabled — sending to every join causes high spam rate
  // and risks account suspension. Logs above are kept for diagnostics.
}

export async function handleMemberLeft(
  event:          FBMemberLeftEvent,
  _senderOverride?: ISender,
): Promise<void> {
  if (event.members.length === 0) {
    log.debug("member_left event with empty members list — skipping.", {
      senderId: event.senderId,
    });
    return;
  }

  log.info("Member(s) left/removed from group.", {
    threadId: event.senderId,
    members:  event.members,
  });

  // Leave messages disabled — sending on every leave/removal causes high spam
  // rate and risks account suspension. Logs above are kept for diagnostics.
}

// ── Protection handlers ────────────────────────────────────────────────────

/**
 * Handles the FCA name-changed event.
 *
 * @param apiGetterOverride  Per-account API getter injected by bootFcaAccount.
 *   When provided, protection actions (setTitle) are executed through the
 *   account that actually received the event, not the global primary account.
 *   Falls back to the global _apiGetter when omitted (e.g. webhook route).
 *
 * Lifecycle logs emitted (searchable markers):
 *   [name-event-received]   — event arrived at handler
 *   [name-protection-skip]  — protection off, bot-initiated, or same name
 *   [name-api-unavailable]  — protection active but FCA API is null (mid-reconnect)
 *   [name-revert-start]     — about to call setTitle
 *   [name-revert-success]   — setTitle succeeded
 *   [name-revert-fail]      — setTitle failed (FB error)
 */
export async function handleNameChanged(
  event: FBNameChangedEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiGetterOverride?: () => any,
): Promise<void> {
  const store = getProtectionStore();
  const state = store.threads[event.threadId];

  // ── Log every name_changed event unconditionally ──────────────────────────
  recordNameEvent(event.threadId);
  log.info("GroupHandler: name_changed event received. [name-event-received]", {
    threadId:       event.threadId,
    newName:        event.newName,
    changedBy:      event.changedBy,
    protectionOn:   state?.protectName ?? false,
    lockedName:     state?.lockedName  ?? "(none)",
    timestamp:      new Date().toISOString(),
  });

  if (!state?.protectName || !state.lockedName) {
    log.info("GroupHandler: name protection inactive — ignoring change. [name-protection-skip]", {
      threadId:     event.threadId,
      protectName:  state?.protectName ?? false,
      lockedName:   state?.lockedName  ?? "(none)",
    });
    return;
  }

  if (event.newName === state.lockedName) {
    log.info("GroupHandler: new name equals locked name — no revert needed. [name-protection-skip]", {
      threadId:   event.threadId,
      lockedName: state.lockedName,
    });
    return;
  }

  // Use the per-account getter when provided (secondary account protection fix),
  // otherwise fall back to the global primary account getter.
  const api = (apiGetterOverride ? apiGetterOverride() : getFcaApi()) as IFcaProtectionApi | null;
  if (!api) {
    log.warn(
      "GroupHandler: name_changed — protection active but FCA API unavailable (mid-reconnect?). [name-api-unavailable]",
      {
        threadId:   event.threadId,
        newName:    event.newName,
        lockedName: state.lockedName,
        changedBy:  event.changedBy,
      },
    );
    return;
  }

  const botId = api.getCurrentUserID();

  // ── Bot-initiated change — skip revert to avoid loop ──────────────────
  // Uses event.changedBy (like angel-bot) — reliable, no in-memory flags,
  // survives restarts, no race conditions.
  if (String(event.changedBy) === String(botId)) {
    log.info("GroupHandler: name_changed was bot-initiated — skipping revert. [name-protection-skip]", {
      threadId:  event.threadId,
      newName:   event.newName,
      lockedName: state.lockedName,
    });
    return;
  }

  // ── External change while protection is active — revert ───────────────
  log.warn(
    "GroupHandler: external name change detected — reverting. [name-revert-start]",
    {
      threadId:   event.threadId,
      unwanted:   event.newName,
      lockedName: state.lockedName,
      changedBy:  event.changedBy,
      timestamp:  new Date().toISOString(),
    },
  );

  // 1s delay before reverting (angel-bot pattern — avoids FB API rate issues)
  await new Promise<void>((r) => setTimeout(r, 1000));

  const lockedName = state.lockedName; // capture before async gap
  await new Promise<void>((resolve) => {
    api.setTitle(lockedName, event.threadId, (err) => {
      if (err) {
        log.warn("GroupHandler: name revert FAILED. [name-revert-fail]", {
          threadId:  event.threadId,
          lockedName,
          error:     err.message,
          timestamp: new Date().toISOString(),
        });
      } else {
        recordRevert(event.threadId);
        log.info("GroupHandler: name reverted successfully. [name-revert-success]", {
          threadId:   event.threadId,
          lockedName,
          timestamp:  new Date().toISOString(),
        });
      }
      resolve();
    });
  });
}

export async function handleNicknameChanged(
  event: FBNicknameChangedEvent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiGetterOverride?: () => any,
): Promise<void> {
  const store = getProtectionStore();

  // Use the per-account getter when provided (secondary account protection fix),
  // otherwise fall back to the global primary account getter.
  const api = (apiGetterOverride ? apiGetterOverride() : getFcaApi()) as IFcaProtectionApi | null;

  if (!api) {
    log.warn("GroupHandler: nickname_changed — FCA API unavailable (mid-reconnect?). [name-api-unavailable]", {
      threadId:      event.threadId,
      participantId: event.participantId,
    });
    return;
  }

  const botId = api.getCurrentUserID();

  // ── Bot nickname protection ──────────────────────────────────────────────
  if (event.participantId === botId) {
    const protectedNick = store.botNicknames[event.threadId];
    if (!protectedNick) return;
    if (event.newNickname === protectedNick) return;

    // Skip if bot made the change itself
    if (String(event.changedBy) === String(botId)) return;

    log.warn("GroupHandler: bot nickname changed — restoring protected nick. [name-revert-start]", {
      threadId:      event.threadId,
      unwanted:      event.newNickname || "(cleared)",
      protectedNick,
      changedBy:     event.changedBy,
      timestamp:     new Date().toISOString(),
    });

    await new Promise<void>((r) => setTimeout(r, 1000));

    await new Promise<void>((resolve) => {
      api.changeNickname(protectedNick, event.threadId, botId, (err) => {
        if (err) {
          log.warn("GroupHandler: bot nickname restore FAILED. [name-revert-fail]", {
            threadId: event.threadId,
            error:    err.message,
          });
        } else {
          log.info("GroupHandler: bot nickname restored. [name-revert-success]", {
            threadId:      event.threadId,
            protectedNick,
            timestamp:     new Date().toISOString(),
          });
        }
        resolve();
      });
    });
    return;
  }

  // ── Member nickname protection ───────────────────────────────────────────
  const state = store.threads[event.threadId];
  if (!state?.protectNicknames) return;

  const expected = state.nicknames[event.participantId];
  if (!expected) return;
  if (event.newNickname === expected) return;

  // Skip if bot made the nickname change itself
  if (String(event.changedBy) === String(botId)) return;

  log.info("GroupHandler: member nickname changed — restoring. [name-revert-start]", {
    threadId:    event.threadId,
    uid:         event.participantId,
    unwanted:    event.newNickname || "(cleared)",
    expected,
    changedBy:   event.changedBy,
    timestamp:   new Date().toISOString(),
  });

  await new Promise<void>((r) => setTimeout(r, 1000));

  await new Promise<void>((resolve) => {
    api.changeNickname(expected, event.threadId, event.participantId, (err) => {
      if (err) {
        log.warn("GroupHandler: member nickname restore FAILED. [name-revert-fail]", {
          threadId: event.threadId,
          uid:      event.participantId,
          error:    err.message,
        });
      } else {
        log.info("GroupHandler: member nickname restored. [name-revert-success]", {
          threadId: event.threadId,
          uid:      event.participantId,
          expected,
          timestamp: new Date().toISOString(),
        });
      }
      resolve();
    });
  });
}

// ── Protection lifecycle helpers (called by ManagementPlugin) ──────────────

/** Log that protection was enabled for a thread — records timestamp in meta. */
export function logProtectionEnabled(
  threadId:   string,
  lockedName: string,
  by:         string,
): void {
  recordProtectionEnabled(threadId);
  log.info("GroupHandler: name protection ENABLED. [protection-active]", {
    threadId,
    lockedName,
    by,
    timestamp: new Date().toISOString(),
  });
}

/** Log that protection was disabled for a thread. */
export function logProtectionDisabled(threadId: string, by: string): void {
  log.info("GroupHandler: name protection DISABLED. [protection-inactive]", {
    threadId,
    by,
    timestamp: new Date().toISOString(),
  });
}
