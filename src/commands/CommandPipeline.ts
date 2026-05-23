import { Context } from "../context/Context";
import { CommandRegistry } from "./CommandRegistry";
import { MiddlewareChain } from "../middleware/MiddlewareChain";
import { IMiddleware, MiddlewareFn } from "../middleware/types/IMiddleware";

export type NotFoundHandler = (ctx: Context) => Promise<void>;

export class CommandPipeline {
  private readonly registry: CommandRegistry;
  private readonly chain: MiddlewareChain;
  private readonly prefix: string;
  private notFoundHandler?: NotFoundHandler;

  constructor(registry: CommandRegistry, prefix = "") {
    this.registry = registry;
    this.chain = new MiddlewareChain();
    this.prefix = prefix;
  }

  use(middleware: MiddlewareFn | IMiddleware): this {
    this.chain.use(middleware);
    return this;
  }

  onNotFound(handler: NotFoundHandler): this {
    this.notFoundHandler = handler;
    return this;
  }

  async run(ctx: Context): Promise<void> {
    let rawName = ctx.commandName;

    if (this.prefix) {
      if (!rawName.startsWith(this.prefix)) return;
      rawName = rawName.slice(this.prefix.length);
    }

    if (!rawName) return;

    const command = this.registry.resolve(rawName);

    if (!command) {
      await this.notFoundHandler?.(ctx);
      return;
    }

    await this.chain.execute(ctx, command, async (_ctx, cmd) => {
      await cmd!.execute(_ctx);
    });
  }
}
