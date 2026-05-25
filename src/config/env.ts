import dotenv from "dotenv";
import path   from "path";

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

/**
 * In production the TypeScript source is compiled to dist/.
 * Loaders (PluginLoader, CommandLoader) require .js files from dist/,
 * not .ts files from src/.  The env-var overrides always win.
 */
const isProd              = (process.env["NODE_ENV"] ?? "") === "production";
const DEFAULT_COMMANDS_DIR = isProd
  ? "dist/commands/definitions"
  : "src/commands/definitions";
const DEFAULT_PLUGINS_DIR  = isProd
  ? "dist/plugins/definitions"
  : "src/plugins/definitions";

/**
 * SESSION_SECRET is required but may be supplied under either env key.
 * We read it lazily here (not at module-load validation time) to avoid
 * crashing before the logger is initialised when the key is missing.
 * The startup validator in InitializationManager will catch it early.
 */
function resolveSessionSecret(): string {
  return (
    process.env["FB_SESSION_SECRET"] ??
    process.env["SESSION_SECRET"]    ??
    ""
  );
}

export const config = {
  port:    parseInt(process.env["PORT"] ?? "3000", 10),
  nodeEnv: process.env["NODE_ENV"] ?? "development",

  facebook: {
    pageAccessToken: requireEnv("FB_PAGE_ACCESS_TOKEN"),
    verifyToken:     requireEnv("FB_VERIFY_TOKEN"),
    appSecret:       requireEnv("FB_APP_SECRET"),
  },

  bot: {
    prefix:      optionalEnv("BOT_PREFIX", "/"),
    commandsDir: optionalEnv("COMMANDS_DIR", DEFAULT_COMMANDS_DIR),
    /** Comma-separated list of Facebook user IDs who are bot admins. */
    adminIds:    optionalEnv("BOT_ADMIN_IDS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  plugins: {
    dir:   optionalEnv("PLUGINS_DIR", DEFAULT_PLUGINS_DIR),
    watch: process.env["PLUGINS_WATCH"] !== "false",
  },

  database: {
    mongoUri: optionalEnv("MONGODB_URI", ""),
  },

  auth: {
    appStateEnvKey:  optionalEnv("FB_APPSTATE_ENV_KEY", "FB_APPSTATE"),
    appStateFile:    optionalEnv("FB_APPSTATE_FILE", ""),
    sessionFile:     optionalEnv("FB_SESSION_FILE", path.resolve("data/sessions.json")),
    sessionSecret:   resolveSessionSecret(),
    sessionTtlDays:  parseInt(optionalEnv("FB_SESSION_TTL_DAYS", "30"), 10),
  },

  logger: {
    level:      (optionalEnv("LOG_LEVEL", "info")) as "debug" | "info" | "warn" | "error",
    dir:        optionalEnv("LOG_DIR", "logs"),
    enableFile: process.env["LOG_FILE"] !== "false",
  },
} as const;

export type Config = typeof config;
