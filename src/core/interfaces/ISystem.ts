export interface ISystem {
  readonly name: string;
  readonly dependencies?: string[];
  initialize(): Promise<void>;
  destroy(): Promise<void>;
}

export enum SystemStatus {
  PENDING = "PENDING",
  INITIALIZING = "INITIALIZING",
  READY = "READY",
  DESTROYING = "DESTROYING",
  DESTROYED = "DESTROYED",
  FAILED = "FAILED",
}

export interface SystemEntry {
  system: ISystem;
  status: SystemStatus;
  initializedAt?: number;
}
