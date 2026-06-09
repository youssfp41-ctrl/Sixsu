import { createPermissionsMiddleware } from "../../src/middleware/built-in/permissions.middleware";
import type { ICommand } from "../../src/commands/types/ICommand";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

type UserRole = "user" | "moderator" | "admin" | "owner";

function makeCtx(
  userId: string,
  role: UserRole = "user"
) {
  return {
    user:    { id: userId, role },
    thread:  { id: "thread-1" },
    message: { text: "/test" },
    reply:   jest.fn().mockResolvedValue(undefined),
    hasRole(r: UserRole): boolean {
      const hierarchy: UserRole[] = ["user", "moderator", "admin", "owner"];
      return hierarchy.indexOf(role) >= hierarchy.indexOf(r);
    },
  };
}

function makeAdminCommand(): ICommand {
  return {
    name:      "testAdmin",
    adminOnly: true,
    category:  "test",
    async execute() {},
  } as unknown as ICommand;
}

function makePublicCommand(): ICommand {
  return {
    name:      "testPublic",
    adminOnly: false,
    category:  "test",
    async execute() {},
  } as unknown as ICommand;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createPermissionsMiddleware", () => {
  const STATIC_ADMIN  = "static-admin-id";
  const DYNAMIC_ADMIN = "dynamic-admin-id";
  const DB_ADMIN      = "db-admin-id";
  const REGULAR_USER  = "regular-user-id";
  const OWNER_USER    = "owner-user-id";

  const adminStore = {
    has: (id: string) => id === DYNAMIC_ADMIN,
  };

  const mw = createPermissionsMiddleware({
    adminIds:   [STATIC_ADMIN],
    adminStore,
  });

  function run(ctx: ReturnType<typeof makeCtx>, cmd: ICommand) {
    const next = jest.fn().mockResolvedValue(undefined);
    return mw.handle(ctx as never, cmd, next).then(() => next);
  }

  // ── Public command (no restriction) ──────────────────────────────────────

  it("allows any user to run a public command", async () => {
    const next = await run(makeCtx(REGULAR_USER, "user"), makePublicCommand());
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Admin-only command — static admin list ────────────────────────────────

  it("allows static admin (BOT_ADMIN_IDS) to run adminOnly command", async () => {
    const next = await run(makeCtx(STATIC_ADMIN, "user"), makeAdminCommand());
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Admin-only command — dynamic AdminStore ───────────────────────────────

  it("allows dynamic AdminStore admin to run adminOnly command", async () => {
    const next = await run(makeCtx(DYNAMIC_ADMIN, "user"), makeAdminCommand());
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Admin-only command — ctx.hasRole("admin") (MongoDB / ContextBuilder) ─

  it("allows user with role=admin in context to run adminOnly command", async () => {
    // This is the critical regression test:
    // After the ContextBuilder fix, users added via /مالك اضافة get role="admin"
    // in ctx, so ctx.hasRole("admin") returns true here.
    const next = await run(makeCtx(DB_ADMIN, "admin"), makeAdminCommand());
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Admin-only command — owner always allowed ─────────────────────────────

  it("allows owner to run adminOnly command", async () => {
    const next = await run(makeCtx(OWNER_USER, "owner"), makeAdminCommand());
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Admin-only command — regular user blocked ─────────────────────────────

  it("silently blocks regular user from adminOnly command", async () => {
    const ctx  = makeCtx(REGULAR_USER, "user");
    const next = await run(ctx, makeAdminCommand());
    expect(next).not.toHaveBeenCalled();
    // No reply sent (silent drop)
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  // ── Blocklist ─────────────────────────────────────────────────────────────

  it("silently blocks a user in blocklist even for public commands", async () => {
    const BLOCKED = "blocked-user";
    const mwBlocked = createPermissionsMiddleware({ blocklist: [BLOCKED] });
    const ctx  = makeCtx(BLOCKED, "user");
    const next = jest.fn().mockResolvedValue(undefined);
    await mwBlocked.handle(ctx as never, makePublicCommand(), next);
    expect(next).not.toHaveBeenCalled();
  });

  // ── Allowlist ─────────────────────────────────────────────────────────────

  it("blocks a user NOT in allowlist", async () => {
    const ALLOWED = "allowed-user";
    const mwAllow = createPermissionsMiddleware({ allowlist: [ALLOWED] });
    const ctx  = makeCtx("other-user", "user");
    const next = jest.fn().mockResolvedValue(undefined);
    await mwAllow.handle(ctx as never, makePublicCommand(), next);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a user that IS in allowlist", async () => {
    const ALLOWED = "allowed-user";
    const mwAllow = createPermissionsMiddleware({ allowlist: [ALLOWED] });
    const ctx  = makeCtx(ALLOWED, "user");
    const next = jest.fn().mockResolvedValue(undefined);
    await mwAllow.handle(ctx as never, makePublicCommand(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // ── Custom check ─────────────────────────────────────────────────────────

  it("calls custom check and allows when it returns true", async () => {
    const mwCustom = createPermissionsMiddleware({ check: async () => true });
    const ctx  = makeCtx(REGULAR_USER, "user");
    const next = jest.fn().mockResolvedValue(undefined);
    await mwCustom.handle(ctx as never, makePublicCommand(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls custom check and replies with denyMessage when it returns false", async () => {
    const DENY_MSG = "custom deny";
    const mwCustom = createPermissionsMiddleware({
      check:       async () => false,
      denyMessage: DENY_MSG,
    });
    const ctx  = makeCtx(REGULAR_USER, "user");
    const next = jest.fn().mockResolvedValue(undefined);
    await mwCustom.handle(ctx as never, makePublicCommand(), next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(DENY_MSG);
  });
});
