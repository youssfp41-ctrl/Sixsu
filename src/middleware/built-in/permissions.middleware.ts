import { Context }     from "../../context/Context";
import { ICommand }    from "../../commands/types/ICommand";
import { IMiddleware } from "../types/IMiddleware";
import { LoggerManager } from "../../logger/LoggerManager";

const log = LoggerManager.getLogger("Middleware/Permissions");

export type PermissionCheck = (
  ctx:     Context,
  command: ICommand | null
) => boolean | Promise<boolean>;

export interface PermissionsOptions {
  adminIds?:    string[];
  adminStore?:  { has(id: string): boolean };
  allowlist?:   string[];
  blocklist?:   string[];
  check?:       PermissionCheck;
  denyMessage?: string;
}

export function createPermissionsMiddleware(opts: PermissionsOptions): IMiddleware {
  const adminSet = opts.adminIds  ? new Set(opts.adminIds)  : null;
  const allowSet = opts.allowlist ? new Set(opts.allowlist) : null;
  const blockSet = opts.blocklist ? new Set(opts.blocklist) : null;
  const denyMsg  = opts.denyMessage ?? "🚫 ليس لديك صلاحية لاستخدام هذا الأمر.";

  return {
    name:        "permissions",
    description: "Checks allowlist, blocklist, adminOnly flag, and custom permission check",
    handle: async (ctx, command, next) => {
      const userId = ctx.user.id;

      // 1. Blocklist — silently ignored
      if (blockSet?.has(userId)) {
        log.warn(`Permissions: user ${userId} is in blocklist — blocked silently.`);
        return;
      }

      // 2. Allowlist — silently ignored
      if (allowSet && !allowSet.has(userId)) {
        log.warn(`Permissions: user ${userId} not in allowlist — blocked silently.`);
        return;
      }

      // 3. Admin-only command
      if (command?.adminOnly) {
        // Check all three admin sources for consistency:
        //   A) Static adminIds set (from BOT_ADMIN_IDS env var)
        //   B) Dynamic AdminStore (runtime-added admins, backed by MongoDB)
        //   C) ctx.hasRole("admin") — MongoDB role OR AdminStore override in ContextBuilder
        //   D) ctx.hasRole("owner") — owners always have all permissions
        const isStaticAdmin  = adminSet?.has(userId)         ?? false;
        const isDynamicAdmin = opts.adminStore?.has(userId)  ?? false;
        const isRoleAdmin    = ctx.hasRole("admin");   // includes AdminStore override
        const isOwner        = ctx.hasRole("owner");
        const isAdmin        = isStaticAdmin || isDynamicAdmin || isRoleAdmin || isOwner;

        if (!isAdmin) {
          log.warn(
            `Permissions: user ${userId} tried admin-only command "${command.name}" — denied.`
          );
          await ctx.reply(denyMsg);
          return;
        }
      }

      // 4. Custom check — reply only when explicitly configured
      if (opts.check) {
        const allowed = await opts.check(ctx, command);
        if (!allowed) {
          log.warn(
            `Permissions: user ${userId} failed custom check for "${command?.name ?? "(no-command)"}".`
          );
          await ctx.reply(denyMsg);
          return;
        }
      }

      await next();
    },
  };
}
