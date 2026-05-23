import { IStartupCheck, CheckResult, CheckSeverity } from "../IStartupCheck";
import { CredentialManager }                         from "../../CredentialManager";
import { CredentialStatus }                          from "../../types/ICredential";

export class CredentialLoadCheck implements IStartupCheck {
  readonly name     = "credential-load";
  readonly severity = CheckSeverity.CRITICAL;

  private readonly manager: CredentialManager;

  constructor(manager: CredentialManager) {
    this.manager = manager;
  }

  async run(): Promise<CheckResult> {
    const result = await this.manager.load(true);

    if (!result.success) {
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  "Failed to load credentials from any configured source.",
        detail:   result.error,
      };
    }

    const invalid = result.credentials.filter(
      (c) => c.status !== CredentialStatus.VALID
    );

    if (invalid.length > 0) {
      const names = invalid.map((c) => `${c.key}(${c.status})`).join(", ");
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  `${invalid.length} credential(s) failed validation: ${names}`,
        detail:   "Check your credentials for placeholder or corrupted values.",
      };
    }

    return {
      name:    this.name,
      passed:  true,
      severity: this.severity,
      message: `${result.credentials.length} credential(s) loaded from "${result.source}" — all valid.`,
    };
  }
}
