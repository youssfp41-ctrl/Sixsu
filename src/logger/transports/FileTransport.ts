import fs from "fs";
import path from "path";
import { ITransport } from "../types/ITransport";
import { LogEntry, LogLevel } from "../types/ILogger";

export interface FileTransportOptions {
  dir: string;
  combined?: string;
  errors?: string;
  maxSizeBytes?: number;
}

function formatEntry(entry: LogEntry): string {
  const record: Record<string, unknown> = {
    timestamp: entry.timestamp.toISOString(),
    level:     entry.level,
    message:   entry.message,
  };

  if (entry.context) record["context"] = entry.context;
  if (entry.meta)    record["meta"]    = entry.meta;

  if (entry.error) {
    record["error"] = {
      message: entry.error.message,
      stack:   entry.error.stack,
      name:    entry.error.name,
    };
  }

  return JSON.stringify(record);
}

function resolveDaily(dir: string, base: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const ext  = path.extname(base);
  const name = path.basename(base, ext);
  return path.join(dir, `${name}-${date}${ext}`);
}

export class FileTransport implements ITransport {
  readonly name = "file";

  private readonly dir:      string;
  private readonly combined: string;
  private readonly errors:   string;
  private readonly maxSize:  number;

  constructor(options: FileTransportOptions) {
    this.dir      = path.resolve(options.dir);
    this.combined = options.combined ?? "combined.log";
    this.errors   = options.errors   ?? "error.log";
    this.maxSize  = options.maxSizeBytes ?? 10 * 1024 * 1024;

    fs.mkdirSync(this.dir, { recursive: true });
  }

  write(entry: LogEntry): void {
    const line = formatEntry(entry) + "\n";

    this.append(resolveDaily(this.dir, this.combined), line);

    if (entry.level === LogLevel.ERROR || entry.level === LogLevel.WARN) {
      this.append(resolveDaily(this.dir, this.errors), line);
    }
  }

  private append(filePath: string, data: string): void {
    try {
      this.rotateIfNeeded(filePath);
      fs.appendFileSync(filePath, data, "utf8");
    } catch {
      /* intentionally silent — file errors should not crash the app */
    }
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= this.maxSize) {
        const rotated = filePath.replace(/(\.\w+)$/, `.${Date.now()}$1`);
        fs.renameSync(filePath, rotated);
      }
    } catch {
      /* file doesn't exist yet — that's fine */
    }
  }
}
