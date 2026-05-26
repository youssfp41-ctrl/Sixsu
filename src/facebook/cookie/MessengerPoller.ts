import { ISystem }           from "../../core/interfaces/ISystem";
import { LoggerManager }    from "../../logger/LoggerManager";
import { CookieHttpClient } from "./CookieHttpClient";
import { MessagingEntry }   from "../../types";

const log = LoggerManager.getLogger("MessengerPoller");

// ─── fca-unofficial types (no @types package exists) ─────────────────────────
/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fcaLogin = require("fca-unofficial") as (
  options: { appState: unknown[] },
  callback: (err: Error | null, api: FcaApi | null) => void,
) => void;

interface FcaApi {
  listen(
    callback: (err: Error | null, event: FcaEvent | null) => void,
  ): () => void;
  stopListening(): void;
  logout(callback?: (err?: Error) => void): void;
  getCurrentUserID(): string;
}

interface FcaEvent {
  type:         string;       // "message", "message_reply", "typ", "read", etc.
  senderID:     string;
  threadID:     string;
  messageID:    string;
  body?:        string;
  attachments?: FcaAttachment[];
  timestamp:    string;       // Unix ms as string
  isGroup:      boolean;
}

interface FcaAttachment {
  type:         string;       // "photo", "video", "audio", "file", "sticker"
  url?:         string;
  previewUrl?:  string;
}

export type PollerMessageHandler = (entries: MessagingEntry[]) => void;

/**
 * Listens for new Messenger messages in real-time using fca-unofficial.
 *
 * fca-unofficial connects to Facebook's MQTT/WebSocket broker (the same
 * channel the Messenger web app uses), which is far more reliable than
 * REST polling.  It requires only the AppState cookie array — no Page
 * Access Token or Developer app needed.
 *
 * Lifecycle:
 *   initialize() → login to Facebook via fca-unofficial, start listening
 *   destroy()    → stop listening + logout
 */
export class MessengerPoller implements ISystem {
  readonly name = "messenger-poller";

  private readonly client:  CookieHttpClient;
  private readonly userId:  string;
  private handler:          PollerMessageHandler | null = null;
  private api:              FcaApi | null = null;
  private stopFn:           (() => void) | null = null;
  private running           = false;

  constructor(client: CookieHttpClient) {
    this.client = client;
    this.userId = client.getUserId();
  }

  setHandler(handler: PollerMessageHandler): void {
    this.handler = handler;
  }

  async initialize(): Promise<void> {
    this.running = true;
    log.info("MessengerPoller initializing via fca-unofficial…", {
      userId: this.userId,
    });

    return new Promise<void>((resolve, reject) => {
      const appState = this.client.getRawAppState() as unknown[];

      fcaLogin({ appState }, (err, api) => {
        if (err) {
          log.warn("fca-unofficial login failed.", {
            error: err.message,
          });
          // Resolve (don't reject) — bot still works for sending,
          // just won't receive messages via this listener.
          resolve();
          return;
        }

        if (!api) {
          log.warn("fca-unofficial returned null API — skipping listener.");
          resolve();
          return;
        }

        this.api = api;

        log.info("fca-unofficial logged in, starting listener.", {
          userId: api.getCurrentUserID(),
        });

        this.stopFn = api.listen((listenErr, event) => {
          if (listenErr) {
            log.warn("fca-unofficial listen error.", { error: listenErr.message });
            return;
          }
          if (!event) return;
          if (!this.running) return;

          this.handleEvent(event);
        });

        resolve();
      });
    });
  }

  async destroy(): Promise<void> {
    this.running = false;

    if (this.stopFn) {
      try { this.stopFn(); } catch { /* ignore */ }
      this.stopFn = null;
    }

    if (this.api) {
      try { this.api.logout(); } catch { /* ignore */ }
      this.api = null;
    }

    log.info("MessengerPoller stopped.");
  }

  // ─── Event handling ───────────────────────────────────────────────────────

  private handleEvent(event: FcaEvent): void {
    // Only handle incoming messages (not typing, read receipts, etc.)
    if (event.type !== "message" && event.type !== "message_reply") return;

    // Ignore messages sent by the bot itself
    if (event.senderID === this.userId) return;

    // Must have text or attachments
    if (!event.body && !event.attachments?.length) return;

    const ts = parseInt(event.timestamp, 10);

    const attachments: Array<{ type: "image" | "video" | "audio" | "file"; payload: { url?: string } }> =
      (event.attachments ?? [])
        .map(a => ({
          type:    this.guessType(a.type),
          payload: { url: a.url ?? a.previewUrl },
        }));

    const entry: MessagingEntry = {
      sender:    { id: event.senderID },
      recipient: { id: this.userId },
      timestamp: ts,
      message: {
        mid:         event.messageID,
        text:        event.body,
        attachments: attachments as MessagingEntry["message"] extends infer T
          ? T extends { attachments?: infer A } ? A : never
          : never,
      },
    };

    log.info("New message received via fca-unofficial.", {
      from:      event.senderID,
      thread:    event.threadID,
      isGroup:   event.isGroup,
      text:      (event.body ?? "").slice(0, 100),
      attachments: attachments.length,
    });

    if (this.handler) {
      this.handler([entry]);
    }
  }

  private guessType(fcaType: string): "image" | "video" | "audio" | "file" {
    switch (fcaType) {
      case "photo":   return "image";
      case "video":   return "video";
      case "audio":   return "audio";
      default:        return "file";
    }
  }
}
