import { ISender }            from "../facebook/types/ISender";
import { FBMemberJoinedEvent,
         FBMemberLeftEvent,
         FBNameChangedEvent,
         FBNicknameChangedEvent } from "../facebook/types/events";
import { config }             from "../config/env";
import { getProtectionStore } from "../protection/ProtectionRegistry";
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

function buildJoinMessage(memberIds: string[], addedByUserId: string): string {
  if (memberIds.length === 1) {
    return (
      `🎉 مرحباً بالعضو الجديد!\n` +
      `👤 المعرف: ${memberIds[0]}\n` +
      `➕ تمت الإضافة بواسطة: ${addedByUserId}\n` +
      `أهلاً وسهلاً في المجموعة! 🌟`
    );
  }

  const list = memberIds.map((id) => `• ${id}`).join("\n");
  return (
    `🎉 مرحباً بالأعضاء الجدد!\n` +
    `${list}\n` +
    `➕ تمت الإضافة بواسطة: ${addedByUserId}\n` +
    `أهلاً وسهلاً بالجميع! 🌟`
  );
}

function buildLeaveMessage(memberIds: string[], removedBySelf: boolean): string {
  if (memberIds.length === 1) {
    return removedBySelf
      ? `👋 ${memberIds[0]} غادر المجموعة. نتمنى له التوفيق!`
      : `🚪 تم إزالة ${memberIds[0]} من المجموعة.`;
  }

  const list = memberIds.map((id) => `• ${id}`).join("\n");
  return removedBySelf
    ? `👋 غادر المجموعة عدة أعضاء:\n${list}`
    : `🚪 تم إزالة عدة أعضاء من المجموعة:\n${list}`;
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

    await sender.sendText(
      event.senderId,
      `مرحباً! أنا Sixsu 🤖\nتم إضافتي بنجاح إلى هذه المجموعة.\nاكتب /help لمعرفة الأوامر المتاحة.`,
    );

    await notifyAdminBotAdded(sender, event.senderId);
    return;
  }

  const text = buildJoinMessage(event.members, event.addedByUserId);
  await sender.sendText(event.senderId, text);
}

export async function handleMemberLeft(
  event:          FBMemberLeftEvent,
  senderOverride?: ISender,
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

  const sender        = resolveSender(senderOverride);
  const removedBySelf = event.members.length === 1 && event.members[0] === event.senderId;
  const text          = buildLeaveMessage(event.members, removedBySelf);

  await sender.sendText(event.senderId, text);
}

// ── Protection handlers ────────────────────────────────────────────────────

/**
 * Handles the FCA name-changed event.
 *
 * Strategy (angel-bot approach):
 *  1. If protection is off or no locked name → ignore.
 *  2. If new name already equals locked name → no-op.
 *  3. Check event.changedBy against api.getCurrentUserID().
 *     If bot itself made the change → skip revert (zero loop risk, survives restarts).
 *  4. Otherwise (external change) → wait 1s then revert + notify.
 */
export async function handleNameChanged(event: FBNameChangedEvent): Promise<void> {
  const store = getProtectionStore();
  const state = store.threads[event.threadId];

  if (!state?.protectName || !state.lockedName) return;
  if (event.newName === state.lockedName) return;

  const api = getFcaApi();
  if (!api) {
    log.warn("GroupHandler: name_changed — protection active but FCA API unavailable.", {
      threadId: event.threadId,
    });
    return;
  }

  const botId = api.getCurrentUserID();

  // ── Bot-initiated change — skip revert to avoid loop ──────────────────
  // Uses event.changedBy (like angel-bot) — reliable, no in-memory flags,
  // survives restarts, no race conditions.
  if (String(event.changedBy) === String(botId)) {
    log.info("GroupHandler: name_changed was bot-initiated — skipping revert.", {
      threadId:  event.threadId,
      newName:   event.newName,
      lockedName: state.lockedName,
    });
    return;
  }

  // ── External change while protection is active — revert ───────────────
  log.warn("GroupHandler: name_changed — external change detected, reverting.", {
    threadId:   event.threadId,
    unwanted:   event.newName,
    lockedName: state.lockedName,
    changedBy:  event.changedBy,
  });

  // 1s delay before reverting (angel-bot pattern — avoids FB API rate issues)
  await new Promise<void>((r) => setTimeout(r, 1000));

  const lockedName = state.lockedName; // capture before async gap
  await new Promise<void>((resolve) => {
    api.setTitle(lockedName, event.threadId, (err) => {
      if (err) {
        log.warn("GroupHandler: name revert failed.", {
          threadId: event.threadId,
          error:    err.message,
        });
      } else {
        log.info("GroupHandler: name reverted successfully.", {
          threadId:   event.threadId,
          lockedName,
        });
        // Notify the group (angel-bot style)
        try {
          api.sendMessage(
            `🛡 تم استعادة اسم القروب المحمي:\n"${lockedName}"`,
            event.threadId,
          );
        } catch { /* best-effort */ }
      }
      resolve();
    });
  });
}

export async function handleNicknameChanged(event: FBNicknameChangedEvent): Promise<void> {
  const store = getProtectionStore();
  const api   = getFcaApi();

  if (!api) {
    log.warn("GroupHandler: nickname_changed — FCA API unavailable.", {
      threadId: event.threadId,
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

    log.warn("GroupHandler: bot nickname changed — restoring protected nick.", {
      threadId:      event.threadId,
      unwanted:      event.newNickname || "(cleared)",
      protectedNick,
      changedBy:     event.changedBy,
    });

    await new Promise<void>((r) => setTimeout(r, 1000));

    await new Promise<void>((resolve) => {
      api.changeNickname(protectedNick, event.threadId, botId, (err) => {
        if (err) {
          log.warn("GroupHandler: bot nickname restore failed.", {
            threadId: event.threadId,
            error:    err.message,
          });
        } else {
          log.info("GroupHandler: bot nickname restored.", {
            threadId:      event.threadId,
            protectedNick,
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

  log.info("GroupHandler: member nickname changed — restoring.", {
    threadId:    event.threadId,
    uid:         event.participantId,
    unwanted:    event.newNickname || "(cleared)",
    expected,
    changedBy:   event.changedBy,
  });

  await new Promise<void>((r) => setTimeout(r, 1000));

  await new Promise<void>((resolve) => {
    api.changeNickname(expected, event.threadId, event.participantId, (err) => {
      if (err) {
        log.warn("GroupHandler: member nickname restore failed.", {
          threadId: event.threadId,
          uid:      event.participantId,
          error:    err.message,
        });
      } else {
        log.info("GroupHandler: member nickname restored.", {
          threadId: event.threadId,
          uid:      event.participantId,
          expected,
        });
      }
      resolve();
    });
  });
}