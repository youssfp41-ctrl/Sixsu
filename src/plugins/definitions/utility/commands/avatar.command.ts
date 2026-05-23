import { ICommand }          from "../../../../commands/types/ICommand";
import { IPluginContext }     from "../../../types/IPluginContext";
import {
  IFacebookProfileService,
  IResponseBuilder,
  SERVICES,
} from "../services/IUtilityServices";

/**
 * /avatar — fetches and shows the user's Facebook profile picture URL.
 *
 * Requires "fb-profile-service" (registered by utility plugin on enable).
 * Falls back gracefully if the service or profile picture is unavailable.
 */
export function createAvatarCommand(pluginCtx: IPluginContext): ICommand {
  return {
    name:        "avatar",
    aliases:     ["av", "pfp"],
    description: "يعرض رابط صورة الملف الشخصي",
    usage:       "/avatar",
    category:    "utility",

    async execute(ctx) {
      const fmt        = pluginCtx.consumeService<IResponseBuilder>(SERVICES.RESPONSE_BUILDER);
      const profileSvc = pluginCtx.consumeService<IFacebookProfileService>(SERVICES.FB_PROFILE);

      if (!profileSvc) {
        await ctx.reply(
          fmt?.warn("خدمة Profile غير متاحة — تحقق من FB_PAGE_ACCESS_TOKEN.")
            ?? "⚠️ الخدمة غير متاحة."
        );
        return;
      }

      try {
        await ctx.typingOn();
        const profile = await profileSvc.getProfile(ctx.user.id);

        if (!profile.profilePic) {
          await ctx.reply(
            fmt?.warn("لا تتوفر صورة ملف شخصي لهذا الحساب.")
              ?? "⚠️ لا توجد صورة."
          );
          return;
        }

        const lines = [
          `👤  ${profile.name}`,
          `🆔  ${profile.id}`,
          ``,
          `🖼️  ${profile.profilePic}`,
        ];

        await ctx.reply(fmt ? fmt.info(lines) : lines.join("\n"));
      } catch (err) {
        pluginCtx.logger.error("avatar: failed to fetch profile.", err);
        await ctx.reply(
          fmt?.warn("تعذّر جلب صورة الملف الشخصي. حاول مرة أخرى.")
            ?? "⚠️ حدث خطأ أثناء جلب الصورة."
        );
      }
    },
  };
}
