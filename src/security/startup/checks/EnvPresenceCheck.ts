import { IStartupCheck, CheckResult, CheckSeverity } from "../IStartupCheck";
import { CredentialGuard }                           from "../../CredentialGuard";

export interface EnvPresenceCheckOptions {
  required:  string[];
  severity?: CheckSeverity;
}

export class EnvPresenceCheck implements IStartupCheck {
  readonly name:     string = "env-presence";
  readonly severity: CheckSeverity;
  private readonly required: string[];

  constructor(opts: EnvPresenceCheckOptions) {
    this.required = opts.required;
    this.severity = opts.severity ?? CheckSeverity.CRITICAL;
  }

  async run(): Promise<CheckResult> {
    const missing:    string[] = [];
    const hardcoded:  string[] = [];

    for (const key of this.required) {
      const value = process.env[key];

      if (!value) {
        missing.push(key);
        continue;
      }

      const guard = CredentialGuard.validate(key, value);
      if (!guard.valid) {
        hardcoded.push(key);
      }
    }

    if (missing.length > 0) {
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  `Missing required environment variable(s): ${missing.join(", ")}`,
        detail:   "Set these in your .env file or Railway/deployment environment.",
      };
    }

    if (hardcoded.length > 0) {
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  `Placeholder/hardcoded values detected: ${hardcoded.join(", ")}`,
        detail:   "Replace placeholder values with real credentials.",
      };
    }

    return {
      name:    this.name,
      passed:  true,
      severity: this.severity,
      message: `All ${this.required.length} required environment variable(s) are present and valid.`,
    };
  }
}
