import { Context } from "../../context/Context";

export interface ICommand {
  readonly name: string;
  readonly aliases?: string[];
  readonly description?: string;
  readonly usage?: string;
  execute(ctx: Context): Promise<void>;
}

export function isValidCommand(obj: unknown): obj is ICommand {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    typeof (obj as ICommand).name === "string" &&
    (obj as ICommand).name.trim().length > 0 &&
    "execute" in obj &&
    typeof (obj as ICommand).execute === "function"
  );
}
