import { ISystem }          from "../../core/interfaces/ISystem";
import { LoggerManager }   from "../../logger/LoggerManager";
import { CookieHttpClient } from "./CookieHttpClient";
import { MessagingEntry }  from "../../types";

const log = LoggerManager.getLogger("MessengerPoller");

export type PollerMessageHandler = (entries: MessagingEntry[]) => void;

// ─── Mercury API response shapes ──────────────────────────────────────────────

interface MercuryThread {
  thread_id?:          string;
  thread_fbid?:        string | null;
  other_user_fbid?:    string | null;
  last_action_timestamp?: number;
  // inbox_campaigns etc. are ignored
}

interface MercuryMessage {
  action_type?: string;
  actor_fbid?:  string;
  body?:        string;
  message_id?:  string;
  timestamp?:   number;
  attachments?: Array<{
    attach_type?: string;
    url?:         string;
    preview_url?: string;
    mime_type?:   string;
  }>;
}

/**
 * Polls Facebook Messenger for new messages every POLL_INTERVAL_MS using
 * Facebook's Mercury AJAX API — no official webhook or Page token needed.
 *
 * Strategy:
 *  1. Every interval, fetch the inbox thread list via /ajax/mercury/thread_list.php
 *  2. For threads whose last_action_timestamp > last-seen, load their messages
 *  3. Emit only messages newer than startedAt and not sent by the bot itself
 *  4. Feed each new message into the main CommandPipeline via the registered handler
 */
export class MessengerPoller implements ISystem {
  readonly name = "messenger-poller";

  private static readonly POLL_INTERVAL_MS  = 3_000;
  private static readonly INBOX_LIMIT       = "20";
  private static readonly MSG_LIMIT         = "10";

