/**
 * Integration test — full permissions flow.
 *
 * Simulates the real sequence:
 *   1. Admin is added via /مالك اضافة (store.add + DB sync)
 *   2. Next message from that user goes through ContextBuilder
 *   3. ctx.hasRole("admin") returns true
 *   4. permissions.middleware passes the admin command through
 *   5. assertGroupAdmin-style check also passes (ctx.hasRole("admin") === true)
 *
 * This test specifically catches the ROOT CAUSE: the two-path admin check
 * (AdminStore vs ctx.hasRole) being out of sync.
 */

import { AdminStore } from "../../src/middleware/built-in/admin-store";
import { ContextBuilder } from "../../src/context/ContextBuilder";
import { createPermissionsMiddleware } from "../../src/middleware/built-in/permissions.middleware";
import type { ICommand } from "../../src/commands/types/ICommand";

// ─── Mock filesystem & logger ─────────────────────────────────────────────────
jest.mock("fs", () => ({
  existsSync:  jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_ID        = "61589140635720";
const NEW_ADMIN_ID    = "55500000000001"; // added dynamically via /مالك اضافة
const REGULAR_USER    = "55500000000099";

const mockSender = {
  sendText:     jest.fn(),
  sendTyping:   jest.fn(),
  sendReaction: jest.fn(),
};

function makeUserServiceWithRole(
  fbId: string,
  role: "user" | "admin" | "owner" = "user"
) {
  return {
    findOrCreate: jest.fn().mockResolvedValue({
      fbId,
      name:         "Test",
      role,
      messageCount: 1,
      lastSeenAt:   new Date(),
      createdAt:    new Date(),
      preferences:  {},
      isNew:        false,
    }),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMessageEvent(senderId: string) {
  return {
    type:        "message" as const,
    senderId,
    senderFbId:  senderId,
    pageId:      "page-1",
    messageId:   "msg-1",
    text:        "/حماية اسم",
    attachments: [],
    timestamp:   Date.now(),
  };
}

const adminOnlyCmd: ICommand = {
  name:      "حماية",
  adminOnly: true,
  category:  "util",
  async execute() {},
} as unknown as ICommand;

// ─── Scenario tests ───────────────────────────────────────────────────────────

describe("Full Permissions Flow — Add Admin → Use Admin Command", () => {

  let adminStore:   AdminStore;
  let builder:      ContextBuilder;
  let mw:           ReturnType<typeof createPermissionsMiddleware>;

  beforeEach(() => {
    adminStore = new AdminStore([]);  // No static seeds

    mw = createPermissionsMiddleware({
      adminIds:   [],
      adminStore,
    });
  });

  /**
   * THE PRIMARY BUG SCENARIO:
   *
   * Before fix:
   *   1. /مالك اضافة NEW_ADMIN_ID → adminStore.has(NEW_ADMIN_ID) = true
   *   2. ctx.hasRole("admin") = false (ContextBuilder ignores AdminStore)
   *   3. assertGroupAdmin check: !isGroupAdmin && !isBotAdmin → BLOCKED
   *
   * After fix:
   *   1. /مالك اضافة NEW_ADMIN_ID → adminStore.has(NEW_ADMIN_ID) = true
   *   2. ContextBuilder.build() sees adminStore.has → elevates role to "admin"
   *   3. ctx.hasRole("admin") = true → assertGroupAdmin check PASSES
   */
  it("BUG FIX: ctx.hasRole('admin') returns TRUE after admin is added to AdminStore", async () => {
    // Step 1: Owner adds the user as admin (simulating /مالك اضافة)
    adminStore.add(NEW_ADMIN_ID, OWNER_ID);

    // Step 2: Build context for the new admin's NEXT message
    // DB still returns role="user" (hasn't synced yet or no MongoDB)
    const userSvc = makeUserServiceWithRole(NEW_ADMIN_ID, "user");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    builder.setOwnerIds([OWNER_ID]);
    builder.setAdminStore(adminStore);  // Critical wiring

    const ctx = await builder.build(makeMessageEvent(NEW_ADMIN_ID));

    // Step 3: Verify the fix
    expect(ctx.hasRole("admin")).toBe(true);   // THE FIX
    expect(ctx.user.role).toBe("admin");       // Role elevated by ContextBuilder
  });

  it("permissions.middleware passes adminOnly command for AdminStore member", async () => {
    adminStore.add(NEW_ADMIN_ID, OWNER_ID);

    const userSvc = makeUserServiceWithRole(NEW_ADMIN_ID, "user");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    builder.setAdminStore(adminStore);

    const ctx  = await builder.build(makeMessageEvent(NEW_ADMIN_ID));
    const next = jest.fn().mockResolvedValue(undefined);
    await mw.handle(ctx as never, adminOnlyCmd, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("permissions.middleware STILL blocks a regular user from adminOnly command", async () => {
    const userSvc = makeUserServiceWithRole(REGULAR_USER, "user");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    builder.setAdminStore(adminStore);

    const ctx  = await builder.build(makeMessageEvent(REGULAR_USER));
    const next = jest.fn().mockResolvedValue(undefined);
    await mw.handle(ctx as never, adminOnlyCmd, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("removing admin from AdminStore immediately revokes permissions", async () => {
    // Add then remove
    adminStore.add(NEW_ADMIN_ID, OWNER_ID);
    adminStore.remove(NEW_ADMIN_ID);

    const userSvc = makeUserServiceWithRole(NEW_ADMIN_ID, "user");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    builder.setAdminStore(adminStore);

    const ctx = await builder.build(makeMessageEvent(NEW_ADMIN_ID));
    expect(ctx.hasRole("admin")).toBe(false);

    const next = jest.fn().mockResolvedValue(undefined);
    await mw.handle(ctx as never, adminOnlyCmd, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("owner is unaffected by admin store changes (always has owner role)", async () => {
    const userSvc = makeUserServiceWithRole(OWNER_ID, "user");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    builder.setOwnerIds([OWNER_ID]);
    builder.setAdminStore(adminStore);

    const ctx = await builder.build(makeMessageEvent(OWNER_ID));
    expect(ctx.user.role).toBe("owner");
    expect(ctx.hasRole("admin")).toBe(true);
    expect(ctx.hasRole("owner")).toBe(true);
  });

  it("MongoDB-backed admin (role=admin in DB) also gets ctx.hasRole('admin') = true", async () => {
    // When MongoDB is working, the DB returns role="admin" directly
    const userSvc = makeUserServiceWithRole(NEW_ADMIN_ID, "admin");
    builder = new ContextBuilder(mockSender as never, userSvc as never);
    // No adminStore override needed — DB role is the source of truth when working
    builder.setAdminStore(adminStore);

    const ctx = await builder.build(makeMessageEvent(NEW_ADMIN_ID));
    expect(ctx.hasRole("admin")).toBe(true);
  });
});
