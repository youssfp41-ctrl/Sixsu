import { MessagingEntry } from "../types";
import { MessengerService } from "../services/messenger.service";
import { Context } from "./Context";
import { ContextUser, ContextThread, ContextMessage, ContextAttachment } from "./types";

export class ContextBuilder {
  private readonly messenger: MessengerService;

  constructor(messenger: MessengerService) {
    this.messenger = messenger;
  }

  build(event: MessagingEntry): Context {
    const user: ContextUser = {
      id: event.sender.id,
    };

    const thread: ContextThread = {
      id: event.sender.id,
      pageId: event.recipient.id,
    };

    const message = this.buildMessage(event);

    return new Context(user, thread, message, this.messenger);
  }

  private buildMessage(event: MessagingEntry): ContextMessage {
    if (event.postback) {
      return {
        id: `postback-${event.timestamp}`,
        text: event.postback.payload,
        attachments: [],
        timestamp: event.timestamp,
        isPostback: true,
        postbackPayload: event.postback.payload,
      };
    }

    const raw = event.message!;
    const attachments: ContextAttachment[] = (raw.attachments ?? []).map(
      (att) => ({
        type: att.type,
        url: att.payload.url,
        coordinates: att.payload.coordinates,
      })
    );

    return {
      id: raw.mid,
      text: raw.text,
      attachments,
      timestamp: event.timestamp,
      isPostback: false,
    };
  }
}
