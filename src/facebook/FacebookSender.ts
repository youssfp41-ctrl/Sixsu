import { ISender } from "./types/ISender";
import { FacebookClient } from "./FacebookClient";

export class FacebookSender implements ISender {
  private readonly client: FacebookClient;

  constructor(client: FacebookClient) {
    this.client = client;
  }

  async sendText(recipientId: string, text: string): Promise<void> {
    await this.client.post("/me/messages", {
      recipient: { id: recipientId },
      message: { text },
    });
  }

  async sendTyping(recipientId: string): Promise<void> {
    await this.client.post("/me/messages", {
      recipient: { id: recipientId },
      sender_action: "typing_on",
    });
  }

  async sendReaction(
    messageId: string,
    recipientId: string,
    emoji: string
  ): Promise<void> {
    await this.client.post("/me/messages", {
      recipient: { id: recipientId },
      sender_action: "react",
      payload: {
        message_id: messageId,
        reaction: emoji,
      },
    });
  }
}
