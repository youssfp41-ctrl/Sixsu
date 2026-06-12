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

/**
 * @param event           Member-joined event from any account's MQTT stream.
 * @param senderOverride  Account-specific sender. When omitted, falls back to the global
 *                        primary sender. Always pass the per-account sender from
 *                        bootFcaAccount() so the reply is sent through the correct account.
 */
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

/**
 * @param event           Member-left event from any account's MQTT stream.
 * @param senderOverride  Account-specific sender. When omitted, falls back to the global
 *                        primary sender. Always pass the per-account sender from
 *                        bootFcaAccount() so the reply is sent through the correct account.
 */
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
 * Logic:
 *  1. If protection is off → ignore.
 *  2. If the new name already equals the locked name → no-op.
 *  3. If `lastChangedBy === 'bot'` → the change came from /اسم command.
 *     Consume the flag and skip revert to prevent bot-induced loops.
 *  4. Otherwise → external change while protection is on → revert.
 */
export async function handleNameChanged(event: FBNameChangedEvent): Promise<void> {
  const store = getProtectionStore();
  const state = store.threads[event.threadId];

  if (!state?.protectName || !state.lockedName) return;
  if (event.newName === state.lockedName) return;

  // ── Bot-initiated change — skip revert to avoid loop ──────────────────
  if (state.lastChangedBy === 'bot') {
    log.info("GroupHandler: name_changed was bot-initiated (/اسم) — skipping revert.", {
      threadId:  event.threadId,
      newName:   event.newName,
      lockedName: state.lockedName,
    });
    // Reset flag so subsequent external changes are handled normally
    state.lastChangedBy = 'external';
    return;
  }

  // ── External change while protection is active — revert ───────────────
  const api = getFcaApi();
  if (!api) {
    log.warn("GroupHandler: name_changed — protection active but FCA API unavailable.", {
      threadId: event.threadId,
    });
    return;
  }

  log.warn("GroupHandler: name_changed — external change detected, reverting to locked name.", {
    threadId:   event.threadId,
    unwanted:   event.newName,
    lockedName: state.lockedName,
    changedBy:  event.changedBy,
  });

  await new Promise<void>((resolve) => {
    api.setTitle(state.lockedName, event.threadId, (err) => {
      if (err) {
        log.warn("GroupHandler: name revert failed.", {
          threadId: event.threadId,
          error:    err.message,
        });
      } else {
        log.info("GroupHandler: name reverted successfully.", {
          threadId:   event.threadId,
          lockedName: state.lockedName,
        });
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

    log.warn("GroupHandler: bot nickname changed — restoring protected nick.", {
      threadId:      event.threadId,
      unwanted:      event.newNickname || "(cleared)",
      protectedNick,
      changedBy:     event.changedBy,
    });

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

  log.info("GroupHandler: member nickname changed — restoring.", {
    threadId:    event.threadId,
    uid:         event.participantId,
    unwanted:    event.newNickname || "(cleared)",
    expected,
    changedBy:   event.changedBy,
  });

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
