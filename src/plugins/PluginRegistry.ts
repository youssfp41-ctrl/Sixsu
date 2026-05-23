import { IPlugin }                          from "./types/IPlugin";
import { PluginStatus, PluginEntry }        from "./types/PluginStatus";
import { PluginContext }                    from "./PluginContext";
import { PluginNotFoundError, PluginStateError } from "./errors/PluginErrors";

interface InternalEntry extends PluginEntry {
  plugin:  IPlugin;
  ctx?:    PluginContext;
}

const VALID_TRANSITIONS: Partial<Record<PluginStatus, PluginStatus[]>> = {
  [PluginStatus.UNLOADED]:  [PluginStatus.LOADING],
  [PluginStatus.LOADING]:   [PluginStatus.LOADED,    PluginStatus.FAILED],
  [PluginStatus.LOADED]:    [PluginStatus.ENABLING,  PluginStatus.UNLOADING],
  [PluginStatus.ENABLING]:  [PluginStatus.ENABLED,   PluginStatus.FAILED],
  [PluginStatus.ENABLED]:   [PluginStatus.DISABLING],
  [PluginStatus.DISABLING]: [PluginStatus.DISABLED,  PluginStatus.FAILED],
  [PluginStatus.DISABLED]:  [PluginStatus.ENABLING,  PluginStatus.UNLOADING],
  [PluginStatus.UNLOADING]: [PluginStatus.UNLOADED,  PluginStatus.FAILED],
  [PluginStatus.FAILED]:    [PluginStatus.UNLOADING, PluginStatus.LOADING],
};

/**
 * Central store for all plugin entries.
 * Enforces valid state transitions and exposes read-only snapshots.
 */
export class PluginRegistry {
  private readonly entries = new Map<string, InternalEntry>();

  add(plugin: IPlugin, filePath?: string): void {
    const { name } = plugin.manifest;
    this.entries.set(name, {
      pluginName: name,
      plugin,
      status:     PluginStatus.UNLOADED,
      filePath,
    });
  }

  remove(name: string): void {
    this.entries.delete(name);
  }

  transition(name: string, to: PluginStatus): void {
    const entry   = this.demand(name);
    const allowed = VALID_TRANSITIONS[entry.status] ?? [];

    if (!allowed.includes(to)) {
      throw new PluginStateError(name, entry.status, to);
    }

    entry.status = to;

    if (to === PluginStatus.LOADED)   entry.loadedAt  = Date.now();
    if (to === PluginStatus.ENABLED)  entry.enabledAt = Date.now();
    if (to === PluginStatus.UNLOADED) {
      delete entry.loadedAt;
      delete entry.enabledAt;
      delete entry.error;
    }
  }

  markFailed(name: string, error: Error): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    entry.status = PluginStatus.FAILED;
    entry.error  = error;
  }

  setContext(name: string, ctx: PluginContext): void {
    this.demand(name).ctx = ctx;
  }

  getContext(name: string): PluginContext | undefined {
    return this.entries.get(name)?.ctx;
  }

  getPlugin(name: string): IPlugin {
    return this.demand(name).plugin;
  }

  getStatus(name: string): PluginStatus | undefined {
    return this.entries.get(name)?.status;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Public snapshot — does NOT expose internal plugin instances or contexts. */
  getAll(): PluginEntry[] {
    return Array.from(this.entries.values()).map((e) => ({
      pluginName: e.pluginName,
      status:     e.status,
      error:      e.error,
      filePath:   e.filePath,
      loadedAt:   e.loadedAt,
      enabledAt:  e.enabledAt,
    }));
  }

  getEnabled(): string[] {
    return Array.from(this.entries.values())
      .filter((e) => e.status === PluginStatus.ENABLED)
      .map((e) => e.pluginName);
  }

  private demand(name: string): InternalEntry {
    const entry = this.entries.get(name);
    if (!entry) throw new PluginNotFoundError(name);
    return entry;
  }
}
