import { ISystem } from "../interfaces/ISystem";

export interface StartupStep {
  name: string;
  execute(): Promise<void>;
}

export function buildStartupSteps(
  systems: ISystem[],
  onStep: (name: string) => void
): StartupStep[] {
  return systems.map((system) => ({
    name: system.name,
    execute: async () => {
      onStep(system.name);
      await system.initialize();
    },
  }));
}

export async function runStartupSteps(steps: StartupStep[]): Promise<void> {
  for (const step of steps) {
    await step.execute();
  }
}
