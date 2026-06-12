export interface ThreadState {
  protectName:      boolean;
  lockedName:       string;
  protectNicknames: boolean;
  nicknames:        Record<string, string>;
}

export interface ProtectionStore {
  threads:      Record<string, ThreadState>;
  botNicknames: Record<string, string>;
}

let _store: ProtectionStore = { threads: {}, botNicknames: {} };

export function getProtectionStore(): ProtectionStore { return _store; }
export function setProtectionStore(store: ProtectionStore): void { _store = store; }
