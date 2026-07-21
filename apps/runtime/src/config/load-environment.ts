import { resolve } from "node:path";
import { config } from "dotenv";

export function loadRuntimeEnvironment(): void {
  config({
    path: process.env.GOOGLE_CALENDAR_ENV_FILE?.trim() || resolve(process.cwd(), "../../.env"),
    quiet: true
  });
}
