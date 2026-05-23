export { PluginManager }         from "./PluginManager";
export type { PluginManagerOptions } from "./PluginManager";

export { PluginLoader }          from "./PluginLoader";
export { PluginRegistry }        from "./PluginRegistry";
export { PluginEventBus }        from "./PluginEventBus";
export { PluginServiceRegistry } from "./PluginServiceRegistry";
export { PluginConfigStore }     from "./PluginConfigStore";
export { PluginContext }         from "./PluginContext";

export type { IPlugin, PluginManifest } from "./types/IPlugin";
export { isValidPlugin }               from "./types/IPlugin";

export type {
  IPluginContext,
  IDisposable,
  PluginEventHandler,
} from "./types/IPluginContext";

export { PluginStatus }       from "./types/PluginStatus";
export type { PluginEntry }   from "./types/PluginStatus";

export {
  PluginError,
  PluginNotFoundError,
  PluginDependencyError,
  PluginStateError,
  PluginServiceError,
  PluginCircularDependencyError,
} from "./errors/PluginErrors";
