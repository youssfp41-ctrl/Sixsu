export { BotError } from "./types/BotError";
export type { ErrorSeverity, BotErrorOptions } from "./types/BotError";

export {
  ConfigurationError,
  DatabaseError,
  FacebookApiError,
  CommandError,
  ValidationError,
  PermissionError,
  NetworkError,
  ShutdownError,
} from "./types/errors";

export { ErrorReporter, errorReporter } from "./ErrorReporter";
export type { ErrorReport } from "./ErrorReporter";

export { tryCatch, safeRun, withErrorBoundary } from "./handlers/AsyncErrorHandler";
export type { Result } from "./handlers/AsyncErrorHandler";

export { ProcessErrorHandler } from "./handlers/ProcessErrorHandler";
export { httpErrorHandler, notFoundHandler } from "./handlers/HttpErrorHandler";
