import { IStartupCheck, CheckResult, CheckSeverity } from "./IStartupCheck";
import { LoggerManager }                             from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("StartupValidator");

export interface ValidationReport {
  passed:         boolean;
  results:        CheckResult[];
  criticalFailed: string[];
  warnings:       string[];
  durationMs:     number;
}

export class StartupValidator {
  private readonly checks: IStartupCheck[] = [];

  add(check: IStartupCheck): this {
    this.checks.push(check);
    return this;
  }

  addMany(checks: IStartupCheck[]): this {
    checks.forEach((c) => this.add(c));
    return this;
  }

  async validate(): Promise<ValidationReport> {
    const start   = Date.now();
    const results: CheckResult[] = [];

    log.info(`StartupValidator: running ${this.checks.length} check(s)...`);
    log.info("─".repeat(50));

    for (const check of this.checks) {
      let result: CheckResult;
      try {
        result = await check.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result = {
          name:     check.name,
          passed:   false,
          severity: check.severity,
          message:  `Check threw an unexpected error: ${msg}`,
        };
      }

      results.push(result);
      this.logResult(result);
    }

    const criticalFailed = results
      .filter((r) => !r.passed && r.severity === CheckSeverity.CRITICAL)
      .map((r) => r.name);

    const warnings = results
      .filter((r) => !r.passed && r.severity === CheckSeverity.WARNING)
      .map((r) => r.name);

    const passed     = criticalFailed.length === 0;
    const durationMs = Date.now() - start;

    log.info("─".repeat(50));
    if (passed) {
      log.info(
        `StartupValidator: ✓ All critical checks passed. ` +
        `(${results.filter((r) => r.passed).length}/${results.length} passed, ${durationMs}ms)`
      );
    } else {
      log.error(
        `StartupValidator: ✗ ${criticalFailed.length} critical check(s) failed: ` +
        `[${criticalFailed.join(", ")}]`
      );
    }

    return { passed, results, criticalFailed, warnings, durationMs };
  }

  private logResult(result: CheckResult): void {
    const icon = result.passed ? "✓" : (result.severity === CheckSeverity.CRITICAL ? "✗" : "⚠");
    const fn   = result.passed
      ? (m: string) => log.info(m)
      : result.severity === CheckSeverity.CRITICAL
        ? (m: string) => log.error(m)
        : (m: string) => log.warn(m);

    fn(`  ${icon} [${result.name}] ${result.message}`);
    if (result.detail && !result.passed) {
      fn(`      └─ ${result.detail}`);
    }
  }
}
