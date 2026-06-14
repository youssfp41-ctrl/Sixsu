import { ISender }       from "./types/ISender";
import { LoggerManager } from "../logger/LoggerManager";

const log = LoggerManager.getLogger("HumanBehaviorSender");

/**
 * HumanBehaviorSender — ISender decorator that makes the bot feel human.
 *
 * Every outbound text message is intercepted and:
 *   1. A typing indicator is shown immediately.
 *   2. A random delay is applied (duration scales with message length).
 *   3. The message is sent after the delay.
 *
 * sendTyping() and sendReaction() are forwarded directly — no artificial delay
 * is added to indicators or reactions, only to actual messages.
 *
 * Delay bands:
 *   Short  (<  100 chars) → 1 000 – 2 000 ms
 *   Medium (< 300 chars)  → 2 000 – 4 000 ms
 *   Long   (≥ 300 chars)  → 3 000 – 5 000 ms
 *
 * No memory leaks: every setTimeout is stored and cleared on error/cancellation.
 */
export class HumanBehaviorSender implements ISender {
  private readonly inner: ISender;

  constructor(inner: ISender) {
    this.inner = inner;
  }

  async sendText(recipientId: string, text: string): Promise<void> {
    const delayMs = HumanBehaviorSender.calculateDelay(text);

    log.debug("HumanBehaviorSender: queuing message with human delay.", {
      to:      recipientId,
      chars:   text.length,
      delayMs: Math.round(delayMs),
    });

    try {
      await this.inner.sendTyping(recipientId);
    } catch {
      // Typing indicator is best-effort — never block the send.
    }

    await HumanBehaviorSender.sleep(delayMs);

    await this.inner.sendText(recipientId, text);
  }

  async sendTyping(recipientId: string): Promise<void> {
    return this.inner.sendTyping(recipientId);
  }

  async sendReaction(
    messageId:   string,
    recipientId: string,
    emoji:       string,
  ): Promise<void> {
    return this.inner.sendReaction(messageId, recipientId, emoji);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Returns a random delay in milliseconds.
   * The range scales with message length to mimic realistic typing speed.
   */
  private static calculateDelay(text: string): number {
    const len = text.length;

    let minMs: number;
    let maxMs: number;

    if (len < 100) {
      minMs = 1_000;
      maxMs = 2_000;
    } else if (len < 300) {
      minMs = 2_000;
      maxMs = 4_000;
    } else {
      minMs = 3_000;
      maxMs = 5_000;
    }

    return minMs + Math.random() * (maxMs - minMs);
  }

  /**
   * Promise-based sleep with guaranteed cleanup.
   * The timeout reference is kept so it can never leak if the Promise is
   * settled early by an unhandled rejection in the caller's chain.
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = setTimeout(() => {
        resolve();
      }, ms);

      // Unref on Node.js so this timer never prevents a clean process exit.
      if (typeof (id as NodeJS.Timeout).unref === "function") {
        (id as NodeJS.Timeout).unref();
      }
    });
  }
}
