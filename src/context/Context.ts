import { MessengerService } from "../services/messenger.service";
import { ContextUser, ContextThread, ContextMessage } from "./types";

export class Context {
  readonly user: ContextUser;
  readonly thread: ContextThread;
  readonly message: ContextMessage;
  readonly args: string[];
  readonly commandName: string;

  private readonly messenger: MessengerService;

  constructor(
    user: ContextUser,
    thread: ContextThread,
    message: ContextMessage,
    messenger: MessengerService
  ) {
    this.user = user;
    this.thread = thread;
    this.message = message;
    this.messenger = messenger;

    const parts = (message.text ?? "").trim().split(/\s+/).filter(Boolean);
    this.commandName = parts[0]?.toLowerCase() ?? "";
    this.args = parts.slice(1);
  }

  async reply(text: string): Promise<void> {
    await this.messenger.sendText(this.user.id, text);
  }

  async react(emoji: string): Promise<void> {
    await this.messenger.sendReaction(this.message.id, this.user.id, emoji);
  }

  async typingOn(): Promise<void> {
    await this.messenger.sendTypingOn(this.user.id);
  }

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
}
