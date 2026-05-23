/**
 * CLI tool — encrypt a JSON credentials file using AES-256-GCM.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run encrypt-credentials \
 *     --input credentials.json \
 *     --output credentials.enc
 *
 * The encryption key is read from SESSION_SECRET env var.
 * Never commit credentials.json to git — add it to .gitignore.
 *
 * To decrypt at runtime, use EncryptedFileLoader with the same key.
 */

import fs   from "fs";
import path from "path";
import { CryptoHelper } from "../../src/facebook/auth/CryptoHelper";

async function main(): Promise<void> {
  const args  = process.argv.slice(2);
  const flags = parseFlags(args);

  const input  = flags["input"]  ?? flags["i"];
  const output = flags["output"] ?? flags["o"];

  if (!input || !output) {
    console.error("Usage: encrypt-credentials --input <file.json> --output <file.enc>");
    process.exit(1);
  }

  const key = process.env["SESSION_SECRET"];
  if (!key || key.length < 16) {
    console.error("SESSION_SECRET env var is required and must be at least 16 characters.");
    process.exit(1);
  }

  const inputPath  = path.resolve(input);
  const outputPath = path.resolve(output);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  let jsonText: string;
  try {
    jsonText = fs.readFileSync(inputPath, "utf8");
    JSON.parse(jsonText); // validate JSON
  } catch {
    console.error("Input file is not valid JSON.");
    process.exit(1);
  }

  const encrypted = await CryptoHelper.encrypt(jsonText, key);
  fs.writeFileSync(outputPath, encrypted, "utf8");

  console.log(`✓ Encrypted credentials written to: ${outputPath}`);
  console.log(`  Keys: ${Object.keys(JSON.parse(jsonText)).join(", ")}`);
  console.log(`  ⚠  Do not commit "${path.basename(outputPath)}" if it contains real secrets.`);
}

function parseFlags(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg?.startsWith("--") || arg?.startsWith("-")) {
      const key = arg.replace(/^-+/, "");
      const val = args[i + 1];
      if (val && !val.startsWith("-")) {
        result[key] = val;
        i++;
      }
    }
  }
  return result;
}

main().catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
