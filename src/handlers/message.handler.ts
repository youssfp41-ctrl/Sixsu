import { Context }          from "../context/Context";
import { CommandPipeline }  from "../commands/CommandPipeline";
import { CommandRegistry }  from "../commands/CommandRegistry";
import { TaskScheduler }    from "../scheduler";
import { ReconnectManager } from "../facebook/reconnect/ReconnectManager";
import { BanStore }         from "../middleware/built-in/banned.middleware";
import type { IUserService } from "../users/types/IUserService";
import { LoggerManager }    from "../logger/LoggerManager";

const log = LoggerManager.getLogger("MessageHandler");

// ── Singleton references (wired by bootstrap) ─────────────────────────────

let pipeline:         CommandPipeline  | undefined;
let registry:         CommandRegistry  | undefined;
let scheduler:        TaskScheduler    | undefined;
let reconnectManager: ReconnectManager | undefined;
let banStore:         BanStore         | undefined;
let userService:      IUserService     | undefined;

export function setCommandPipeline(p: CommandPipeline):   void { pipeline         = p; }
export function setCommandRegistry(r: CommandRegistry):   void { registry         = r; }
export function setTaskScheduler(s: TaskScheduler):       void { scheduler        = s; }
export function setReconnectManager(r: ReconnectManager): void { reconnectManager = r; }
export function setBanStore(b: BanStore):                 void { banStore         = b; }
export function setUserService(s: IUserService):          void { userService      = s; }

export function getCommandPipeline():  CommandPipeline  | undefined { return pipeline;         }
export function getCommandRegistry():  CommandRegistry  | undefined { return registry;         }
export function getTaskScheduler():    TaskScheduler    | undefined { return scheduler;        }
export function getReconnectManager(): ReconnectManager | undefined { return reconnectManager; }
export function getBanStore():         BanStore         | undefined { return banStore;         }
export function getUserService():      IUserService     | undefined { return userService;      }

// ── Entry point ───────────────────────────────────────────────────────────

export async function handleMessage(ctx: Context): Promise<void> {
  const msgType = ctx.message.isPostback
    ? "postback"
    : ctx.message.attachments.length > 0
      ? "attachment"
      : ctx.message.text
        ? "text"
        : "empty";

  // ── [DEBUG-4] Message routing decision ──────────────────────────────────
  log.info("MessageHandler: routing message.", {
    userId:          ctx.user.id,
    role:            ctx.user.role,
    msgType,
    text:            (ctx.message.text ?? "").slice(0, 80),
    attachmentCount: ctx.message.attachments.length,
    postbackPayload: ctx.message.postbackPayload?.slice(0, 80),
  });

  if (ctx.message.isPostback) {
    await handlePostback(ctx);
    return;
  }

  if (ctx.message.attachments.length > 0) {
    await handleAttachment(ctx);
    return;
  }

  if (ctx.message.text) {
    await handleText(ctx);
    return;
  }

  log.debug("MessageHandler: message has no actionable content — skipping.", {
    userId: ctx.user.id,
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────

async function handleText(ctx: Context): Promise<void> {
  if (!pipeline) {
    log.warn("CommandPipeline not wired — echoing raw text.", {
      userId: ctx.user.id,
      text:   ctx.message.text,
    });
    await ctx.reply(`استقبلت: ${ctx.message.text}`);
    return;
  }

  // ── [DEBUG-4b] Entering middleware chain ─────────────────────────────────
  log.info("MessageHandler: entering command pipeline.", {
    userId:      ctx.user.id,
    commandName: ctx.commandName ?? "(none)",
    text:        (ctx.message.text ?? "").slice(0, 80),
  });

  await pipeline.run(ctx);
}

async function handleAttachment(ctx: Context): Promise<void> {
  log.info("MessageHandler: attachment received.", {
    userId: ctx.user.id,
    types:  ctx.message.attachments.map((a) => a.type),
  });
  await ctx.reply("تم استقبال المرفق.");
}

async function handlePostback(ctx: Context): Promise<void> {
  log.info("MessageHandler: postback received.", {
    userId:  ctx.user.id,
    payload: ctx.message.postbackPayload,
  });
  await ctx.reply(`Postback: ${ctx.message.postbackPayload}`);
}
