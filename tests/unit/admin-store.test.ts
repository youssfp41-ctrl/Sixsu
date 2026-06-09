import { AdminStore } from "../../src/middleware/built-in/admin-store";

// ─── Mock filesystem ──────────────────────────────────────────────────────────
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
jest.mock("../../src/logger/LoggerManager", () => ({
  LoggerManager: {
    getLogger: () => ({
      info:  jest.fn(),
      warn:  jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

describe("AdminStore", () => {
  const SEED_ADMIN = "111";
  const EXTRA_ID   = "999";

  let store: AdminStore;

  beforeEach(() => {
    store = new AdminStore([SEED_ADMIN]);
  });

  // ── Initialisation ────────────────────────────────────────────────────────

  it("contains the seed admin IDs on initialisation", () => {
    expect(store.has(SEED_ADMIN)).toBe(true);
  });

  it("does not contain unrelated IDs", () => {
    expect(store.has(EXTRA_ID)).toBe(false);
  });

  it("reports correct initial size", () => {
    expect(store.size()).toBe(1);
  });

  // ── add ───────────────────────────────────────────────────────────────────

  it("adds a new admin ID", () => {
    store.add(EXTRA_ID);
    expect(store.has(EXTRA_ID)).toBe(true);
  });

  it("size increases after add", () => {
    store.add(EXTRA_ID);
    expect(store.size()).toBe(2);
  });

  it("add is idempotent — no duplicates in getAll()", () => {
    store.add(SEED_ADMIN);
    store.add(SEED_ADMIN);
    const all = store.getAll();
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  // ── remove ────────────────────────────────────────────────────────────────

  it("removes an existing admin ID", () => {
    store.add(EXTRA_ID);
    const wasRemoved = store.remove(EXTRA_ID);
    expect(wasRemoved).toBe(true);
    expect(store.has(EXTRA_ID)).toBe(false);
  });

  it("returns false when removing a non-existent ID", () => {
    expect(store.remove("does-not-exist")).toBe(false);
  });

  it("size decreases after remove", () => {
    store.add(EXTRA_ID);
    store.remove(EXTRA_ID);
    expect(store.size()).toBe(1);
  });

  // ── getAll ────────────────────────────────────────────────────────────────

  it("getAll returns all admins", () => {
    store.add(EXTRA_ID);
    const all = store.getAll();
    expect(all).toContain(SEED_ADMIN);
    expect(all).toContain(EXTRA_ID);
    expect(all).toHaveLength(2);
  });

  // ── MongoDB wiring ────────────────────────────────────────────────────────

  it("setRepository + loadFromDatabase merges DB admins into in-memory set", async () => {
    const DB_ADMIN = "777";
    const mockRepo = {
      findAll: jest.fn().mockResolvedValue([DB_ADMIN]),
      add:     jest.fn().mockResolvedValue(undefined),
      remove:  jest.fn().mockResolvedValue(true),
    };

    store.setRepository(mockRepo);
    await store.loadFromDatabase();

    expect(store.has(DB_ADMIN)).toBe(true);
    expect(store.has(SEED_ADMIN)).toBe(true);
    expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
  });

  it("loadFromDatabase seeds static IDs to MongoDB if missing", async () => {
    const mockRepo = {
      findAll: jest.fn().mockResolvedValue([]), // DB is empty
      add:     jest.fn().mockResolvedValue(undefined),
      remove:  jest.fn().mockResolvedValue(true),
    };

    store.setRepository(mockRepo);
    await store.loadFromDatabase();

    // Seed admin should be pushed to MongoDB
    expect(mockRepo.add).toHaveBeenCalledWith(SEED_ADMIN, "system:seed");
  });

  it("add() calls repo.add() when repository is set", () => {
    const mockRepo = {
      findAll: jest.fn().mockResolvedValue([]),
      add:     jest.fn().mockResolvedValue(undefined),
      remove:  jest.fn().mockResolvedValue(true),
    };

    store.setRepository(mockRepo);
    store.add(EXTRA_ID, "owner:123");

    // Fire-and-forget — just check it was called
    expect(mockRepo.add).toHaveBeenCalledWith(EXTRA_ID, "owner:123");
  });

  it("remove() calls repo.remove() when repository is set", () => {
    const mockRepo = {
      findAll: jest.fn().mockResolvedValue([]),
      add:     jest.fn().mockResolvedValue(undefined),
      remove:  jest.fn().mockResolvedValue(true),
    };

    store.setRepository(mockRepo);
    store.add(EXTRA_ID);
    store.remove(EXTRA_ID);

    expect(mockRepo.remove).toHaveBeenCalledWith(EXTRA_ID);
  });

  it("loadFromDatabase gracefully handles MongoDB errors", async () => {
    const mockRepo = {
      findAll: jest.fn().mockRejectedValue(new Error("MongoNetworkError")),
      add:     jest.fn(),
      remove:  jest.fn(),
    };

    store.setRepository(mockRepo);
    // Should not throw
    await expect(store.loadFromDatabase()).resolves.toBeUndefined();
    // Seed data is preserved
    expect(store.has(SEED_ADMIN)).toBe(true);
  });
});
