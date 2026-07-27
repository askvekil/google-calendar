import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const localValues = {
  APP_ENV: "development",
  GOOGLE_CALENDAR_RUNTIME_PORT: "4100",
  GOOGLE_CALENDAR_RUNTIME_DATABASE_URL:
    "postgresql://postgres:postgres@localhost:54321/vekil_google_calendar",
  GOOGLE_CALENDAR_RUNTIME_BASE_URL: "http://localhost:4100",
  VEKIL_APP_MANIFEST_PATH: "../../artifacts/vekil.manifest.json",
  VEKIL_CORE_DIR: "../vekil.me",
  VEKIL_WEB_BASE_URL: "http://localhost:3000",
  VEKIL_PLATFORM_ISSUER: "vekil",
  VEKIL_PLATFORM_JWKS_URL: "http://localhost:4000/api/.well-known/app-runtime-jwks.json"
} as const;

const root = process.cwd();
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const template = readFileSync(examplePath, "utf8");
const currentSource = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const currentValues = readEnvironmentValues(currentSource);
const templateKeys = new Set(readEnvironmentValues(template).keys());
const removedKeys = [...currentValues.keys()].filter((key) => !templateKeys.has(key));
const values = new Map(currentValues);

for (const [key, value] of Object.entries(localValues)) {
  values.set(key, value);
}

if (!values.get("GOOGLE_CALENDAR_VAULT_KEY_BASE64URL")?.trim()) {
  values.set("GOOGLE_CALENDAR_VAULT_KEY_BASE64URL", randomBytes(32).toString("base64url"));
}

const output = template
  .split(/\r?\n/u)
  .map((line) => {
    const assignment = readAssignment(line);
    if (!assignment) return line;
    return `${assignment.key}=${values.get(assignment.key) ?? assignment.value}`;
  })
  .join("\n");

writeFileSync(envPath, `${output.replace(/\n+$/u, "")}\n`, {
  encoding: "utf8",
  mode: 0o600
});

if (removedKeys.length > 0) {
  process.stdout.write(
    `Removed retired local environment keys: ${removedKeys.sort().join(", ")}\n`
  );
}

process.stdout.write(
  [
    "Google Calendar local environment is ready.",
    "Runtime PostgreSQL: localhost:54321/vekil_google_calendar",
    "Runtime: http://localhost:4100"
  ].join("\n") + "\n"
);

function readEnvironmentValues(source: string): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of source.split(/\r?\n/u)) {
    const assignment = readAssignment(line);
    if (assignment) result.set(assignment.key, assignment.value);
  }

  return result;
}

function readAssignment(line: string): { key: string; value: string } | null {
  if (line.trimStart().startsWith("#")) return null;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
  return match ? { key: match[1]!, value: match[2]! } : null;
}
