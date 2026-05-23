import { config } from "./config/env";
import { createApp } from "./app";

async function bootstrap(): Promise<void> {
  const app = createApp();

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => {
      console.log(`[Bot] Running on port ${config.port} [${config.nodeEnv}]`);
      resolve();
    });

    server.on("error", (err: Error) => {
      console.error("[Bot] Failed to start server:", err.message);
      reject(err);
    });
  });
}

bootstrap().catch((err: unknown) => {
  console.error("[Boot] Fatal error during startup:", err);
  process.exit(1);
});
