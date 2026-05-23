import { errorReporter } from "../ErrorReporter";

export type Result<T> = [null, T] | [Error, null];

export async function tryCatch<T>(
  fn: () => Promise<T>
): Promise<Result<T>> {
  try {
    const value = await fn();
    return [null, value];
  } catch (err) {
    return [err instanceof Error ? err : new Error(String(err)), null];
  }
}

export async function safeRun<T>(
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    errorReporter.report(err, context);
    return undefined;
  }
}

export function withErrorBoundary<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  context?: Record<string, unknown>
): (...args: TArgs) => Promise<TReturn | undefined> {
  return async (...args: TArgs): Promise<TReturn | undefined> => {
    return safeRun(() => fn(...args), context);
  };
}
