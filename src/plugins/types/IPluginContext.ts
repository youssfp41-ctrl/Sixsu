import { ICommand }                              from "../../commands/types/ICommand";
import { DelayedTaskOptions, RecurringTaskOptions } from "../../scheduler/types/ITask";
import { ILogger }                               from "../../logger/types/ILogger";

export interface IDisposable {
  dispose(): void;
}

export type PluginEventHandler = (data: unknown) => void | Promise<void>;

/**
 * The sandboxed surface exposed to each plugin.
 * All registrations (commands, events, services, tasks) are tracked — when
 * the plugin context is disposed (on disable/unload), everything is cleaned up
 * automatically.
 */
export interface IPluginContext {
  readonly pluginName: string;
  readonly logger:     ILogger;

  // ── Config ────────────────────────────────────────────────────────────────
  /** Read a config value by key. Returns fallback if the key is not set. */
  getConfig<T = unknown>(key: string, fallback?: T): T;

  // ── Commands ──────────────────────────────────────────────────────────────
  /** Register a command. Auto-unregistered when the plugin is disabled. */
  registerCommand(command: ICommand): IDisposable;

  // ── Events ────────────────────────────────────────────────────────────────
  /** Publish an event to all listeners (fire-and-forget). */
  emit(event: string, data?: unknown): void;
  /** Subscribe to an event. Auto-unsubscribed when the plugin is disabled. */
  on(event: string, handler: PluginEventHandler): IDisposable;

  // ── Services ──────────────────────────────────────────────────────────────
  /** Expose a service for other plugins to consume. Auto-removed on disable. */
  provideService<T>(name: string, service: T): IDisposable;
  /** Consume a service by name. Returns undefined if not found. */
  consumeService<T>(name: string): T | undefined;
  /** Consume a required service. Throws PluginServiceError if not found. */
  requireService<T>(name: string): T;

  // ── Scheduling ────────────────────────────────────────────────────────────
  /** Schedule a recurring task. Auto-cancelled when the plugin is disabled. */
  scheduleRecurring(options: Omit<RecurringTaskOptions, "id">): IDisposable;
  /** Schedule a one-shot delayed task. Auto-cancelled when the plugin is disabled. */
  scheduleDelayed(options: Omit<DelayedTaskOptions, "id">): IDisposable;
}
