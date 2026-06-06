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

import { createWebhookRouter }               from "./routes/webhook.route";
import { httpErrorHandler, notFoundHandler }  from "./errors/handlers/HttpErrorHandler";
import { Bot }                               from "./core/Bot";
import { FacebookConnection }                from "./facebook/FacebookConnection";
import { FacebookSender }                    from "./facebook/FacebookSender";
import { FacebookClient }                    from "./facebook/FacebookClient";
import { CookieHttpClient }                  from "./facebook/cookie/CookieHttpClient";
import { MiraiTransport }                    from "./facebook/mirai/MiraiTransport";
import { MiraiSender }                       from "./facebook/mirai/MiraiSender";
import { FcaEventAdapter }                   from "./facebook/mirai/FcaEventAdapter";
import { ISender }                           from "./facebook/types/ISender";
import { FacebookEventNormalizer }           from "./facebook/FacebookEventNormalizer";
import { FacebookGateway }                   from "./facebook/FacebookGateway";
import { CommandRegistry }                   from "./commands/CommandRegistry";
import { CommandLoader }                     from "./commands/CommandLoader";
import { CommandPipeline }                   from "./commands/CommandPipeline";
import { typingMiddleware }                  from "./commands/middleware/typing.middleware";
import { MiddlewareManager }                 from "./middleware/MiddlewareManager";
import { createLoggingMiddleware }           from "./middleware/built-in/logging.middleware";
import { createCooldownMiddleware }          from "./middleware/built-in/cooldown.middleware";
import { createAntiSpamMiddleware }          from "./middleware/built-in/antispam.middleware";
import { createPermissionsMiddleware }       from "./middleware/built-in/permissions.middleware";
import {
  BanStore, BanEntry, createBannedMiddleware,
} from "./middleware/built-in/banned.middleware";
import { LockdownStore, createLockdownMiddleware } from "./middleware/built-in/lockdown.middleware";
import { AdminStore }                        from "./middleware/built-in/admin-store";
import { DatabaseManager }                   from "./database/DatabaseManager";
import { UserRepository }                    from "./database/repositories/user.repository";
import { CacheManager }                      from "./cache/CacheManager";
import { createCacheProvider }               from "./cache/providers/createProvider";
import { UserService }                       from "./users/UserService";
import { TaskScheduler }                     from "./scheduler";
import { AuthManager }                       from "./facebook/auth/AuthManager";
import { SessionManager }                    from "./facebook/session/SessionManager";
import { SessionStore }                      from "./facebook/session/SessionStore";
import { ReconnectManager }                  from "./facebook/reconnect/ReconnectManager";
import { ProcessErrorHandler }               from "./errors/handlers/ProcessErrorHandler";
import { PluginManager }                     from "./plugins/PluginManager";
import { AuthCredentials }                   from "./facebook/auth/types/IAuth";
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

// ─── Per-account setup ────────────────────────────────────────────────────────
//
// Each Facebook account gets its own MiraiTransport (unique system name),
// MiraiSender, FcaEventAdapter, and FacebookGateway so replies always use
// the correct account.  All accounts share the same command pipeline.

interface AccountSetupOptions {
  label:       string;
  credentials: AuthCredentials;
  userSvc:     UserService;
  bot:         Bot;
  isPrimary:   boolean;
}

