import fs   from "fs";
import path from "path";
import { config } from "../config/env";

const DATA_PATH = path.resolve("data/prefix.json");

function loadSaved(): string | null {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as { prefix?: string };
      if (typeof raw.prefix === "string" && raw.prefix.length > 0) {
        return raw.prefix;
      }
    }
  } catch { /* ignore — use env default */ }
  return null;
}

class PrefixStore {
  private _prefix: string;

  constructor() {
    const saved  = loadSaved();
    this._prefix = saved ?? config.bot.prefix ?? "/";
  }

  get(): string {
    return this._prefix;
  }

  set(newPrefix: string): void {
    this._prefix = newPrefix;
    this._persist();
  }

  private _persist(): void {
    try {
      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_PATH, JSON.stringify({ prefix: this._prefix }, null, 2), "utf8");
    } catch { /* best effort */ }
  }
}

export const prefixStore = new PrefixStore();
