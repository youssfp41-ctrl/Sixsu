import { ISystem, SystemStatus } from "./interfaces/ISystem";
import { InitializationManager } from "./InitializationManager";
import { SystemLoader } from "./SystemLoader";
import { buildStartupSteps, runStartupSteps } from "./lifecycle/startup";
import { buildShutdownSteps, runShutdownSteps } from "./lifecycle/shutdown";

export enum BotState {
  IDLE = "IDLE",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
  STOPPED = "STOPPED",
}

export class Bot {
  private state: BotState = BotState.IDLE;
  private readonly loader: SystemLoader;

  constructor() {
    const manager = new InitializationManager();
    this.loader = new SystemLoader(manager);
  }

  register(system: ISystem): this {
    if (this.state !== BotState.IDLE) {
      throw new Error("Cannot register systems after bot has started.");
    }
    this.loader.register(system);
    return this;
  }

  getSystem<T extends ISystem>(name: string): T {
    return this.loader.get<T>(name);
  }

  async start(): Promise<void> {
    if (this.state !== BotState.IDLE) {
      throw new Error(`Cannot start bot from state: ${this.state}`);
    }

    this.state = BotState.STARTING;
    console.log("[Bot] Starting...");

    const systems = this.loader.getResolved();

    const steps = buildStartupSteps(systems, (name) => {
      this.loader.setStatus(name, SystemStatus.INITIALIZING);
      console.log(`[Bot] Initializing system: ${name}`);
    });

    try {
      await runStartupSteps(steps);

      for (const system of systems) {
        this.loader.setStatus(system.name, SystemStatus.READY);
      }

      this.state = BotState.RUNNING;
      console.log("[Bot] All systems ready.", this.loader.summary());
    } catch (err) {
      this.state = BotState.STOPPED;
      throw new Error(
        `[Bot] Startup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    this.registerShutdownSignals();
  }

  async stop(): Promise<void> {
    if (this.state !== BotState.RUNNING) {
      return;
    }

    this.state = BotState.STOPPING;
    console.log("[Bot] Shutting down...");

    const systems = this.loader.getResolved();

    const steps = buildShutdownSteps(systems, (name) => {
      this.loader.setStatus(name, SystemStatus.DESTROYING);
      console.log(`[Bot] Destroying system: ${name}`);
    });

    try {
      await runShutdownSteps(steps);

      for (const system of systems) {
        this.loader.setStatus(system.name, SystemStatus.DESTROYED);
      }
    } catch (err) {
      console.error("[Bot] Error during shutdown:", err);
    } finally {
      this.state = BotState.STOPPED;
      console.log("[Bot] Stopped.");
    }
  }

  getState(): BotState {
    return this.state;
  }

  private registerShutdownSignals(): void {
    const handler = async (signal: string) => {
      console.log(`[Bot] Received ${signal}.`);
      await this.stop();
      process.exit(0);
    };

    process.once("SIGINT", () => handler("SIGINT"));
    process.once("SIGTERM", () => handler("SIGTERM"));
  }
}
