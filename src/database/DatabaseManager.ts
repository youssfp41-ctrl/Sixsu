import mongoose, { Connection } from "mongoose";
import { ISystem } from "../core/interfaces/ISystem";
import { config } from "../config/env";

export class DatabaseManager implements ISystem {
  readonly name = "database";

  private connection: Connection | null = null;

  async initialize(): Promise<void> {
    const uri = config.database.mongoUri;

    if (!uri) {
      throw new Error(
        "[DatabaseManager] MONGODB_URI is not set in environment variables."
      );
    }

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    });

    this.connection = mongoose.connection;

    this.connection.on("disconnected", () => {
      console.warn("[DatabaseManager] MongoDB disconnected.");
    });

    this.connection.on("error", (err: Error) => {
      console.error("[DatabaseManager] Connection error:", err.message);
    });

    console.log("[DatabaseManager] Connected to MongoDB.");
  }

  async destroy(): Promise<void> {
    if (this.connection) {
      await mongoose.disconnect();
      this.connection = null;
      console.log("[DatabaseManager] Disconnected from MongoDB.");
    }
  }

  isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  getConnection(): Connection {
    if (!this.connection || !this.isConnected()) {
      throw new Error("[DatabaseManager] Not connected to MongoDB.");
    }
    return this.connection;
  }
}
