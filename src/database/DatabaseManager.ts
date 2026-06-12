import mongoose, { Connection } from "mongoose";
import { ISystem } from "../core/interfaces/ISystem";
import { config } from "../config/env";
import { LoggerManager } from "../logger/LoggerManager";

const log = LoggerManager.getLogger("DatabaseManager");

const CONNECT_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 15_000,
  socketTimeoutMS:          45_000,
  connectTimeoutMS:         15_000,
  maxPoolSize:              10,
  minPoolSize:              2,
  retryWrites:              true,
  w:                        "majority",
};

export class DatabaseManager implements ISystem {
  readonly name = "database";

  private connection: Connection | null = null;

  async initialize(): Promise<void> {
    const uri = config.database.mongoUri;

    if (!uri) {
      log.warn(
        "MONGODB_URI is not set — skipping database connection. " +
        "Features requiring DB will be unavailable."
      );
      return;
    }

    log.info("Connecting to MongoDB...");
    await this.connectWithRetry(uri, 1);
  }

  async destroy(): Promise<void> {
    if (this.connection) {
      await mongoose.disconnect();
      this.connection = null;
      log.info("Disconnected from MongoDB.");
    }
  }

  isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  getConnection(): Connection {
    if (!this.connection || !this.isConnected()) {
      throw new Error("Not connected to MongoDB.");
    }
    return this.connection;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private setupEventListeners(): void {
    if (!this.connection) return;

    this.connection.on("disconnected", () => {
      log.warn(
        "MongoDB disconnected. Mongoose will attempt automatic reconnection. " +
        "If this persists, check your MongoDB host and network."
      );
    });

    this.connection.on("reconnected", () => {
      log.info("MongoDB reconnected successfully.");
    });

    this.connection.on("error", (err: Error) => {
      log.error("MongoDB connection error.", err);
    });

    this.connection.on("close", () => {
      log.warn("MongoDB connection closed.");
    });
  }

  private async connectWithRetry(uri: string, attempt: number): Promise<void> {
    const maxAttempts = 3;

    try {
      await mongoose.connect(uri, CONNECT_OPTIONS);
      this.connection = mongoose.connection;
      this.setupEventListeners();

      log.info("Connected to MongoDB.", {
        host:     mongoose.connection.host,
        name:     mongoose.connection.name,
        readyState: mongoose.connection.readyState,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (attempt < maxAttempts) {
        const delay = attempt * 5_000;
        log.warn(
          `MongoDB connection failed (attempt ${attempt}/${maxAttempts}) — ` +
          `retrying in ${delay / 1_000}s.`,
          { error: msg }
        );
        await new Promise<void>((r) => setTimeout(r, delay));
        return this.connectWithRetry(uri, attempt + 1);
      }

      log.error(
        `MongoDB connection failed after ${maxAttempts} attempts. ` +
        "Bot will run without database persistence.",
        { error: msg }
      );
    }
  }
}
