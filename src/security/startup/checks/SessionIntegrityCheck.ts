import fs from "fs";
import { IStartupCheck, CheckResult, CheckSeverity } from "../IStartupCheck";
import { SessionStatus }                             from "../../../facebook/session/types/ISession";

export interface SessionIntegrityCheckOptions {
  sessionFilePath: string;
  severity?:       CheckSeverity;
}

interface RawSessionFile {
  version:  number;
  sessions: Record<string, { status: string; failCount: number; expiresAt: string | null }>;
}

export class SessionIntegrityCheck implements IStartupCheck {
  readonly name:     string = "session-integrity";
  readonly severity: CheckSeverity;
  private readonly filePath: string;

  constructor(opts: SessionIntegrityCheckOptions) {
    this.filePath = opts.sessionFilePath;
    this.severity = opts.severity ?? CheckSeverity.WARNING;
  }

  async run(): Promise<CheckResult> {
    if (!fs.existsSync(this.filePath)) {
      return {
        name:     this.name,
        passed:   true,
        severity: this.severity,
        message:  "No session file found — fresh start.",
        detail:   `Expected at: ${this.filePath}`,
      };
    }

    let raw: RawSessionFile;
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as RawSessionFile;
    } catch {
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  "Session file exists but cannot be parsed — may be corrupted.",
        detail:   `Path: ${this.filePath}`,
      };
    }

    const sessions  = Object.entries(raw.sessions ?? {});
    const corrupted: string[] = [];
    const expired:   string[] = [];
    const healthy:   string[] = [];

    for (const [id, s] of sessions) {
      if (s.status === SessionStatus.CORRUPTED) {
        corrupted.push(id);
        continue;
      }
      if (s.expiresAt && Date.now() > new Date(s.expiresAt).getTime()) {
        expired.push(id);
        continue;
      }
      healthy.push(id);
    }

    const issues: string[] = [];
    if (corrupted.length > 0) issues.push(`${corrupted.length} corrupted`);
    if (expired.length > 0)   issues.push(`${expired.length} expired`);

    if (corrupted.length > 0) {
      return {
        name:     this.name,
        passed:   false,
        severity: this.severity,
        message:  `Session integrity issues: ${issues.join(", ")}.`,
        detail:   `Corrupted: [${corrupted.join(", ")}]. Expired: [${expired.join(", ")}]. Healthy: [${healthy.join(", ")}].`,
      };
    }

    return {
      name:    this.name,
      passed:  true,
      severity: this.severity,
      message: expired.length > 0
        ? `${healthy.length} healthy session(s), ${expired.length} will be auto-renewed.`
        : `${healthy.length} session(s) healthy.`,
    };
  }
}
