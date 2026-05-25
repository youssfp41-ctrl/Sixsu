import { ISystem }               from "../../core/interfaces/ISystem";
import { LoggerManager }         from "../../logger/LoggerManager";
import { CookieHttpClient }      from "./CookieHttpClient";
import { MessagingEntry }        from "../../types";

const log = LoggerManager.getLogger("MessengerPoller");

export type PollerMessageHandler = (entries: MessagingEntry[]) => void;

interface PullThread {
  thread_key:    { thread_fbid?: string; other_user_id?: string };
  last_activity_timestamp_ms: string;
  messages?:     PullMessage[];
}

interface PullMessage {
  message_id:    string;
  body?:         string;
  author:        string;
  timestamp_ms:  string;
  attachments?:  Array<{ blob_attachment?: { attachment_fbid: string; filename?: string; mime_type?: string; attachment_source_url?: string } }>;
}

/**
 * Polls Facebook Messenger for new messages using internal GraphQL API.
 * Works entirely via AppState cookies — no Page Access Token needed.
 *
 * Strategy:
 *  1. Every POLL_INTERVAL_MS fetch the inbox threads via LSPlatformGraphQLLightspeedRequestForIG.
 *  2. Track the last-seen message timestamp per thread.
 *  3. Emit only messages newer than the last-seen timestamp.
 *  4. Never emit the bot's own messages (filter by userId).
 */
export class MessengerPoller implements ISystem {
  readonly name = "messenger-poller";

  private static readonly POLL_INTERVAL_MS = 2_000;
  private static readonly DOC_INBOX        = "6560999540641937";

  private readonly client:    CookieHttpClient;
  private readonly userId:    string;
  private handler:            PollerMessageHandler | null = null;
  private timer:              ReturnType<typeof setTimeout> | null = null;
  private lastSeenMs:         Map<string, number> = new Map();
  private running             = false;
  private startedAt:          number = 0;

  constructor(client: CookieHttpClient) {
    this.client = client;
    this.userId = client.getUserId();
  }

  setHandler(handler: PollerMessageHandler): void {
    this.handler = handler;
  }

  async initialize(): Promise<void> {
    this.startedAt = Date.now();
    this.running   = true;
    log.info("MessengerPoller started.", { userId: this.userId, intervalMs: MessengerPoller.POLL_INTERVAL_MS });
    this.schedulePoll();
  }

  async destroy(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    log.info("MessengerPoller stopped.");
  }

  private schedulePoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.poll(), MessengerPoller.POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      await this.fetchAndEmit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Poll cycle failed.", { error: msg });
    } finally {
      this.schedulePoll();
    }
  }

  private async fetchAndEmit(): Promise<void> {
    const raw = await this.client.graphql({
      doc_id:    MessengerPoller.DOC_INBOX,
      variables: JSON.stringify({
        deviceId:          "web",
        requestId:         0,
        requestPayload:    JSON.stringify({
          database:  1,
          version:   9477666248971112,
          sync_params: JSON.stringify({ scale: 1 }),
        }),
        requestType: 1,
      }),
    }) as Record<string, unknown>;

    const threads = this.extractThreads(raw);
    if (!threads.length) return;

    const entries: MessagingEntry[] = [];

    for (const thread of threads) {
      const threadId = thread.thread_key.thread_fbid ?? thread.thread_key.other_user_id;
      if (!threadId) continue;

      const messages = thread.messages ?? [];
      const lastSeen = this.lastSeenMs.get(threadId) ?? this.startedAt;
      let   maxTs    = lastSeen;

      for (const msg of messages) {
        const ts  = parseInt(msg.timestamp_ms, 10);
        if (isNaN(ts) || ts <= lastSeen)  continue;
        if (msg.author === this.userId)   continue;   // ignore own messages
        if (!msg.body && !msg.attachments?.length) continue;

        maxTs = Math.max(maxTs, ts);

        const attachments = (msg.attachments ?? [])
          .filter(a => a.blob_attachment)
          .map(a => ({
            type:    this.guessType(a.blob_attachment?.mime_type),
            payload: { url: a.blob_attachment?.attachment_source_url ?? "" },
          }));

        const entry: MessagingEntry = {
          sender:    { id: msg.author },
          recipient: { id: this.userId },
          timestamp: ts,
          message: {
            mid:         msg.message_id,
            text:        msg.body,
            attachments: attachments as MessagingEntry["message"] extends infer T
              ? T extends { attachments?: infer A } ? A : never
              : never,
          },
        };

        entries.push(entry);
        log.debug("New message found.", {
          threadId,
          from:   msg.author,
          text:   (msg.body ?? "").slice(0, 80),
        });
      }

      if (maxTs > lastSeen) this.lastSeenMs.set(threadId, maxTs);
    }

    if (entries.length && this.handler) {
      this.handler(entries);
    }
  }

  private extractThreads(raw: Record<string, unknown>): PullThread[] {
    try {
      const data = raw?.["data"] as Record<string, unknown> | undefined;
      const viewer = data?.["viewer"] as Record<string, unknown> | undefined;
      const inbox  = viewer?.["message_threads"] as Record<string, unknown> | undefined;
      const nodes  = (inbox?.["nodes"] as PullThread[]) ?? [];
      return nodes;
    } catch {
      return [];
    }
  }

  private guessType(mime?: string): "image" | "video" | "audio" | "file" {
    if (!mime) return "file";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
  }
}
