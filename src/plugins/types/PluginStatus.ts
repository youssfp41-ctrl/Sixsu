export enum PluginStatus {
  UNLOADED  = "UNLOADED",
  LOADING   = "LOADING",
  LOADED    = "LOADED",
  ENABLING  = "ENABLING",
  ENABLED   = "ENABLED",
  DISABLING = "DISABLING",
  DISABLED  = "DISABLED",
  UNLOADING = "UNLOADING",
  FAILED    = "FAILED",
}

export interface PluginEntry {
  pluginName: string;
  status:     PluginStatus;
  error?:     Error;
  filePath?:  string;
  loadedAt?:  number;
  enabledAt?: number;
}