function bootFcaAccount(opts: AccountSetupOptions): MiraiTransport {
  const { label, credentials, userSvc, bot, isPrimary } = opts;

  const cookieClient = new CookieHttpClient(credentials.appState);
  const botUserId    = cookieClient.getUserId();

  // Each transport gets a unique system name so Bot.register() doesn't conflict
  const systemName   = isPrimary ? "mirai-transport" : `mirai-transport-${label}`;
  const transport    = new MiraiTransport(credentials.appState, systemName);
  const sender: ISender = new MiraiSender(transport);

  log.info(`Account [${label}]: transport created.`, { botUserId, systemName });

  // Primary account drives group join/leave handler singletons
  if (isPrimary) {
    setGroupSender(sender);
    setGroupBotUserId(botUserId);
  }

  const normalizer = new FacebookEventNormalizer();
  const connection  = new FacebookConnection();
  const gateway     = new FacebookGateway(connection, sender, normalizer);
  connection.connect();

  gateway.getContextBuilder().setOwnerIds(config.bot.ownerIds);
  gateway.getContextBuilder().setUserService(userSvc);

  const adapter = new FcaEventAdapter(botUserId);

  transport.setEventHandler((fcaEvent) => {
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

  bot.register(transport);
  log.info(`Account [${label}]: registered (${systemName}).`, { botUserId });
  return transport;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {

  // 1. HTTP server starts first — Railway healthcheck passes immediately
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  const transports: Array<{ label: string; transport: MiraiTransport }> = [];

  app.get(["/health", "/api/health", "/api/healthz"], (_req, res) => {
    const accounts = transports.map(({ label, transport: t }) => ({
      account:   label,
      connected: t.getApi() !== null,
      userId:    t.getCurrentUserId() || null,
    }));
    res.status(200).json({ status: "ok", uptime: process.uptime(), accounts });
  });

  await new Promise<void>((resolve, reject) => {
    const srv = app.listen(config.port, () => {
      log.info(`HTTP server ready on port ${config.port}.`, { env: config.nodeEnv });
      resolve();
    });
    srv.on("error", (err: Error) => { log.error("HTTP server failed.", err); reject(err); });
  });

  // 2. Core services
  const bot = new Bot();

  const errorHandler = new ProcessErrorHandler();
  errorHandler.onCriticalError(async () => {
    log.error("Critical error — emergency shutdown.");
    await bot.stop();
  });
  bot.register(errorHandler);

  const cache = new CacheManager({ provider: await createCacheProvider() });
  bot.register(cache);

  const mongoUri = config.database.mongoUri;
  if (isValidMongoUri(mongoUri)) {
    bot.register(new DatabaseManager());
    log.info("Database: MongoDB enabled.");
  } else if (mongoUri) {
    log.warn("Database: MONGODB_URI looks invalid — skipping.");
  } else {
    log.info("Database: no MONGODB_URI — running without persistence.");
  }

  const scheduler = new TaskScheduler();
  bot.register(scheduler);

  // 3. Auth — register primary and optional secondary account
  const auth = new AuthManager();

  const appStateVal  = process.env[config.auth.appStateEnvKey] ?? process.env["FB_APPSTATE"];
  const appStateFile = config.auth.appStateFile;
  if (appStateFile) {
    auth.registerAccount("primary", AuthManager.fromFile("primary", appStateFile).provider);
  } else if (appStateVal) {
    auth.registerAccount("primary", AuthManager.fromEnv("primary", config.auth.appStateEnvKey).provider);
  } else {
    log.warn("FB_APPSTATE not set — health-only mode.");
  }

  const appStateVal2  = process.env[config.auth.appStateEnvKey2] ?? process.env["FB_APPSTATE_2"];
  const appStateFile2 = config.auth.appStateFile2;
  if (appStateFile2) {
    auth.registerAccount("secondary", AuthManager.fromFile("secondary", appStateFile2).provider);
    log.info("Secondary account registered from file.");
  } else if (appStateVal2) {
    auth.registerAccount("secondary", AuthManager.fromEnv("secondary", config.auth.appStateEnvKey2).provider);
    log.info("Secondary account registered from env (FB_APPSTATE_2).");
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

  // 4. User system
  const userRepo = new UserRepository();
  const userSvc  = new UserService(userRepo, cache.store("users"));
  setUserService(userSvc);

  // 5. Commands & middleware
  const registry    = new CommandRegistry();
  const loader      = new CommandLoader(registry);
  await loader.load(path.resolve(config.bot.commandsDir));
  loader.watch(path.resolve(config.bot.commandsDir));

  const banStore      = new BanStore();
  const lockdownStore = new LockdownStore();
  const adminStore    = new AdminStore(config.bot.adminIds);
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

  // 6. FCA accounts — each gets its own transport + sender + gateway
  const primaryCreds   = auth.getCredentials("primary");
  const secondaryCreds = auth.getCredentials("secondary");

  if (primaryCreds) {
    const t = bootFcaAccount({ label: "primary", credentials: primaryCreds, userSvc, bot, isPrimary: true });
    transports.push({ label: "primary", transport: t });
  }

  if (secondaryCreds) {
    const t = bootFcaAccount({ label: "secondary", credentials: secondaryCreds, userSvc, bot, isPrimary: false });
    transports.push({ label: "secondary", transport: t });
    log.info("✅ Two accounts active — bot running on primary + secondary Facebook accounts.");
  }

  if (!primaryCreds && !secondaryCreds) {
    if (config.facebook.pageAccessToken) {
      const connection = new FacebookConnection();
      const client     = new FacebookClient(connection);
      const sender: ISender = new FacebookSender(client);
      setGroupSender(sender);
      connection.connect();
      log.info("Sender: FacebookSender (Graph API).");
    } else {
      log.warn("No sender — health-only mode. Set FB_APPSTATE.");
      const noOp: ISender = {
        sendText:     async () => { log.warn("NoOpSender: no FB_APPSTATE."); },
        sendTyping:   async () => {},
        sendReaction: async () => {},
      };
      setGroupSender(noOp);
    }
  }

  // 7. Plugin system
  const pluginManager = new PluginManager({
    commandRegistry: registry,
    scheduler,
    pluginsDir: path.resolve(config.plugins.dir),
    watch:      config.plugins.watch,
  });

  const svcReg = pluginManager.getServiceRegistry();
  svcReg.provide("command-registry", registry,      "core");
  svcReg.provide("ban-store",        banStore,        "core");
  svcReg.provide("lockdown-store",   lockdownStore,   "core");
  svcReg.provide("admin-store",      adminStore,      "core");
  svcReg.provide("user-service",     userSvc,         "core");

  if (transports[0]) {
    svcReg.provide("mirai-transport",   transports[0].transport, "core");
    const primarySender = new MiraiSender(transports[0].transport);
    svcReg.provide("facebook-sender",  primarySender,           "core");
  }
  if (transports[1]) {
    svcReg.provide("mirai-transport-secondary", transports[1].transport, "core");
  }

  if (config.facebook.pageAccessToken) {
    svcReg.provide("fb-access-token", config.facebook.pageAccessToken, "core");
  }

  bot.register(pluginManager);

  // 8. Webhook routes (primary account handles webhook verification)
  if (transports[0]) {
    const conn    = new FacebookConnection();
    const gateway = new FacebookGateway(conn, new MiraiSender(transports[0].transport), new FacebookEventNormalizer());
    gateway.getContextBuilder().setOwnerIds(config.bot.ownerIds);
    gateway.getContextBuilder().setUserService(userSvc);
    conn.connect();

    app.use("/webhook", createWebhookRouter(gateway, {
      onMemberJoined: handleMemberJoined,
      onMemberLeft:   handleMemberLeft,
    }));
  }

  app.use(notFoundHandler);
  app.use(httpErrorHandler);

  // 9. Start bot
  await bot.start();

  log.info("── BOT READY ────────────────────────────────────────────────", {
    accounts: transports.map(({ label, transport: t }) => ({ label, userId: t.getCurrentUserId() })),
    prefix:   config.bot.prefix,
    nodeEnv:  config.nodeEnv,
  });

  if (process.send) process.send("ready");
}

bootstrap().catch((err: unknown) => {
  log.error("Fatal startup error.", err);
  process.exit(1);
});
