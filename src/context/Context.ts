import { ISender }                                   from "../facebook/types/ISender";
import { ContextUser, ContextThread, ContextMessage } from "./types";
import type { UserRole }                              from "../users/types/IUserService";

export class Context {
  readonly user:        ContextUser;
  readonly thread:      ContextThread;
  readonly message:     ContextMessage;
  readonly args:        string[];
  readonly commandName: string;

  private readonly sender: ISender;

  constructor(
    user:    ContextUser,
    thread:  ContextThread,
    message: ContextMessage,
    sender:  ISender
  ) {
    this.user    = user;
    this.thread  = thread;
    this.message = message;
    this.sender  = sender;

    const parts      = (message.text ?? "").trim().split(/\s+/).filter(Boolean);
    this.commandName = parts[0]?.toLowerCase() ?? "";
    this.args        = parts.slice(1);
  }

  // ── Messaging ─────────────────────────────────────────────────────────

  /**
   * Send a text reply to the conversation.
   * Uses thread.id (the threadID / conversation ID) so replies go to the
   * correct group or DM regardless of who sent the message.
   */
  async reply(text: string): Promise<void> {
    await this.sender.sendText(this.thread.id, text);
  }

  /**
   * React to the current message in this conversation.
   * Uses thread.id to identify the correct conversation context.
   */
  async react(emoji: string): Promise<void> {
    await this.sender.sendReaction(this.message.id, this.thread.id, emoji);
  }

  /**
   * Send a typing indicator to this conversation.
   * Uses thread.id for correct targeting in group chats.
   */
  async typingOn(): Promise<void> {
    await this.sender.sendTyping(this.thread.id);
  }

  // ── Args helpers ──────────────────────────────────────────────────────

  hasArgs(): boolean {
    return this.args.length > 0;
  }

  getArg(index: number): string | undefined {
    return this.args[index];
  }

  getArgOrFail(index: number, errorMsg: string): string {
    const value = this.args[index];
    if (!value) throw new Error(errorMsg);
    return value;
  }

  getRemainingText(fromIndex = 0): string {
    return this.args.slice(fromIndex).join(" ");
  }

  // ── User profile helpers ──────────────────────────────────────────────

  /**
   * Returns the user's preference value for `key`,
   * or `defaultValue` if the preference is not set.
   */
  getPreference<T>(key: string, defaultValue: T): T {
    const val = this.user.preferences[key];
    return (val !== undefined ? val : defaultValue) as T;
  }

  /**
   * Returns true if the user's role is at least as privileged as `role`.
   * Hierarchy (ascending): user -> moderator -> admin -> owner
   */
  hasRole(role: UserRole): boolean {
    const hierarchy: UserRole[] = ["user", "moderator", "admin", "owner"];
    return hierarchy.indexOf(this.user.role) >= hierarchy.indexOf(role);
  }

  /** Convenience — true only on the user's very first message to the bot. */
  get isNewUser(): boolean {
    return this.user.isNew;
  }
}
