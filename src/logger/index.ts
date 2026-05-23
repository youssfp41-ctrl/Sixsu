export { Logger } from "./Logger";
export { LoggerManager } from "./LoggerManager";
export { ConsoleTransport } from "./transports/ConsoleTransport";
export { FileTransport } from "./transports/FileTransport";
export type { ILogger, LogEntry, LogLevel } from "./types/ILogger";
export { LOG_LEVEL_PRIORITY } from "./types/ILogger";
export type { ITransport } from "./types/ITransport";
export type { LoggerOptions } from "./LoggerManager";

import { LoggerManager } from "./LoggerManager";

export const logger = LoggerManager.getLogger();
