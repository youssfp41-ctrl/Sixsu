import { MessagingEntry, Attachment } from "../../types";
import { FcaEvent, FcaMessageEvent, FcaGroupEvent, FcaAttachment } from "./FcaTypes";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("FcaEventAdapter");

export class FcaEventAdapter {
  private readonly botUserId: string;

  constructor(botUserId: string) {
    this.botUserId = botUserId;
    log.info("FcaEventAdapter: initialized.", { botUserId });
  }

  adapt(event: FcaEvent): MessagingEntry[] {
    log.info("FcaEventAdapter: adapt called.", { type: event.type });
    switch (event.type) {
      case "message":
      case "message_reply":
        return this.adaptMessage(event as FcaMessageEvent);

      case "event":
        return this.adaptGroupEvent(event as FcaGroupEvent);

      default:
        log.info("FcaEventAdapter: dropping non-actionable event.", {
          type: event.type,
        });
        return [];
    }
  }

  private adaptMessage(event: FcaMessageEvent): MessagingEntry[] {
    if (event.senderID === this.botUserId) {
      log.debug("FcaEventAdapter: dropping own message.");
      return [];
    }

    if (!event.body && !event.attachments?.length) {
      log.debug("FcaEventAdapter: dropping empty message.", { type: event.type });
      return [];
    }

    const ts = typeof event.timestamp === "string"
      ? parseInt(event.timestamp, 10)
      : event.timestamp;

    const attachments: Attachment[] = (event.attachments ?? []).map(
      (a) => this.adaptAttachment(a),
    );

    const entry: MessagingEntry = {
      sender:     { id: event.threadID },
      senderFbId: event.senderID,
      recipient:  { id: this.botUserId },
      timestamp:  ts,
      message: {
        mid:         event.messageID,
        text:        event.body || undefined,
        attachments,
      },
    };

    log.info("FcaEventAdapter: message adapted → entering pipeline.", {
      from:        event.senderID,
      thread:      event.threadID,
      isGroup:     event.isGroup,
      messageID:   event.messageID,
      text:        (event.body ?? "").slice(0, 120),
      attachments: attachments.length,
    });

    return [entry];
  }

  private adaptGroupEvent(event: FcaGroupEvent): MessagingEntry[] {
    const ts = typeof event.timestamp === "string"
      ? parseInt(event.timestamp, 10)
      : (event.timestamp as number);

    switch (event.logMessageType) {
      case "log:subscribe": {
        const added = (event.logMessageData.addedParticipants ?? [])
          .map((p) => ({ id: p.userFbId }));
        if (!added.length) return [];

        log.info("FcaEventAdapter: member(s) joined.", {
          threadID: event.threadID,
          added:    added.map((p) => p.id),
        });

        return [{
          sender:             { id: event.threadID },
          recipient:          { id: this.botUserId },
          timestamp:          ts,
          thread_action:      "added_participants",
          added_participants: added,
        }];
      }

      case "log:unsubscribe": {
        const leftId = event.logMessageData.leftParticipantFbId;
        if (!leftId) return [];

        log.info("FcaEventAdapter: member left.", {
          threadID: event.threadID,
          leftId,
        });

        return [{
          sender:               { id: event.threadID },
          recipient:            { id: this.botUserId },
          timestamp:            ts,
          thread_action:        "removed_participants",
          removed_participants: [{ id: leftId }],
        }];
      }

      case "log:thread-name": {
        const newName = event.logMessageData?.name;
        if (!newName) return [];

        log.info("FcaEventAdapter: group name changed.", {
          threadID: event.threadID,
          newName,
          changedBy: event.senderID,
        });

        return [{
          sender:      { id: event.threadID },
          senderFbId:  event.senderID,
          recipient:   { id: this.botUserId },
          timestamp:   ts,
          thread_action: "name_changed",
          name_change: { newName, changedBy: event.senderID },
        }];
      }

      case "log:user-nickname": {
        const participantId = event.logMessageData?.participant_id;
        if (!participantId) return [];
        const newNickname = event.logMessageData?.nickname ?? "";

        log.info("FcaEventAdapter: nickname changed.", {
          threadID:      event.threadID,
          participantId,
          newNickname:   newNickname || "(cleared)",
          changedBy:     event.senderID,
        });

        return [{
          sender:          { id: event.threadID },
          senderFbId:      event.senderID,
          recipient:       { id: this.botUserId },
          timestamp:       ts,
          thread_action:   "nickname_changed",
          nickname_change: { participantId, newNickname, changedBy: event.senderID },
        }];
      }

      default:
        log.debug("FcaEventAdapter: dropping group event.", {
          logMessageType: event.logMessageType,
        });
        return [];
    }
  }

  private adaptAttachment(att: FcaAttachment): Attachment {
    let type: Attachment["type"];

    switch (att.type) {
      case "photo":    type = "image";    break;
      case "video":    type = "video";    break;
      case "audio":    type = "audio";    break;
      case "sticker":  type = "image";    break;
      case "location": type = "location"; break;
      default:         type = "file";     break;
    }

    const payload: Attachment["payload"] = {
      url: att.url ?? att.previewUrl,
    };

    if (att.latitude != null && att.longitude != null) {
      payload.coordinates = { lat: att.latitude, long: att.longitude };
    }

    return { type, payload };
  }
}
