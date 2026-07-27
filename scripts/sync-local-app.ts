import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env"), quiet: true });

const command = process.argv[2];
if (command !== "prepare" && command !== "publish") {
  throw new Error("Usage: tsx scripts/sync-local-app.ts prepare|publish");
}

const coreDirectory = resolve(process.cwd(), process.env.VEKIL_CORE_DIR ?? "../vekil.me");
if (!existsSync(resolve(coreDirectory, "package.json"))) {
  throw new Error(`Vekil Core was not found at ${coreDirectory}. Set VEKIL_CORE_DIR in .env.`);
}

const definitionPath = resolve(process.cwd(), "artifacts/definition.json");
const manifestPath = resolve(process.cwd(), "artifacts/vekil.manifest.json");
const statePath = resolve(process.cwd(), "artifacts/local-app-state.json");

if (!existsSync(definitionPath)) {
  throw new Error("App Definition is missing. Run pnpm definition:build first.");
}

const result = spawnSync(
  "pnpm",
  [
    "app:local:remote",
    command,
    "--definition",
    definitionPath,
    "--manifest",
    manifestPath,
    "--state",
    statePath
  ],
  {
    cwd: coreDirectory,
    env: process.env,
    stdio: "inherit"
  }
);

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Vekil local App ${command} failed with status ${result.status ?? "unknown"}. ` +
      "Start the Vekil local environment first."
  );
}
