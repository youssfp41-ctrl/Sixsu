import { MiddlewareFn } from "../../middleware/types/IMiddleware";

export const typingMiddleware: MiddlewareFn = async (ctx, _command, next) => {
  await ctx.typingOn();
  await next();
};
