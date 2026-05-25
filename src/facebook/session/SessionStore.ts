import fs   from "fs";
import path from "path";
import { CryptoHelper }                from "../auth/CryptoHelper";
import { SessionFile, SessionEntry }   from "./types/ISession";
import { LoggerManager }               from "../../logger/LoggerManager";

const log           = LoggerManager.getLogger("SessionStore");
const STORE_VERSION = 1;

export class SessionStore {
  private readonly filePath:      string;
  private readonly encryptionKey: string;

  /**
   * Write operations are serialised through this promise chain so that
   * concurrent save() calls never interleave their read-modify-write cycle
   * and overwrite each other's data.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, encryptionKey: string) {
    this.filePath      = filePath;
    this.encryptionKey = encryptionKey;
    this.ensureDir();
  }

  async save(entry: SessionEntry): Promise<void> {
    // Chain behind any in-flight write so operations are serialised.
    this.writeQueue = this.writeQueue.then(() => this.doSave(entry));
    return this.writeQueue;
  }

  async load(accountId: string): Promise<SessionEntry | null> {
    const file  = this.readRaw();
    const entry = file.sessions[accountId];
    if (!entry) return null;

    let decrypted: string;
    try {
      decrypted = await CryptoHelper.decrypt(entry.encryptedAppState, this.encryptionKey);
    } catch (err) {
      log.error(`Failed to decrypt session for "${accountId}".`, err);
      return null;
    }

    return { ...entry, encryptedAppState: decrypted };
  }

  delete(accountId: string): boolean {
    // Serialise deletes through the write queue as well.
    let resolved = false;
    this.writeQueue = this.writeQueue.then(() => {
      resolved = this.doDelete(accountId);
    });
    // Synchronous return value is a best-effort signal; callers should await save().
    return this.doDelete_sync(accountId, resolved);
  }

  listAccounts(): string[] {
    return Object.keys(this.readRaw().sessions);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async doSave(entry: SessionEntry): Promise<void> {
    const file           = this.readRaw();
    const encryptedState = await CryptoHelper.encrypt(
      entry.encryptedAppState,
      this.encryptionKey
    );

    file.sessions[entry.accountId] = { ...entry, encryptedAppState: encryptedState };
    file.updatedAt = new Date().toISOString();

    this.writeRaw(file);
    log.info(`Session saved for account: ${entry.accountId}`);
  }

  private doDelete(accountId: string): boolean {
    const file = this.readRaw();
    if (!file.sessions[accountId]) return false;

    delete file.sessions[accountId];
    file.updatedAt = new Date().toISOString();
    this.writeRaw(file);

    log.info(`Session deleted for account: ${accountId}`);
    return true;
  }

  /** Synchronous variant used for the immediate return value only. */
  private doDelete_sync(accountId: string, _queued: boolean): boolean {
    return this.readRaw().sessions[accountId] !== undefined ? true : false;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private readRaw(): SessionFile {
    if (!fs.existsSync(this.filePath)) {
      return { version: STORE_VERSION, updatedAt: new Date().toISOString(), sessions: {} };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as SessionFile;
    } catch (err) {
      log.error("Session store corrupted. Starting fresh.", err);
      return { version: STORE_VERSION, updatedAt: new Date().toISOString(), sessions: {} };
    }
  }

  private writeRaw(file: SessionFile): void {
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}
