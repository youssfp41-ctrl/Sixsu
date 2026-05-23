import { IPluginContext } from "./IPluginContext";

export interface PluginManifest {
  readonly name:         string;
  readonly version:      string;
  readonly description?: string;
  readonly author?:      string;
  /**
   * Names of other plugins this plugin requires.
   * PluginManager enables dependencies before enabling this plugin.
   */
  readonly dependencies?: string[];
  /**
   * Default config values merged with the plugin's config.json (if present).
   * Keys defined here act as schema + fallback values.
   */
  readonly defaultConfig?: Record<string, unknown>;
}

export interface IPlugin {
  readonly manifest: PluginManifest;

  /**
   * Called once when the plugin module is first loaded.
   * Receives the sandboxed context — store it for use in onEnable().
   * Do NOT register commands or tasks here; use onEnable() instead.
   */
  onLoad(ctx: IPluginContext): Promise<void>;

  /**
   * Called when the plugin is enabled.
   * Register commands, schedule tasks, subscribe to events here.
   * All registrations via ctx are tracked and auto-cleaned on disable.
   */
  onEnable?(): Promise<void>;

  /**
   * Called when the plugin is disabled.
   * The PluginContext disposes automatically after this returns —
   * commands/tasks/events registered via ctx are removed.
   * Use this only for additional custom cleanup.
   */
  onDisable?(): Promise<void>;

  /**
   * Called when the plugin is fully unloaded (graceful shutdown or hot-reload).
   * Release all resources not tracked by the context (e.g. open handles, timers).
   */
  onUnload(): Promise<void>;
}

export function isValidPlugin(obj: unknown): obj is IPlugin {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "manifest" in obj &&
    typeof (obj as IPlugin).manifest === "object" &&
    (obj as IPlugin).manifest !== null &&
    typeof (obj as IPlugin).manifest.name === "string" &&
    (obj as IPlugin).manifest.name.trim().length > 0 &&
    typeof (obj as IPlugin).manifest.version === "string" &&
    "onLoad" in obj &&
    typeof (obj as IPlugin).onLoad === "function" &&
    "onUnload" in obj &&
    typeof (obj as IPlugin).onUnload === "function"
  );
}
