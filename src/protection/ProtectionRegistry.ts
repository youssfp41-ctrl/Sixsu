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

/** Lifecycle metadata — never persisted, reset on process start. */
export interface ProtectionMeta {
  /** ISO timestamp when protection was last enabled for a thread. */
  enabledAt:    Record<string, string>;
  /** ISO timestamp when a name revert was last triggered. */
  lastRevertAt: Record<string, string>;
  /** Number of times a name revert was triggered per thread. */
  revertCount:  Record<string, number>;
  /** ISO timestamp when the listener last processed a name_changed event. */
  lastEventAt:  Record<string, string>;
}

let _store: ProtectionStore = { threads: {}, botNicknames: {} };
let _meta:  ProtectionMeta  = { enabledAt: {}, lastRevertAt: {}, revertCount: {}, lastEventAt: {} };

export function getProtectionStore(): ProtectionStore { return _store; }
export function setProtectionStore(store: ProtectionStore): void { _store = store; }

export function getProtectionMeta(): ProtectionMeta { return _meta; }

export function recordProtectionEnabled(threadId: string): void {
  _meta.enabledAt[threadId] = new Date().toISOString();
}

export function recordNameEvent(threadId: string): void {
  _meta.lastEventAt[threadId] = new Date().toISOString();
}

export function recordRevert(threadId: string): void {
  _meta.lastRevertAt[threadId] = new Date().toISOString();
  _meta.revertCount[threadId]  = (_meta.revertCount[threadId] ?? 0) + 1;
}

/** Summary of active protections — useful for /حماية status or watchdog logs. */
export function getProtectionSummary(): {
  totalThreads:    number;
  protectedNames:  number;
  protectedNicks:  number;
  threads: Array<{
    threadId:      string;
    protectName:   boolean;
    lockedName:    string;
    enabledAt:     string | undefined;
    lastRevertAt:  string | undefined;
    revertCount:   number;
    lastEventAt:   string | undefined;
  }>;
} {
  const threads = Object.entries(_store.threads).map(([id, s]) => ({
    threadId:     id,
    protectName:  s.protectName,
    lockedName:   s.lockedName,
    enabledAt:    _meta.enabledAt[id],
    lastRevertAt: _meta.lastRevertAt[id],
    revertCount:  _meta.revertCount[id] ?? 0,
    lastEventAt:  _meta.lastEventAt[id],
  }));

  return {
    totalThreads:   threads.length,
    protectedNames: threads.filter(t => t.protectName).length,
    protectedNicks: Object.values(_store.threads).filter(s => s.protectNicknames).length,
    threads,
  };
}
