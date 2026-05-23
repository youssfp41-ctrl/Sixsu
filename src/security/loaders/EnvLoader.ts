import {
  ICredentialLoader,
  CredentialEntry,
  CredentialSource,
  CredentialStatus,
  LoadResult,
} from "../types/ICredential";
import { CredentialGuard }  from "../CredentialGuard";
import { LoggerManager }    from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("EnvLoader");

export interface EnvLoaderOptions {
  /** Required env vars to load. */
  required: string[];
  /** Optional env vars (missing = skipped, not an error). */
  optional?: string[];
}

export class EnvLoader implements ICredentialLoader {
  readonly name = "env";
  private readonly opts: Required<EnvLoaderOptions>;

  constructor(opts: EnvLoaderOptions) {
    this.opts = { optional: [], ...opts };
  }

  async canLoad(): Promise<boolean> {
    return this.opts.required.every((key) => !!process.env[key]);
  }

  async load(): Promise<LoadResult> {
    log.info(`EnvLoader: loading ${this.opts.required.length} required credential(s).`);

    const credentials: CredentialEntry[] = [];
    const errors: string[]              = [];
    const now = new Date();

    for (const key of this.opts.required) {
      const raw = process.env[key];

      if (!raw) {
        errors.push(`Required env var "${key}" is not set.`);
        credentials.push({
          key, value: "", source: CredentialSource.ENV,
          status: CredentialStatus.MISSING, loadedAt: now,
        });
        continue;
      }

      const guard = CredentialGuard.validate(key, raw);
      if (!guard.valid) {
        errors.push(guard.reason ?? `"${key}" failed validation.`);
        credentials.push({
          key, value: "", source: CredentialSource.ENV,
          status: CredentialStatus.HARDCODED, loadedAt: now,
        });
        log.error(`EnvLoader: ${guard.reason}`);
        continue;
      }

      credentials.push({
        key, value: raw, source: CredentialSource.ENV,
        status: CredentialStatus.VALID, loadedAt: now,
      });
      log.info(`EnvLoader: "${key}" loaded OK (${raw.length} chars).`);
    }

    for (const key of this.opts.optional) {
      const raw = process.env[key];
      if (!raw) continue;

      const guard = CredentialGuard.validate(key, raw);
      credentials.push({
        key,
        value:    guard.valid ? raw : "",
        source:   CredentialSource.ENV,
        status:   guard.valid ? CredentialStatus.VALID : CredentialStatus.HARDCODED,
        loadedAt: now,
      });
    }

    if (errors.length > 0) {
      return {
        success:     false,
        credentials,
        source:      CredentialSource.ENV,
        error:       errors.join(" | "),
      };
    }

    return { success: true, credentials, source: CredentialSource.ENV };
  }
}
