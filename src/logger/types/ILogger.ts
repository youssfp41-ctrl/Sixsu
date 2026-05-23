export enum LogLevel {
  DEBUG = "debug",
  INFO  = "info",
  WARN  = "warn",
  ERROR = "error",
}

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]:  1,
  [LogLevel.WARN]:  2,
  [LogLevel.ERROR]: 3,
};

export interface LogEntry {
  readonly level:     LogLevel;
  readonly message:   string;
  readonly timestamp: Date;
  readonly context?:  string;
  readonly meta?:     Record<string, unknown>;
  readonly error?:    Error;
}

export interface ILogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info (message: string, meta?: Record<string, unknown>): void;
  warn (message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
  child(context: string): ILogger;
}
