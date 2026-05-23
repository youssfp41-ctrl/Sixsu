import fs from "fs";
import {
  ICredentialLoader,
  CredentialEntry,
  CredentialSource,
  CredentialStatus,
  LoadResult,
} from "../types/ICredential";
import { CredentialGuard }  from "../CredentialGuard";
import { CryptoHelper }     from "../../facebook/auth/CryptoHelper";
import { LoggerManager }    from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("EncryptedFileLoader");

export interface EncryptedFileLoaderOptions {
  /** Path to the AES-256-GCM encrypted JSON credentials file. */
  filePath: string;
  /** Decryption key — must come from an env var, never hardcoded. */
  encryptionKey: string;
}

export class EncryptedFileLoader implements ICredentialLoader {
  readonly name = "encrypted-file";
  private readonly opts: EncryptedFileLoaderOptions;

  constructor(opts: EncryptedFileLoaderOptions) {
    this.opts = opts;
  }

  async canLoad(): Promise<boolean> {
    return fs.existsSync(this.opts.filePath);
  }

  async load(): Promise<LoadResult> {
    log.info(`EncryptedFileLoader: reading "${this.opts.filePath}".`);

    if (!fs.existsSync(this.opts.filePath)) {
      return {
        success:     false,
        credentials: [],
        source:      CredentialSource.ENCRYPTED_FILE,
        error:       `Encrypted credentials file not found: ${this.opts.filePath}`,
      };
    }

    let ciphertext: string;
    try {
      ciphertext = fs.readFileSync(this.opts.filePath, "utf8").trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false, credentials: [], source: CredentialSource.ENCRYPTED_FILE,
        error: `Failed to read file: ${msg}`,
      };
    }

    let plaintext: string;
    try {
      plaintext = await CryptoHelper.decrypt(ciphertext, this.opts.encryptionKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`EncryptedFileLoader: decryption failed — wrong key or corrupted file.`);
      return {
        success: false, credentials: [], source: CredentialSource.ENCRYPTED_FILE,
        error: `Decryption failed: ${msg}`,
      };
    }

    let parsed: Record<string, string>;
    try {
      const raw = JSON.parse(plaintext);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Expected a JSON object of key-value credential pairs.");
      }
      parsed = raw as Record<string, string>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false, credentials: [], source: CredentialSource.ENCRYPTED_FILE,
        error: `Invalid JSON in decrypted file: ${msg}`,
      };
    }

    const credentials: CredentialEntry[] = [];
    const errors: string[]              = [];
    const now = new Date();

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        errors.push(`"${key}" has a non-string value.`);
        continue;
      }

      const guard = CredentialGuard.validate(key, value);
      if (!guard.valid) {
        errors.push(guard.reason ?? `"${key}" failed guard validation.`);
        credentials.push({
          key, value: "", source: CredentialSource.ENCRYPTED_FILE,
          status: CredentialStatus.HARDCODED, loadedAt: now,
        });
        log.error(`EncryptedFileLoader: ${guard.reason}`);
        continue;
      }

      credentials.push({
        key, value, source: CredentialSource.ENCRYPTED_FILE,
        status: CredentialStatus.VALID, loadedAt: now,
      });
      log.info(`EncryptedFileLoader: "${key}" loaded OK.`);
    }

    if (errors.length > 0) {
      return {
        success: false, credentials, source: CredentialSource.ENCRYPTED_FILE,
        error: errors.join(" | "),
      };
    }

    log.info(`EncryptedFileLoader: ${credentials.length} credential(s) loaded successfully.`);
    return { success: true, credentials, source: CredentialSource.ENCRYPTED_FILE };
  }
}
