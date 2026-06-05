import path    from "path";
import express from "express";
import { config } from "./config/env";
import { LoggerManager } from "./logger/LoggerManager";
import { LogLevel } from "./logger/types/ILogger";

LoggerManager.configure({
  level:         config.logger.level as LogLevel,
  logDir:        config.logger.dir,
  enableFile:    config.logger.enableFile,
  enableConsole: true,
});

const log = LoggerManager.getLogger("Boot");

import { createWebhookRouter }             from "./routes/webhook.route";
import { httpErrorHandler, notFoundHandler } from "./errors/handlers/HttpErrorHandler";
import { Bot }                             from "./core/Bot";
import { FacebookConnection }              from "./facebook/FacebookConnection";
import { FacebookClient }                  from "./facebook/FacebookClient";
import { FacebookSender }                  from "./facebook/FacebookSender";
import { CookieHttpClient }               from "./facebook/cookie/CookieHttpClient";
import { MiraiTransport }                  from "./facebook/mirai/MiraiTransport";
import { MiraiSender }                     from "./facebook/mirai/MiraiSender";
import { FcaEventAdapter }                 from "./facebook/mirai/FcaEventAdapter";
import { ISender }                         from "./facebook/types/ISender";
import { FacebookEventNormalizer }         from "./facebook/FacebookEventNormalizer";
import { FacebookGateway }                 from "./facebook/FacebookGateway";
import { CommandRegistry }                 from "./commands/CommandRegistry";
import { CommandLoader }                   from "./commands/CommandLoader";
import { CommandPipeline }                 from "./commands/CommandPipeline";
import { typingMiddleware }                from "./commands/middleware/typing.middleware";
import { MiddlewareManager }              from "./middleware/MiddlewareManager";
import { createLoggingMiddleware }         from "./middleware/built-in/logging.middleware";
import { createCooldownMiddleware }        from "./middleware/built-in/cooldown.middleware";
import { createAntiSpamMiddleware }        from "./middleware/built-in/antispam.middleware";
import { createPermissionsMiddleware }     from "./middleware/built-in/permissions.middleware";
import {
  BanStore, BanEntry, createBannedMiddleware,
} from "./middleware/built-in/banned.middleware";
import { LockdownStore, createLockdownMiddleware } from "./middleware/built-in/lockdown.middleware";
import { AdminStore }                      from "./middleware/built-in/admin-store";
import { DatabaseManager }                 from "./database/DatabaseManager";
import { UserRepository }                  from "./database/repositories/user.repository";
import { CacheManager }                    from "./cache/CacheManager";
import { createCacheProvider }             from "./cache/providers/createProvider";
import { UserService }                     from "./users/UserService";
import { TaskScheduler }                   from "./scheduler";
import { AuthManager }                     from "./facebook/auth/AuthManager";
import { SessionManager }                  from "./facebook/session/SessionManager";
import { SessionStore }                    from "./facebook/session/SessionStore";
import { ReconnectManager }               from "./facebook/reconnect/ReconnectManager";
import { ProcessErrorHandler }             from "./errors/handlers/ProcessErrorHandler";
import { PluginManager }                   from "./plugins/PluginManager";
import {
  setCommandPipeline, setCommandRegistry, setTaskScheduler,
  setReconnectManager, setBanStore, setUserService,
  handleMessage,
} from "./handlers/message.handler";
import {
  setGroupSender, setGroupBotUserId, handleMemberJoined, handleMemberLeft,
} from "./handlers/group.handler";

function buildBanMessage(entry: BanEntry): string {
  const expiry = entry.expiresAt
    ? ` ينتهي: ${entry.expiresAt.toLocaleString("ar-SA")}.`
    : "";
  if (entry.reason?.startsWith("[MUTED]"))  return `🔇 تم كتمك من التفاعل مع البوت.${expiry}`;
  if (entry.reason?.startsWith("[KICKED]")) return `👢 تم طردك مؤقتاً.${expiry}`;
  const reason = entry.reason ? ` السبب: ${entry.reason}.` : "";
  const durStr = entry.expiresAt ? expiry : " الحظر دائم.";
  return `🚫 أنت محظور من استخدام البوت.${reason}${durStr}`;
}

function isValidMongoUri(uri: string): boolean {
  return (uri.startsWith("mongodb://") && uri.length > 10) ||
         (uri.startsWith("mongodb+srv://") && uri.length > 14);
}

