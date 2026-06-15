import { IMiddleware }  from "../types/IMiddleware";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("Middleware/Cooldown");

export interface CooldownOptions {
  /**
   * Global cooldown duration in ms applied to all commands.
   * A command's own `cooldownMs` field overrides this if set.
   */
  durationMs: number;
  /** Custom reply when the user is on cooldown. */
  message?: (remainingSeconds: number, commandName: string) => string;
}

export function createCooldownMiddleware(opts: CooldownOptions): IMiddleware {
  /**
   * key = "botId:userId:commandName" → last execution timestamp
   *
   * botId  = ctx.thread.pageId (the bot account's Facebook user ID).
   * Including botId isolates each account's cooldown so that when two
   * bot accounts are in the same group, executing a command on account A
   * does NOT trigger the "please wait" message on account B for the same user.
   */
  const store = new Map<string, number>();
  const CLEANUP_AT = 2_000;

  return {
    name:        "cooldown",
    description: `Global ${opts.durationMs}ms cooldown (per-account, per-command override via ICommand.cooldownMs)`,
    handle: async (ctx, command, next) => {
      if (!command) {
        await next();
        return;
      }

      // Per-command override takes priority over global option
      const duration = command.cooldownMs ?? opts.durationMs;

      // Scope key to the bot account (pageId) so primary and secondary
      // accounts maintain independent cooldown stores.
      const botId    = ctx.thread.pageId || "default";
      const key      = `${botId}:${ctx.user.id}:${command.name}`;
      const now      = Date.now();
      const lastUsed = store.get(key) ?? 0;
      const remaining = duration - (now - lastUsed);

      if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1000);

        log.debug(
          `Cooldown active for user ${ctx.user.id} on command "${command.name}" (bot: ${botId}) — ` +
          `${seconds}s remaining.`
        );

        const msg =
          opts.message?.(seconds, command.name) ??
          `⏳ انتظر ${seconds} ثانية قبل استخدام هذا الأمر مرة أخرى.`;

        await ctx.reply(msg);
        return; // stop chain
      }

      store.set(key, now);

      // Periodic cleanup of stale entries
      if (store.size > CLEANUP_AT) {
        const maxDuration = Math.max(duration, opts.durationMs);
        const cutoff      = now - maxDuration * 2;
        for (const [k, ts] of store) {
          if (ts < cutoff) store.delete(k);
        }
        log.debug(`Cooldown store cleaned. Remaining entries: ${store.size}`);
      }

      await next();
    },
  };
}

