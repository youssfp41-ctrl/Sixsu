import { MiddlewareFn } from "../../middleware/types/IMiddleware";

export const loggingMiddleware: MiddlewareFn = async (ctx, command, next) => {
  const start = Date.now();
  console.log(
    `[Command] "${command?.name}" | user:${ctx.user.id} | args:[${ctx.args.join(", ")}]`
  );
  await next();
  console.log(
    `[Command] "${command?.name}" done in ${Date.now() - start}ms`
  );
};