async function bootstrap(): Promise<void> {

  // ── 1. Start HTTP server IMMEDIATELY — so Railway healthcheck passes ────────
  //      The /health endpoint is available before any auth or bot init.
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  let miraiTransportRef: MiraiTransport | null = null;

  app.get(["/health", "/api/health", "/api/healthz"], (_req, res) => {
    const mqttConnected = miraiTransportRef ? miraiTransportRef.getApi() !== null : null;
    res.status(200).json({
      status:    "ok",
      uptime:    process.uptime(),
      mqtt:      mqttConnected === null ? "initializing" : mqttConnected ? "connected" : "disconnected",
      botUserId: miraiTransportRef?.getCurrentUserId() || null,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => {
      log.info(`HTTP server listening on port ${config.port} — /health ready.`, { env: config.nodeEnv });
      resolve();
    });
    server.on("error", (err: Error) => {
      log.error("Failed to start HTTP server.", err);
      reject(err);
    });
  });

  // ── 2. AppState check ─────────────────────────────────────────────────────
  const appStateEnvKey = config.auth.appStateEnvKey;
  const appStateValue  = process.env[appStateEnvKey] ?? process.env["FB_APPSTATE"];
  const hasAppState    = !!(appStateValue || config.auth.appStateFile);

  if (!hasAppState) {
    log.warn(
      "FB_APPSTATE غير مُعيَّن. سيعمل البوت بدون اتصال Facebook. " +
      "عيّن FB_APPSTATE (base64 cookie export) لتفعيل المراسلة."
    );
  }

  // ── 3. Core services ──────────────────────────────────────────────────────
  const bot = new Bot();

  const errorHandler = new ProcessErrorHandler();
  errorHandler.onCriticalError(async () => {
    log.error("Critical error triggered — initiating emergency shutdown.");
    await bot.stop();
  });
  bot.register(errorHandler);

  const cache = new CacheManager({ provider: await createCacheProvider() });
  bot.register(cache);

  const mongoUri = config.database.mongoUri;
  if (isValidMongoUri(mongoUri)) {
    const db = new DatabaseManager();
    bot.register(db);
    log.info("Database: MongoDB enabled.");
  } else {
    if (mongoUri) {
      log.warn(`Database: MONGODB_URI looks invalid — skipping MongoDB.`);
    } else {
      log.info("Database: MONGODB_URI not set — running without persistence.");
    }
  }

  const scheduler = new TaskScheduler();
  bot.register(scheduler);

  // ── 4. Auth / Session ─────────────────────────────────────────────────────
  const auth = new AuthManager();

  if (config.auth.appStateFile) {
    const { provider } = AuthManager.fromFile("default", config.auth.appStateFile);
    auth.registerAccount("default", provider);
  } else if (appStateValue) {
    const { provider } = AuthManager.fromEnv("default", appStateEnvKey);
    auth.registerAccount("default", provider);
  }

  await auth.loginAll();
  bot.register(auth);

  const sessionStore   = new SessionStore(config.auth.sessionFile, config.auth.sessionSecret ?? "");
  const sessionManager = new SessionManager({
    store: sessionStore,
    auth,
    ttlMs: config.auth.sessionTtlDays * 24 * 60 * 60 * 1000,
  });
  bot.register(sessionManager);

  const reconnect = new ReconnectManager(auth, sessionManager, {
    retry:                 { maxAttempts: 5, baseDelayMs: 2_000, maxDelayMs: 60_000 },
    healthCheckIntervalMs: 30_000,
    spamWindowMs:          60_000,
    maxAttemptsPerWindow:  3,
  });
  bot.register(reconnect);

  // ── 5. Facebook Transport ─────────────────────────────────────────────────
  let sender:         ISender;
  let cookieClient:   CookieHttpClient | null = null;
  let miraiTransport: MiraiTransport   | null = null;
  let botUserId                              = "";

  const credentials = auth.getCredentials("default");

  if (credentials) {
    cookieClient   = new CookieHttpClient(credentials.appState);
    botUserId      = cookieClient.getUserId();
    miraiTransport = new MiraiTransport(credentials.appState);
    sender         = new MiraiSender(miraiTransport);
    miraiTransportRef = miraiTransport; // expose to /health endpoint
    log.info("Sender: MiraiSender active (fca-unofficial via AppState).", { userId: botUserId });
  } else if (config.facebook.pageAccessToken) {
    const connection = new FacebookConnection();
    const client     = new FacebookClient(connection);
    sender           = new FacebookSender(client);
    connection.connect();
    log.info("Sender: FacebookSender active (Graph API).");
  } else {
    log.warn("No sender available — running in health-only mode. Set FB_APPSTATE to enable messaging.");
    sender = {
      sendText:     async () => { log.warn("NoOpSender: sendText called but no FB_APPSTATE configured."); },
      sendTyping:   async () => {},
      sendReaction: async () => {},
    } satisfies ISender;
  }

  setGroupSender(sender);
  setGroupBotUserId(botUserId);

  const normalizer  = new FacebookEventNormalizer();
  const connection  = new FacebookConnection();
  const gateway     = new FacebookGateway(connection, sender, normalizer);
  connection.connect();

  gateway.getContextBuilder().setOwnerIds(config.bot.ownerIds);
  log.info("Owner IDs configured.", { ownerIds: config.bot.ownerIds });

  // ── 6. User System ────────────────────────────────────────────────────────
  const userRepo = new UserRepository();
  const userSvc  = new UserService(userRepo, cache.store("users"));
  gateway.getContextBuilder().setUserService(userSvc);
  setUserService(userSvc);

  // ── 7. Commands ───────────────────────────────────────────────────────────
  const registry    = new CommandRegistry();
  const loader      = new CommandLoader(registry);
  const commandsDir = path.resolve(config.bot.commandsDir);

  await loader.load(commandsDir);
  loader.watch(commandsDir);

  const banStore      = new BanStore();
  const lockdownStore = new LockdownStore();

  const adminStore = new AdminStore(config.bot.adminIds);
  log.info("AdminStore ready.", { adminCount: adminStore.size() });

  const mwManager = new MiddlewareManager()
    .register(createBannedMiddleware({ store: banStore, message: buildBanMessage }))
    .register(createLockdownMiddleware({ store: lockdownStore }))
    .register(createLoggingMiddleware({ logEntry: true }))
    .register(createAntiSpamMiddleware({ maxMessages: 5, windowMs: 10_000 }))
    .register(createCooldownMiddleware({ durationMs: 3_000 }))
    .register(createPermissionsMiddleware({ adminIds: config.bot.adminIds, adminStore }));

  const pipeline = new CommandPipeline(registry, config.bot.prefix)
    .use(mwManager.fn("banned"))
    .use(mwManager.fn("logging"))
    .use(mwManager.fn("lockdown"))
    .use(mwManager.fn("antispam"))
    .use(mwManager.fn("cooldown"))
    .use(mwManager.fn("permissions"))
    .use(typingMiddleware)
    .onNotFound(async (ctx) => {
      await ctx.reply(`❓ الأمر "${ctx.commandName}" غير موجود.`);
    });

  setCommandPipeline(pipeline);
  setCommandRegistry(registry);
  setTaskScheduler(scheduler);
  setReconnectManager(reconnect);
  setBanStore(banStore);

  // ── 8. Plugin System ──────────────────────────────────────────────────────
  const pluginManager = new PluginManager({
    commandRegistry: registry,
    scheduler,
    pluginsDir: path.resolve(config.plugins.dir),
    watch:      config.plugins.watch,
  });

  const svcReg = pluginManager.getServiceRegistry();
  svcReg.provide("command-registry", registry,      "core");
  svcReg.provide("facebook-sender",  sender,         "core");
  svcReg.provide("ban-store",        banStore,        "core");
  svcReg.provide("lockdown-store",   lockdownStore,   "core");
  svcReg.provide("admin-store",      adminStore,      "core");
  svcReg.provide("user-service",     userSvc,         "core");

  if (cookieClient) {
    svcReg.provide("fb-cookie-client", cookieClient, "core");
    log.info("Core service registered: fb-cookie-client.");
  }

  if (config.facebook.pageAccessToken) {
    svcReg.provide("fb-access-token", config.facebook.pageAccessToken, "core");
    log.info("Core service registered: fb-access-token.");
  }

  if (miraiTransport) {
    svcReg.provide("mirai-transport", miraiTransport, "core");
    log.info("Core service registered: mirai-transport.");
  }

  // ── 9. MiraiTransport event listener ─────────────────────────────────────
  if (miraiTransport) {
    const adapter = new FcaEventAdapter(botUserId);

    miraiTransport.setEventHandler((fcaEvent) => {
      const entries = adapter.adapt(fcaEvent);

      for (const entry of entries) {
        gateway.processWebhookBody(
          {
            object: "page",
            entry: [{
              id:        botUserId,
              time:      entry.timestamp,
              messaging: [entry],
            }],
          },
          handleMessage,
          {
            onMemberJoined: handleMemberJoined,
            onMemberLeft:   handleMemberLeft,
          },
        );
      }
    });

    bot.register(miraiTransport);
    log.info("MiraiTransport registered — fca-unofficial MQTT listener active.", { userId: botUserId });
  }

  bot.register(pluginManager);

  // ── 10. Add webhook routes to the already-running express app ─────────────
  const webhookRouter = createWebhookRouter(gateway, {
    onMemberJoined: handleMemberJoined,
    onMemberLeft:   handleMemberLeft,
  });
  app.use("/webhook", webhookRouter);
  app.use(notFoundHandler);
  app.use(httpErrorHandler);

  log.info("All routes registered on running HTTP server.");

  // ── 11. Start bot subsystems ──────────────────────────────────────────────
  await bot.start();

  setTimeout(() => {
    const mqttConnected = miraiTransport ? miraiTransport.getApi() !== null : false;
    log.info("── BOT STATUS REPORT (15s) ──────────────────────────────────", {
      mqttConnected,
      botUserId:   miraiTransport?.getCurrentUserId() || "–",
      botPrefix:   config.bot.prefix,
      nodeEnv:     config.nodeEnv,
      uptime:      Math.round(process.uptime()) + "s",
    });
  }, 15_000);

  if (process.send) {
    process.send("ready");
    log.info("Sent ready signal to PM2.");
  }
}

bootstrap().catch((err: unknown) => {
  log.error("Fatal error during startup.", err);
  process.exit(1);
});
