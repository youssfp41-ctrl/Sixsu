import fs   from "fs";
import path from "path";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("AdminStore");

// ─── File-based fallback ──────────────────────────────────────────────────────

interface StoreData {
  admins: string[];
}

const DATA_PATH = path.resolve("data/admin-store.json");

function loadFromFile(seedIds: string[]): Set<string> {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) as StoreData;
      return new Set([...seedIds, ...(data.admins ?? [])]);
    }
  } catch {
    // corrupt file — start fresh with seeds
  }
  return new Set(seedIds);
}

function saveToFile(admins: Set<string>): void {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ admins: Array.from(admins) }, null, 2),
      "utf8"
    );
  } catch (err) {
    log.warn("AdminStore: failed to write file fallback.", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── MongoDB repo interface (loose coupling) ──────────────────────────────────

interface IBotAdminRepository {
  findAll(): Promise<string[]>;
  add(fbId: string, addedBy: string): Promise<void>;
  remove(fbId: string): Promise<boolean>;
}

// ─── AdminStore ───────────────────────────────────────────────────────────────

export class AdminStore {
  private readonly admins:  Set<string>;
  private readonly seedIds: string[];
  private repo: IBotAdminRepository | null = null;

  constructor(seedIds: string[] = []) {
    this.seedIds = seedIds;
    this.admins  = loadFromFile(seedIds);
    log.info(`AdminStore initialised — ${this.admins.size} admin(s) (file/seed).`);
  }

  // ── MongoDB wiring (called after DB connects) ───────────────────────────────

  setRepository(repo: IBotAdminRepository): void {
    this.repo = repo;
    log.debug("AdminStore: MongoDB repository attached.");
  }

  /**
   * Load admins from MongoDB and merge with current in-memory set.
   * Called once after the DB connection is established.
   */
  async loadFromDatabase(): Promise<void> {
    if (!this.repo) return;

    try {
      const dbIds = await this.repo.findAll();

      // Persist seed IDs to MongoDB so they survive on subsequent restarts
      for (const id of this.seedIds) {
        if (!dbIds.includes(id)) {
          try {
            await this.repo.add(id, "system:seed");
          } catch {
            // May already exist — tolerate duplicate upsert errors
          }
        }
      }

      // Merge DB admins into in-memory set
      for (const id of dbIds) {
        this.admins.add(id);
      }

      log.info(`AdminStore: loaded from MongoDB — ${this.admins.size} admin(s) total.`);
    } catch (err) {
      log.warn("AdminStore: failed to load from MongoDB — using file/seed data.", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  add(id: string, addedBy = "system"): void {
    this.admins.add(id);

    // Sync to MongoDB (background — never block the command handler)
    if (this.repo) {
      this.repo.add(id, addedBy).catch((err: unknown) => {
        log.warn("AdminStore: MongoDB add failed — admin is still active in memory.", {
          id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      saveToFile(this.admins);
    }

    log.info(`Admin added: ${id}`);
  }

  remove(id: string): boolean {
    const existed = this.admins.delete(id);

    if (existed) {
      if (this.repo) {
        this.repo.remove(id).catch((err: unknown) => {
          log.warn("AdminStore: MongoDB remove failed — admin is removed in memory.", {
            id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else {
        saveToFile(this.admins);
      }
      log.info(`Admin removed: ${id}`);
    }

    return existed;
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

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