  private readonly client:   CookieHttpClient;
  private readonly userId:   string;
  private handler:           PollerMessageHandler | null = null;
  private timer:             ReturnType<typeof setTimeout> | null = null;
  private lastSeenMs:        Map<string, number> = new Map();
  private running            = false;
  private startedAt:         number = 0;
  private pollCount          = 0;
  private probeLogged        = false;

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
    log.info("MessengerPoller started.", {
      userId:     this.userId,
      intervalMs: MessengerPoller.POLL_INTERVAL_MS,
    });
    this.schedulePoll();
  }

  async destroy(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    log.info("MessengerPoller stopped.");
  }

  // ─── Scheduling ───────────────────────────────────────────────────────────

  private schedulePoll(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.poll(), MessengerPoller.POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      this.pollCount++;
      await this.fetchAndEmit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Poll cycle failed.", { pollCount: this.pollCount, error: msg });
    } finally {
      this.schedulePoll();
    }
  }

  // ─── Core polling logic ───────────────────────────────────────────────────

  private async fetchAndEmit(): Promise<void> {
    // ── Step 1: get recent threads ──────────────────────────────────────────
    const inboxRaw = await this.client.apiPost("/ajax/mercury/thread_list.php", {
      "inbox[limit]":              MessengerPoller.INBOX_LIMIT,
      "inbox[offset]":             "0",
      "inbox[filter]":             "",
      "inbox[include_read_state]": "true",
    });

    // On the first ever poll, log what Facebook actually returns so we can
    // verify the response shape in Railway logs.
    if (!this.probeLogged) {
      this.probeLogged = true;
      const preview = JSON.stringify(inboxRaw).slice(0, 600);
      log.info("MessengerPoller — first poll raw response (probe):", { preview });
    }

    const threads = this.extractThreads(inboxRaw);

    if (threads.length === 0) {
      // Log every 20th poll if still no threads (helps detect auth issues)
      if (this.pollCount % 20 === 0) {
        log.info("MessengerPoller — no threads found.", {
          pollCount: this.pollCount,
          rawKeys:   Object.keys(
            (inboxRaw && typeof inboxRaw === "object" ? inboxRaw : {}) as object
          ).join(","),
        });
      }
      return;
    }

    const entries: MessagingEntry[] = [];

    for (const thread of threads) {
      const threadId = thread.thread_fbid
        ? String(thread.thread_fbid)
        : thread.other_user_fbid
          ? String(thread.other_user_fbid)
          : thread.thread_id
            ? String(thread.thread_id)
            : null;

      if (!threadId) continue;

      const lastSeen  = this.lastSeenMs.get(threadId) ?? this.startedAt;
      const threadTs  = thread.last_action_timestamp ?? 0;

      // Skip threads with no activity since we last checked
      if (threadTs <= lastSeen) continue;

      // ── Step 2: load messages for this thread ─────────────────────────────
      let msgRaw: unknown;
      try {
        msgRaw = await this.client.apiPost("/ajax/mercury/load_messages.php", {
          "thread_and_window_id": threadId,
          "offset":               "0",
          "limit":                MessengerPoller.MSG_LIMIT,
        });
      } catch (err) {
        log.warn("Failed to load messages for thread.", {
          threadId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Still update lastSeen so we don't retry the same thread immediately
        this.lastSeenMs.set(threadId, threadTs);
        continue;
      }

      const messages = this.extractMessages(msgRaw);
      let   maxTs    = lastSeen;

      for (const msg of messages) {
        const ts = msg.timestamp ?? 0;
        if (ts <= lastSeen)          continue;   // already processed
        if (msg.actor_fbid === this.userId) continue;   // own message
        if (!msg.body && !msg.attachments?.length) continue;   // empty

        // Only "user-generated-message" action type
        if (msg.action_type && msg.action_type !== "ma-type:user-generated-message") continue;

        maxTs = Math.max(maxTs, ts);

        const attachments: MessagingEntry["message"] extends infer T
          ? T extends { attachments?: infer A } ? NonNullable<A> : never
          : never = (msg.attachments ?? [])
          .filter(a => a.url || a.preview_url)
          .map(a => ({
            type:    this.guessType(a.mime_type ?? a.attach_type),
            payload: { url: a.url ?? a.preview_url ?? "" },
          }));

        const entry: MessagingEntry = {
          sender:    { id: msg.actor_fbid! },
          recipient: { id: this.userId },
          timestamp: ts,
          message: {
            mid:         msg.message_id ?? `msg-${ts}`,
            text:        msg.body,
            attachments: attachments as MessagingEntry["message"] extends infer T
              ? T extends { attachments?: infer A } ? A : never
              : never,
          },
        };

        entries.push(entry);
        log.info("New message received.", {
          threadId,
          from:     msg.actor_fbid,
          text:     (msg.body ?? "").slice(0, 100),
          hasAttachments: !!msg.attachments?.length,
        });
      }

      if (maxTs > lastSeen) {
        this.lastSeenMs.set(threadId, maxTs);
      } else {
        // Update to threadTs so we don't keep re-fetching this thread
        this.lastSeenMs.set(threadId, threadTs);
      }
    }

    if (entries.length > 0 && this.handler) {
      log.info("MessengerPoller dispatching entries.", { count: entries.length });
      this.handler(entries);
    }
  }

  // ─── Response parsers ─────────────────────────────────────────────────────

  private extractThreads(raw: unknown): MercuryThread[] {
    if (!raw || typeof raw !== "object") return [];
    const obj = raw as Record<string, unknown>;

    // Facebook Mercury format: { payload: { threads: [...] } }
    const payload = obj["payload"] as Record<string, unknown> | undefined;
    if (payload) {
      const threads = payload["threads"];
      if (Array.isArray(threads)) return threads as MercuryThread[];

      // Sometimes nested under viewer
      const viewer  = payload["viewer"] as Record<string, unknown> | undefined;
      const vThreads = viewer?.["message_threads"] as Record<string, unknown> | undefined;
      if (vThreads) {
        const nodes = vThreads["nodes"];
        if (Array.isArray(nodes)) return nodes as MercuryThread[];
      }
    }

    // Alternate format: { data: { viewer: { message_threads: { nodes: [...] } } } }
    const data   = obj["data"] as Record<string, unknown> | undefined;
    const viewer = data?.["viewer"] as Record<string, unknown> | undefined;
    const mt     = viewer?.["message_threads"] as Record<string, unknown> | undefined;
    if (mt) {
      const nodes = mt["nodes"];
      if (Array.isArray(nodes)) return nodes as MercuryThread[];
    }

    return [];
  }

  private extractMessages(raw: unknown): MercuryMessage[] {
    if (!raw || typeof raw !== "object") return [];
    const obj = raw as Record<string, unknown>;

    // Mercury format: { payload: { actions: [...] } }
    const payload = obj["payload"] as Record<string, unknown> | undefined;
    if (payload) {
      const actions = payload["actions"];
      if (Array.isArray(actions)) return actions as MercuryMessage[];

      const messages = payload["messages"];
      if (Array.isArray(messages)) return messages as MercuryMessage[];
    }

    return [];
  }

  private guessType(hint?: string): "image" | "video" | "audio" | "file" {
    if (!hint) return "file";
    const h = hint.toLowerCase();
    if (h.includes("photo") || h.includes("image") || h.startsWith("image/")) return "image";
    if (h.includes("video") || h.startsWith("video/"))                         return "video";
    if (h.includes("audio") || h.startsWith("audio/"))                         return "audio";
    return "file";
  }
}
