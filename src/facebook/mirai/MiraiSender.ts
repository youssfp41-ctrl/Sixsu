import { ISender }        from "../types/ISender";
import { MiraiTransport } from "./MiraiTransport";
import { LoggerManager }  from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("MiraiSender");

/**
 * MiraiSender — ISender implementation backed by fca-unofficial.
 *
 * All outbound messages are sent through the live FcaApi managed by
 * MiraiTransport.  Using the same session for both listening and sending
 * avoids the cookie-conflict issues that arise when two different auth
 * mechanisms share one Facebook account.
 */
export class MiraiSender implements ISender {
  private readonly transport: MiraiTransport;

  constructor(transport: MiraiTransport) {
    this.transport = transport;
  }

  /** Send a plain-text message to a Messenger thread. */
  async sendText(recipientId: string, text: string): Promise<void> {
    const api = this.transport.getApi();
    if (!api) {
      log.warn("MiraiSender.sendText: API not ready — message dropped.", {
        to: recipientId,
      });
      throw new Error("Facebook API not connected (MiraiTransport not logged in).");
    }

    log.debug("MiraiSender: sending text…", {
      to:      recipientId,
      chars:   text.length,
      preview: text.slice(0, 60),
    });

    return new Promise<void>((resolve, reject) => {
      api.sendMessage(text, recipientId, (err, info) => {
        if (err) {
          log.warn("MiraiSender: sendText failed.", {
            to:    recipientId,
            error: err.message,
          });
          reject(err);
          return;
        }

        // ── [DEBUG-5] Reply sent successfully ───────────────────────────
        log.info("MiraiSender: reply sent.", {
          to:        recipientId,
          messageID: info?.messageID,
          chars:     text.length,
        });

        resolve();
      });
    });
  }

  /**
   * Send a typing indicator (best-effort, never throws).
   *
   * Wrapped in a Promise so the caller awaits the HTTP request completion
   * before starting any delay — ensuring the '...' indicator is actually
   * visible on Facebook before the message arrives.
   *
   * Previously called without a callback (fire-and-forget), which caused
   * the typing indicator HTTP request and the message HTTP request to race
   * each other, sometimes arriving simultaneously on the client side.
   */
  async sendTyping(recipientId: string): Promise<void> {
    const api = this.transport.getApi();
    if (!api) return;

    log.debug("MiraiSender: sending typing indicator.", { to: recipientId });

    return new Promise<void>((resolve) => {
      try {
        api.sendTypingIndicator(recipientId, (err?: Error) => {
          if (err) {
            log.warn("MiraiSender.sendTyping: indicator failed.", {
              to:    recipientId,
              error: err.message,
            });
          }
          resolve();
        });
      } catch (e: unknown) {
        // sendTypingIndicator is best-effort — log and continue, never block.
        log.warn("MiraiSender.sendTyping: threw.", {
          to:    recipientId,
          error: e instanceof Error ? e.message : String(e),
        });
        resolve();
      }
    });
  }

  /** Add an emoji reaction to a message (best-effort, never throws). */
  async sendReaction(
    messageId:    string,
    _recipientId: string,
    emoji:        string,
  ): Promise<void> {
    const api = this.transport.getApi();
    if (!api) return;

    log.debug("MiraiSender: setting reaction.", { messageId, emoji });

    try {
      api.setMessageReaction(emoji, messageId, undefined, true);
    } catch {
      // Reactions are best-effort.
    }
  }
}
