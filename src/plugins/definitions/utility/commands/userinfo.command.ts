import { ICommand }          from "../../../../commands/types/ICommand";
import { IPluginContext }     from "../../../types/IPluginContext";
import {
  IFacebookProfileService,
  IResponseBuilder,
  SERVICES,
} from "../services/IUtilityServices";

/**
 * /userinfo — shows identity and conversation details for the current user.
 *
 * Base data comes from Context (always available).
 * If "fb-profile-service" is available, enriches with the real display name
 * from the Graph API; otherwise falls back to ctx.user.name.
 */
export function createUserinfoCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name:        "userinfo",
    aliases:     ["ui", "whoami"],
    description: "يعرض معلومات المستخدم الحالي والمحادثة",
    usage:       "/userinfo",
    category:    "utility",

    async execute(ctx) {
      const fmt        = pluginCtx.consumeService<IResponseBuilder>(SERVICES.RESPONSE_BUILDER);
      const profileSvc = pluginCtx.consumeService<IFacebookProfileService>(SERVICES.FB_PROFILE);

      await ctx.typingOn();

      // Start with what the Context already knows
      let displayName: string = ctx.user.name ?? "—";
      let avatarUrl:   string | undefined;

      // Enrich from Graph API when available
      if (profileSvc) {
        try {
          const profile = await profileSvc.getProfile(ctx.user.id);
          displayName = profile.name;
          avatarUrl   = profile.profilePic;
        } catch (err) {
          pluginCtx.logger.warn(
            `userinfo: Graph API fetch failed for ${ctx.user.id}, using context data.`
          );
        }
      }

      const ts      = new Date(ctx.message.timestamp);
      const timeStr = ts.toLocaleString("ar-SA", {
        dateStyle: "short",
        timeStyle: "medium",
        hour12:    true,
      });

      const lines = [
        `👤  الاسم:        ${displayName}`,
        `🆔  المعرف:       ${ctx.user.id}`,
        `💬  المحادثة:     ${ctx.thread.id}`,
        `📄  الصفحة:       ${ctx.thread.pageId}`,
        `🕐  وقت الرسالة:  ${timeStr}`,
        avatarUrl ? `🖼️  الصورة:       ${avatarUrl}` : "",
      ].filter(Boolean);

      const reply = fmt
        ? fmt.success("معلومات المستخدم", lines)
        : lines.join("\n");

      await ctx.reply(reply);
    },
  };
}
