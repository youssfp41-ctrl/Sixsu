import { LoggerManager }      from "../logger/LoggerManager";
import { PluginEventHandler } from "./types/IPluginContext";

const log = LoggerManager.getLogger("PluginEventBus");

/**
 * Typed pub/sub event bus for inter-plugin communication.
 * All handler errors are caught and logged — one failing handler
 * never blocks others from running.
 */
export class PluginEventBus {
  private readonly listeners = new Map<string, Set<PluginEventHandler>>();

  on(event: string, handler: PluginEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: PluginEventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  async emit(event: string, data?: unknown): Promise<void> {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        await handler(data);
      } catch (err) {
        log.error(`Error in handler for event "${event}".`, err);
      }
    }
  }

  removeHandlers(handlers: Iterable<PluginEventHandler>): void {
    for (const [, set] of this.listeners) {
      for (const h of handlers) {
        set.delete(h);
      }
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
