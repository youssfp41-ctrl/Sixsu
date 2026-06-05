import { ISystem }          from "../../core/interfaces/ISystem";
import { FcaApi, FcaCookie, FcaEvent } from "./FcaTypes";
import { LoggerManager }   from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("MiraiTransport");

/* eslint-disable @typescript-eslint/no-var-requires */
const fcaLogin = require("@dongdev/fca-unofficial") as (
  options:  { appState: FcaCookie[]; pageID?: string },
  callback: (err: Error | null, api: FcaApi | null) => void,
) => void;

export type FcaEventHandler = (event: FcaEvent) => void;

/** Facebook error codes that indicate an unrecoverable session problem. */
const FATAL_FB_ERRORS = new Set([
  1357004, // "Not logged in" — AppState expired or MQTT seq-id missing
  1357031, // Checkpoint / suspicious login
  1357045, // Account locked
]);

/** Error message fragments that indicate the AppState is permanently expired. */
const SESSION_EXPIRED_HINTS = [
  "fb_appstate expired",
  "appstate expired",
  "appstate die",
  "c_user/i_user cookie not found",
  "không tìm thấy cookie",   // fca-unofficial Vietnamese: "cookie not found"
] as const;

function isSessionExpiredError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return SESSION_EXPIRED_HINTS.some(hint => lower.includes(hint.toLowerCase()));
}

/**
 * MiraiTransport — Facebook transport layer for Sixsu.
 *
 * Uses fca-unofficial (proven in Fang / isoy-fca 1.3.10) as a Facebook
 * MQTT transport.
 *
 * Supports multiple raw event listeners via addRawEventListener —
 * plugins can subscribe to FCA events (e.g. log:thread-name, log:user-nickname)
 * without replacing the main event handler.
 */
export class MiraiTransport implements ISystem {
  readonly name = "mirai-transport";

  private readonly appState: FcaCookie[];
  private api:              FcaApi | null       = null;
  private stopListenFn:     (() => void) | null  = null;
  private eventHandler:     FcaEventHandler | null = null;
  /** Additional raw event listeners (e.g. from plugins). Called after the main handler. */
  private rawListeners:     FcaEventHandler[]    = [];
  private running           = false;
  private reconnectTimer:   ReturnType<typeof setTimeout> | null = null;
  private loginAttempts     = 0;
  private listenerStartMs   = 0;

  private static readonly MAX_LOGIN_ATTEMPTS  = 5;
  private static readonly STABLE_LISTEN_MS    = 30_000;
  private static readonly BASE_LOGIN_DELAY_MS = 5_000;
  private static readonly MAX_LOGIN_DELAY_MS  = 120_000;

  private static readonly FCA_OPTIONS: Record<string, unknown> = {
    logLevel:          "silent",
    selfListen:        false,
    listenEvents:      true,
    updatePresence:    false,
    forceLogin:        false,
    autoMarkDelivered: true,
    autoMarkRead:      false,
    autoReconnect:     true,
  };

  constructor(appState: FcaCookie[]) {
    this.appState = appState;
  }

  setEventHandler(handler: FcaEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Register an additional raw FCA event listener.
   * Useful for plugins that need to react to events like log:thread-name or
   * log:user-nickname without replacing the main pipeline handler.
   * Listeners are called after the main eventHandler, each in its own try/catch.
   */
  addRawEventListener(fn: FcaEventHandler): void {
    if (!this.rawListeners.includes(fn)) {
      this.rawListeners.push(fn);
    }
  }

  /** Remove a previously registered raw listener. */
  removeRawEventListener(fn: FcaEventHandler): void {
    this.rawListeners = this.rawListeners.filter(l => l !== fn);
  }

  getApi(): FcaApi | null         { return this.api; }
  getCurrentUserId(): string      { return this.api?.getCurrentUserID() ?? ""; }
  getAppState(): FcaCookie[]      { return this.api?.getAppState() ?? this.appState; }

  // ── ISystem ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.running = true;
    log.info("MiraiTransport: initializing…", { cookieCount: this.appState.length });
    await this.doLogin();
  }

