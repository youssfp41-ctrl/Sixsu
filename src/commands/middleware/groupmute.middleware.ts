import { MiddlewareFn }              from "../../middleware/types/IMiddleware";
import { isMuted, recordActivity }   from "../../protection/GroupControlRegistry";

/**
 * groupMuteMiddleware
 *
 * Placed in the CommandPipeline right after the lockdown check.
 *
 * • Records last-activity for every thread that sends a command.
 * • Silently blocks command execution from any thread whose ID is in the
 *   muted set (toggled via "قروب كتم [n]" / "قروب فتح [n]" commands).
 */
export const groupMuteMiddleware: MiddlewareFn = async (ctx, _cmd, next) => {
  recordActivity(ctx.thread.id);

  if (isMuted(ctx.thread.id)) {
    return;                    // silently swallow — no reply to muted group
  }

  await next();
};
