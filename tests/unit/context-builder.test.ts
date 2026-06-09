import { ContextBuilder } from "../../src/context/ContextBuilder";

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

// ─── Mock ISender ─────────────────────────────────────────────────────────────
const mockSender = {
  sendText:     jest.fn(),
  sendTyping:   jest.fn(),
  sendReaction: jest.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMessageEvent(senderId: string, senderFbId?: string) {
  return {
    type:        "message" as const,
    senderId,
    senderFbId:  senderFbId ?? senderId,
    pageId:      "page-1",
    messageId:   "msg-1",
    text:        "/test",
    attachments: [],
    timestamp:   Date.now(),
  };
}

function makeUserService(role: "user" | "moderator" | "admin" | "owner" = "user") {
  return {
    findOrCreate: jest.fn().mockResolvedValue({
      fbId:         "user-1",
      name:         "Test User",
      role,
      messageCount: 0,
      lastSeenAt:   new Date(),
      createdAt:    new Date(),
      preferences:  {},
      isNew:        false,
    }),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ContextBuilder", () => {
  const OWNER_ID  = "owner-111";
  const ADMIN_ID  = "admin-222";
  const USER_ID   = "user-333";

  // ── Owner override ────────────────────────────────────────────────────────

  it("forces role=owner for users in ownerIds regardless of DB role", async () => {
    const builder = new ContextBuilder(mockSender as never, makeUserService("user") as never);
    builder.setOwnerIds([OWNER_ID]);

    const ctx = await builder.build(makeMessageEvent(OWNER_ID));
    expect(ctx.user.role).toBe("owner");
    expect(ctx.hasRole("owner")).toBe(true);
  });

  // ── Admin store override (THE CRITICAL FIX) ────────────────────────────────

  it("forces role=admin for users in AdminStore regardless of DB role", async () => {
    const builder = new ContextBuilder(mockSender as never, makeUserService("user") as never);
    builder.setAdminStore({ has: (id: string) => id === ADMIN_ID });

    const ctx = await builder.build(makeMessageEvent(ADMIN_ID));
    expect(ctx.user.role).toBe("admin");
    expect(ctx.hasRole("admin")).toBe(true);
  });

  it("ctx.hasRole('admin') returns TRUE for AdminStore member — the bug fix", async () => {
    // This is the exact scenario that was broken before:
    // User added via /مالك اضافة is in AdminStore but DB role is still "user"
    const builder = new ContextBuilder(mockSender as never, makeUserService("user") as never);
    builder.setAdminStore({ has: (id: string) => id === ADMIN_ID });

    const ctx = await builder.build(makeMessageEvent(ADMIN_ID));
    // Before fix: ctx.hasRole("admin") === false (AdminStore ignored)
    // After fix:  ctx.hasRole("admin") === true
    expect(ctx.hasRole("admin")).toBe(true);
  });

  it("admin store override does NOT demote owner to admin", async () => {
    const builder = new ContextBuilder(mockSender as never, makeUserService("user") as never);
    builder.setOwnerIds([OWNER_ID]);
    builder.setAdminStore({ has: () => true }); // admin store says "everyone is admin"

    const ctx = await builder.build(makeMessageEvent(OWNER_ID));
    // Owner should remain owner even if in AdminStore
    expect(ctx.user.role).toBe("owner");
  });

  it("regular user is NOT elevated when not in AdminStore", async () => {
    const builder = new ContextBuilder(mockSender as never, makeUserService("user") as never);
    builder.setAdminStore({ has: () => false }); // no one in admin store

    const ctx = await builder.build(makeMessageEvent(USER_ID));
    expect(ctx.user.role).toBe("user");
    expect(ctx.hasRole("admin")).toBe(false);
  });

  // ── No userService ────────────────────────────────────────────────────────

  it("falls back to role=user when no UserService is set", async () => {
    const builder = new ContextBuilder(mockSender as never);

    const ctx = await builder.build(makeMessageEvent(USER_ID));
    expect(ctx.user.role).toBe("user");
    expect(ctx.user.id).toBe(USER_ID);
  });

  it("applies owner override even without UserService", async () => {
    const builder = new ContextBuilder(mockSender as never);
    builder.setOwnerIds([OWNER_ID]);

    const ctx = await builder.build(makeMessageEvent(OWNER_ID));
    expect(ctx.user.role).toBe("owner");
  });

  it("applies admin override even without UserService", async () => {
    const builder = new ContextBuilder(mockSender as never);
    builder.setAdminStore({ has: (id) => id === ADMIN_ID });

    const ctx = await builder.build(makeMessageEvent(ADMIN_ID));
    expect(ctx.user.role).toBe("admin");
  });

  // ── UserService throws ────────────────────────────────────────────────────

  it("falls back gracefully when UserService throws", async () => {
    const brokenSvc = { findOrCreate: jest.fn().mockRejectedValue(new Error("MongoError")) };
    const builder   = new ContextBuilder(mockSender as never, brokenSvc as never);
    builder.setAdminStore({ has: (id) => id === ADMIN_ID });

    // Should not throw, and admin override should still apply
    const ctx = await builder.build(makeMessageEvent(ADMIN_ID));
    expect(ctx.user.role).toBe("admin"); // admin override works even on DB failure
    expect(ctx.user.id).toBe(ADMIN_ID);
  });

  it("falls back gracefully and regular user stays 'user' when UserService throws", async () => {
    const brokenSvc = { findOrCreate: jest.fn().mockRejectedValue(new Error("MongoError")) };
    const builder   = new ContextBuilder(mockSender as never, brokenSvc as never);

    const ctx = await builder.build(makeMessageEvent(USER_ID));
    expect(ctx.user.role).toBe("user");
  });
});
