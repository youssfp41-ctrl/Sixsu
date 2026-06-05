import fs   from "fs";
import path from "path";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("AdminStore");

// ─── Persistence ─────────────────────────────────────────────────────────────

interface StoreData {
  admins: string[];
}

const DATA_PATH = path.resolve("data/admin-store.json");

function loadStore(seedIds: string[]): Set<string> {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
      const merged = new Set([...seedIds, ...(data.admins ?? [])]);
      return merged;
    }
  } catch {
    /* corrupt file — start fresh with seeds */
  }
  return new Set(seedIds);
}

function saveStore(admins: Set<string>): void {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data: StoreData = { admins: Array.from(admins) };
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
}

// ─── AdminStore ───────────────────────────────────────────────────────────────

export class AdminStore {
  private readonly admins: Set<string>;

  constructor(seedIds: string[] = []) {
    this.admins = loadStore(seedIds);
    log.info(`AdminStore initialised — ${this.admins.size} admin(s).`);
  }

  add(id: string): void {
    this.admins.add(id);
    saveStore(this.admins);
    log.info(`Admin added: ${id}`);
  }

  remove(id: string): boolean {
    const existed = this.admins.delete(id);
    if (existed) {
      saveStore(this.admins);
      log.info(`Admin removed: ${id}`);
    }
    return existed;
  }

  has(id: string): boolean {
    return this.admins.has(id);
  }

  getAll(): string[] {
    return Array.from(this.admins);
  }

  size(): number {
    return this.admins.size;
  }
}
