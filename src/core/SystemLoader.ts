import { ISystem, SystemEntry, SystemStatus } from "./interfaces/ISystem";
import { InitializationManager } from "./InitializationManager";

export class SystemLoader {
  private readonly entries: Map<string, SystemEntry> = new Map();
  private readonly manager: InitializationManager;

  constructor(manager: InitializationManager) {
    this.manager = manager;
  }

  register(system: ISystem): this {
    this.manager.register(system);
    this.entries.set(system.name, {
      system,
      status: SystemStatus.PENDING,
    });
    return this;
  }

  getResolved(): ISystem[] {
    return this.manager.resolve();
  }

  setStatus(name: string, status: SystemStatus): void {
    const entry = this.entries.get(name);
    if (!entry) return;

    entry.status = status;

    if (status === SystemStatus.READY) {
      entry.initializedAt = Date.now();
    }
  }

  get<T extends ISystem>(name: string): T {
    const entry = this.entries.get(name);
    if (!entry) {
      throw new Error(`System not found: "${name}"`);
    }
    return entry.system as T;
  }

  getStatus(name: string): SystemStatus | undefined {
    return this.entries.get(name)?.status;
  }

  summary(): Record<string, SystemStatus> {
    const result: Record<string, SystemStatus> = {};
    for (const [name, entry] of this.entries) {
      result[name] = entry.status;
    }
    return result;
  }
}
