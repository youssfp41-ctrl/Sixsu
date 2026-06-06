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

const FATAL_FB_ERRORS = new Set([
  1357004,
  1357031,
  1357045,
]);

const SESSION_EXPIRED_HINTS = [
  "fb_appstate expired",
  "appstate expired",
  "appstate die",
  "c_user/i_user cookie not found",
  "không tìm thấy cookie",
] as const;

function isSessionExpiredError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return SESSION_EXPIRED_HINTS.some(hint => lower.includes(hint.toLowerCase()));
}

export class MiraiTransport implements ISystem {
  /** Unique system name — configurable so multiple instances can coexist in Bot. */
  readonly name: string;

  private readonly appState: FcaCookie[];
  private api:              FcaApi | null       = null;
  private stopListenFn:     (() => void) | null  = null;
  private eventHandler:     FcaEventHandler | null = null;
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

  /**
   * @param appState  Facebook session cookies
   * @param systemName  Unique name for ISystem registry — defaults to "mirai-transport".
   *                    Pass a different name (e.g. "mirai-transport-secondary") when
   *                    registering a second account so Bot.register() doesn't conflict.
   */
  constructor(appState: FcaCookie[], systemName = "mirai-transport") {
    this.appState = appState;
    this.name     = systemName;
  }

  setEventHandler(handler: FcaEventHandler): void {
    this.eventHandler = handler;
  }

  addRawEventListener(fn: FcaEventHandler): void {
    if (!this.rawListeners.includes(fn)) {
      this.rawListeners.push(fn);
    }
  }

  removeRawEventListener(fn: FcaEventHandler): void {
    this.rawListeners = this.rawListeners.filter(l => l !== fn);
  }

  getApi(): FcaApi | null         { return this.api; }
  getCurrentUserId(): string      { return this.api?.getCurrentUserID() ?? ""; }
  getAppState(): FcaCookie[]      { return this.api?.getAppState() ?? this.appState; }

  async initialize(): Promise<void> {
    this.running = true;
    log.info(`MiraiTransport [${this.name}]: initializing…`, { cookieCount: this.appState.length });
    await this.doLogin();
  }

  async destroy(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopListening();
    if (this.api) { try { this.api.logout(); } catch { /**/ } this.api = null; }
    this.rawListeners = [];
    log.info(`MiraiTransport [${this.name}]: destroyed.`);
  }

  private getUserIdFromAppState(): string {
    const cookie = this.appState.find(c => c.key === "c_user");
    return cookie?.value ? String(cookie.value) : "";
  }

  private doLogin(): Promise<void> {
    return new Promise<void>((resolve) => {
      const earlyPageId = this.getUserIdFromAppState();

      log.info(`MiraiTransport [${this.name}]: logging in…`, {
        attempt:     this.loginAttempts + 1,
        earlyPageId: earlyPageId || "(not found)",
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
              `MiraiTransport [${this.name}]: AppState expired — stopping retries.`,
              { error: errMsg },
            );
            this.running = false;
            resolved = true;
            resolve();
            return;
          }

          log.warn(`MiraiTransport [${this.name}]: login failed.`, { error: errMsg });
          resolved = true;
          resolve();
          this.scheduleReLogin("login-error");
          return;
        }

        this.api = api;
        api.setOptions({ ...MiraiTransport.FCA_OPTIONS, pageID: api.getCurrentUserID() });

        log.info(`MiraiTransport [${this.name}]: logged in.`, { userId: api.getCurrentUserID() });

        resolved = true;
        this.startListening();
        resolve();
      });
    });
  }

  private startListening(): void {
    if (!this.api) return;

    log.info(`MiraiTransport [${this.name}]: starting MQTT listener…`);
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
          log.warn(`MiraiTransport [${this.name}]: FATAL error — AppState expired.`, { fbErrorCode: errCode });
          this.running = false;
          this.stopListening();
          this.api = null;
          return;
        }

        log.warn(`MiraiTransport [${this.name}]: listener error — re-login.`, { error: errMsg, stableMs });

        if (stableMs >= MiraiTransport.STABLE_LISTEN_MS) {
          this.loginAttempts = 0;
        }
        this.scheduleReLogin("listen-error");
        return;
      }

      if (!this.running || !event) return;

      log.info(`MiraiTransport [${this.name}]: raw event received.`, { type: event.type });

      try {
        this.eventHandler?.(event);
      } catch (handlerErr: unknown) {
        log.error(`MiraiTransport [${this.name}]: event handler threw.`, {
          eventType: (event as Record<string, unknown>).type,
          error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
        });
      }

      for (const listener of this.rawListeners) {
        try { listener(event); } catch (listenerErr: unknown) {
          log.warn(`MiraiTransport [${this.name}]: raw listener threw.`, {
            error: listenerErr instanceof Error ? listenerErr.message : String(listenerErr),
          });
        }
      }
    });

    log.info(`MiraiTransport [${this.name}]: listener active.`);
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
      log.warn(`MiraiTransport [${this.name}]: max login attempts reached.`);
      return;
    }

    const delay = Math.min(
      MiraiTransport.BASE_LOGIN_DELAY_MS * Math.pow(2, this.loginAttempts - 1),
      MiraiTransport.MAX_LOGIN_DELAY_MS,
    );

    log.info(`MiraiTransport [${this.name}]: re-login in ${delay}ms.`, { reason, attempt: this.loginAttempts });

    this.stopListening();
    this.api = null;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) return;
      this.doLogin().catch((e: unknown) => {
        log.error(`MiraiTransport [${this.name}]: re-login threw.`, {
          error: e instanceof Error ? e.message : String(e),
        });
      });
    }, delay);
  }
}