  async destroy(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopListening();
    if (this.api) { try { this.api.logout(); } catch { /**/ } this.api = null; }
    this.rawListeners = [];
    log.info("MiraiTransport: destroyed.");
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private getUserIdFromAppState(): string {
    const cookie = this.appState.find(c => c.key === "c_user");
    return cookie?.value ? String(cookie.value) : "";
  }

  private doLogin(): Promise<void> {
    return new Promise<void>((resolve) => {
      const earlyPageId = this.getUserIdFromAppState();

      log.info("MiraiTransport: logging in via fca-unofficial…", {
        attempt:     this.loginAttempts + 1,
        earlyPageId: earlyPageId || "(not found in AppState)",
      });

      let resolved = false;

      const loginOptions: { appState: FcaCookie[]; pageID?: string } = {
        appState: this.appState,
        ...(earlyPageId ? { pageID: earlyPageId } : {}),
      };

      fcaLogin(loginOptions, (err, api) => {
        if (resolved) return;

        if (err || !api) {
          const errMsg = err instanceof Error
            ? err.message
            : (err != null ? JSON.stringify(err) : "null API returned");

          if (isSessionExpiredError(errMsg)) {
            log.error(
              "MiraiTransport: FB_APPSTATE is expired or invalid — stopping all retries." +
              " Please generate a new appState from Facebook and update FB_APPSTATE in Railway.",
              { error: errMsg },
            );
            this.running = false;
            resolved = true;
            resolve();
            return;
          }

          log.warn("MiraiTransport: login failed.", { error: errMsg });
          resolved = true;
          resolve();
          this.scheduleReLogin("login-error");
          return;
        }

        this.api = api;
        api.setOptions({ ...MiraiTransport.FCA_OPTIONS, pageID: api.getCurrentUserID() });

        log.info("MiraiTransport: logged in successfully.", {
          userId: api.getCurrentUserID(),
        });

        resolved = true;
        this.startListening();
        resolve();
      });
    });
  }

  private startListening(): void {
    if (!this.api) return;

    log.info("MiraiTransport: starting MQTT event listener…");
    this.listenerStartMs = Date.now();

    this.stopListenFn = this.api.listen((err, event) => {
      if (err) {
        const stableMs = Date.now() - this.listenerStartMs;

        let errCode: number | undefined;
        let errMsg: string;

        if (err instanceof Error) {
          errMsg = err.message;
        } else if (typeof err === "object" && err !== null) {
          const e = err as Record<string, unknown>;
          errCode = typeof e["error"] === "number" ? e["error"] : undefined;
          errMsg  = JSON.stringify(err);
        } else {
          errMsg = String(err);
        }

        if (errCode !== undefined && FATAL_FB_ERRORS.has(errCode)) {
          log.warn(
            "MiraiTransport: FATAL session error — AppState is expired or invalid." +
            " Please refresh FB_APPSTATE and restart the bot.",
            { fbErrorCode: errCode, error: errMsg },
          );
          this.running = false;
          this.stopListening();
          this.api = null;
          return;
        }

        log.warn("MiraiTransport: listener error — scheduling re-login.", {
          error: errMsg, stableMs,
        });

        if (stableMs >= MiraiTransport.STABLE_LISTEN_MS) {
          this.loginAttempts = 0;
          log.info("MiraiTransport: listener was stable — resetting login counter.");
        }

        this.scheduleReLogin("listen-error");
        return;
      }

      if (!this.running || !event) return;

      log.info("MiraiTransport: raw event received.", { type: event.type });

      // ── Main pipeline handler ────────────────────────────────────────────
      try {
        this.eventHandler?.(event);
      } catch (handlerErr: unknown) {
        log.error("MiraiTransport: event handler threw — event dropped.", {
          eventType: (event as Record<string, unknown>).type,
          error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
        });
      }

      // ── Additional raw listeners (e.g. management plugin protection) ─────
      for (const listener of this.rawListeners) {
        try {
          listener(event);
        } catch (listenerErr: unknown) {
          log.warn("MiraiTransport: raw listener threw.", {
            error: listenerErr instanceof Error ? listenerErr.message : String(listenerErr),
          });
        }
      }
    });

    log.info("MiraiTransport: listener active — waiting for messages.");
  }

  private stopListening(): void {
    if (this.stopListenFn) {
      try { this.stopListenFn(); } catch { /**/ }
      this.stopListenFn = null;
    }
  }

  private scheduleReLogin(reason: string): void {
    if (!this.running) return;

    this.loginAttempts++;

    if (this.loginAttempts > MiraiTransport.MAX_LOGIN_ATTEMPTS) {
      log.warn("MiraiTransport: max login attempts reached — giving up.", {
        loginAttempts: this.loginAttempts,
      });
      return;
    }

    const delay = Math.min(
      MiraiTransport.BASE_LOGIN_DELAY_MS * Math.pow(2, this.loginAttempts - 1),
      MiraiTransport.MAX_LOGIN_DELAY_MS,
    );

    log.info("MiraiTransport: scheduling re-login.", {
      reason, attempt: this.loginAttempts, maxAttempts: MiraiTransport.MAX_LOGIN_ATTEMPTS, delayMs: delay,
    });

    this.stopListening();
    this.api = null;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) return;
      this.doLogin().catch((e: unknown) => {
        log.error("MiraiTransport: re-login threw.", {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }, delay);
  }
}
