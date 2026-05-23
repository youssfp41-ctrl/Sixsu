/**
 * CredentialGuard — validates credential values to prevent hardcoded or
 * placeholder data from reaching the bot runtime.
 */

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^your[-_]?\w*[-_]?(token|key|secret|password|appstate)[-_]?here$/i,
  /^(YOUR|MY)[-_]?(TOKEN|KEY|SECRET|PASSWORD|APPSTATE)$/i,
  /^(xxx+|000+|test|example|placeholder|changeme|replace_me|dummy|fake)$/i,
  /^<.+>$/,         // <TOKEN>
  /^\$\{.+\}$/,     // ${TOKEN}
  /^\{\{.+\}\}$/,   // {{TOKEN}}
];

const MIN_LENGTHS: Record<string, number> = {
  FB_PAGE_ACCESS_TOKEN: 50,
  FB_APP_SECRET:        20,
  FB_VERIFY_TOKEN:      6,
  SESSION_SECRET:       16,
  FB_APPSTATE:          20,
};

export interface GuardResult {
  valid:   boolean;
  reason?: string;
}

export class CredentialGuard {
  static validate(key: string, value: string): GuardResult {
    if (!value || value.trim().length === 0) {
      return { valid: false, reason: `"${key}" is empty.` };
    }

    const trimmed = value.trim();

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          valid:  false,
          reason: `"${key}" appears to be a placeholder value. Do not hardcode credentials.`,
        };
      }
    }

    const minLen = MIN_LENGTHS[key];
    if (minLen !== undefined && trimmed.length < minLen) {
      return {
        valid:  false,
        reason: `"${key}" is too short (${trimmed.length} chars, minimum ${minLen}).`,
      };
    }

    return { valid: true };
  }

  static validateAll(
    entries: Record<string, string>
  ): { key: string; result: GuardResult }[] {
    return Object.entries(entries).map(([key, value]) => ({
      key,
      result: CredentialGuard.validate(key, value),
    }));
  }
}
