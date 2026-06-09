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

  private readonly appState:    FcaCookie[];
  private readonly initDelayMs: number;
  private api:                  FcaApi | null        = null;
  private stopListenFn:         (() => void) | null   = null;
  private eventHandler:         FcaEventHandler | null = null;
  private rawListeners:         FcaEventHandler[]     = [];
  private running               = false;
  private reconnectTimer:       ReturnType<typeof setTimeout> | null = null;
  private loginAttempts         = 0;
  private listenerStartMs       = 0;

  private static readonly MAX_LOGIN_ATTEMPTS  = 5;
  /** Max times a FATAL Facebook error triggers a retry before we stop permanently.
   *  Transient 1357031 errors can be caused by a secondary account logging in from
   *  the same IP — allow a couple of retries before treating it as genuine expiry. */
  private static readonly MAX_FATAL_RETRIES   = 2;
  private static readonly STABLE_LISTEN_MS    = 30_000;
  private static readonly BASE_LOGIN_DELAY_MS = 5_000;
  private static readonly MAX_LOGIN_DELAY_MS  = 120_000;

  // autoReconnect:false — we own all reconnection logic via scheduleReLogin;
  // avoids a double-reconnect race where fca-unofficial and our code both try
  // to reconnect at the same time after an MQTT drop.
  private static readonly FCA_OPTIONS: Record<string, unknown> = {
    logLevel:          "silent",
    selfListen:        false,
    listenEvents:      true,
    updatePresence:    false,
    forceLogin:        false,
    autoMarkDelivered: true,
    autoMarkRead:      false,
    autoReconnect:     false,
  };

  /**
   * @param appState      Facebook session cookies.
   * @param systemName    Unique ISystem name. Use "mirai-transport-secondary" for
   *                      account #2 so Bot.register() does not throw on duplicate names.
   * @param initDelayMs   Milliseconds to wait before the first login attempt.
   *                      Set ≥5000 for secondary accounts to stagger Facebook logins
   *                      and avoid triggering rate-limits or MQTT interference.
   */
  constructor(appState: FcaCookie[], systemName = "mirai-transport", initDelayMs = 0) {
    this.appState    = appState;
    this.name        = systemName;
    this.initDelayMs = initDelayMs;
  }

  // ── Public accessors ─────────────────────────────────────────────────────

  setEventHandler(handler: FcaEventHandler): void { this.eventHandler = handler; }

  addRawEventListener(fn: FcaEventHandler): void {
    if (!this.rawListeners.includes(fn)) this.rawListeners.push(fn);
  }

  removeRawEventListener(fn: FcaEventHandler): void {
    this.rawListeners = this.rawListeners.filter(l => l !== fn);
  }

  getApi():          FcaApi | null { return this.api; }
  getCurrentUserId(): string       { return this.api?.getCurrentUserID() ?? ""; }
  getAppState():     FcaCookie[]   { return this.api?.getAppState() ?? this.appState; }

  /** True when the fca-unofficial API object is active (MQTT listener running). */
  isConnected(): boolean { return this.api !== null; }

  /** True while this transport is allowed to (re)connect. */
  isRunning(): boolean { return this.running; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initDelayMs > 0) {
      log.info(
        `MiraiTransport [${this.name}]: staggering login by ${this.initDelayMs}ms ` +
        `to avoid Facebook rate-limiting / MQTT interference between accounts.`,
      );
      await new Promise<void>(r => setTimeout(r, this.initDelayMs));
    }
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

  /**
   * External restart — resets all retry counters and forces a fresh login attempt.
   * Called by ReconnectManager after it successfully refreshes credentials, bridging
   * the gap between "credentials valid" and "MQTT actually reconnected".
   */
  async restart(): Promise<void> {
    log.info(`MiraiTransport [${this.name}]: external restart requested — resetting retry counters.`);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopListening();
    this.api           = null;
    this.loginAttempts = 0;
    this.running       = true;
    await this.doLogin();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

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
          // FATAL Facebook error on the MQTT stream (e.g. 1357031 = session interrupted).
          //
          // KEY INSIGHT: these can be TRANSIENT — when a second account logs in from the
          // same Railway IP, Facebook's MQTT broker can send a 1357031 to the first
          // account's existing connection as a side-effect of the new login.
          //
          // Strategy: allow MAX_FATAL_RETRIES retries before treating it as a genuine
          // AppState expiry that requires manual credential rotation.
          this.stopListening();
          this.api = null;

          if (this.loginAttempts < MiraiTransport.MAX_FATAL_RETRIES) {
            log.warn(
              `MiraiTransport [${this.name}]: FATAL fb error ${errCode} — ` +
              `scheduling retry (${this.loginAttempts + 1}/${MiraiTransport.MAX_FATAL_RETRIES}). ` +
              `This may be a transient error caused by multi-account login.`,
              { fbErrorCode: errCode },
            );
            this.scheduleReLogin("fatal-fb-error");
          } else {
            log.error(
              `MiraiTransport [${this.name}]: FATAL fb error ${errCode} persists after ` +
              `${this.loginAttempts} retries — AppState is likely expired. Stopping permanently.`,
              { fbErrorCode: errCode },
            );
            this.running = false;
          }
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

      log.debug(`MiraiTransport [${this.name}]: raw event received.`, { type: event.type });

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
      log.warn(`MiraiTransport [${this.name}]: max login attempts (${MiraiTransport.MAX_LOGIN_ATTEMPTS}) reached — stopped.`);
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
