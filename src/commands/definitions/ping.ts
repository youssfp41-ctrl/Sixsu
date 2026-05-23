import { ICommand } from "../types/ICommand";

export const command: ICommand = {
  name: "ping",
  aliases: ["p"],
  description: "يتحقق من أن البوت يعمل",
  usage: "/ping",

  execute: async (ctx) => {
    const uptime = Math.floor(process.uptime());
    await ctx.reply(`🏓 Pong! — uptime: ${uptime}s`);
  },
};
