export interface ThreadState {
  protectName:      boolean;
  lockedName:       string;
  protectNicknames: boolean;
  nicknames:        Record<string, string>;
  /**
   * Transient in-memory flag — NOT persisted to DB or file.
   * Set to 'bot' immediately before the bot calls setTitle via /اسم command.
   * Checked in handleNameChanged to skip revert when the bot is the source.
   * Always reset to 'external' on startup / after consumption.
   */
  lastChangedBy: 'bot' | 'external' | '';
}

export interface ProtectionStore {
  threads:      Record<string, ThreadState>;
  botNicknames: Record<string, string>;
}

let _store: ProtectionStore = { threads: {}, botNicknames: {} };

export function getProtectionStore(): ProtectionStore { return _store; }
export function setProtectionStore(store: ProtectionStore): void { _store = store; }
