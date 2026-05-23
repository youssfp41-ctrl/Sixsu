export enum CheckSeverity {
  /** Failure stops the bot from starting. */
  CRITICAL = "CRITICAL",
  /** Failure is logged but bot continues. */
  WARNING  = "WARNING",
  /** Always logged, never fails startup. */
  INFO     = "INFO",
}

export interface CheckResult {
  name:     string;
  passed:   boolean;
  severity: CheckSeverity;
  message:  string;
  detail?:  string;
}

export interface IStartupCheck {
  readonly name:     string;
  readonly severity: CheckSeverity;
  run(): Promise<CheckResult>;
}
