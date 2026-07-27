import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appManifestSchema } from "@vekil/app-sdk";
import {
  generateAppRuntimeKeyMaterial,
  readAppRuntimeSigningIdentity
} from "@vekil/app-sdk/runtime";

const envPath = resolve(process.cwd(), ".env");
const source = await readFile(envPath, "utf8");
const lines = source.replace(/\r?\n$/u, "").split(/\r?\n/u);
const values = readEnvironmentValues(lines);
const manifestPath = resolve(
  process.cwd(),
  "apps/runtime",
  values.get("VEKIL_APP_MANIFEST_PATH") ?? "artifacts/vekil.manifest.json"
);
const manifest = appManifestSchema.parse(
  JSON.parse(await readFile(manifestPath, "utf8")) as unknown
);
const signingIdentity = readAppRuntimeSigningIdentity({
  manifest,
  keyId: values.get("GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID")?.trim(),
  privateJwkBase64url: values
    .get("GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL")
    ?.trim()
});

if (!signingIdentity) {
  const material = generateAppRuntimeKeyMaterial({ manifest });
  values.set("GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID", material.keyId);
  values.set(
    "GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL",
    material.privateJwkBase64url
  );
}

const output = lines.map((line) => {
  const assignment = readAssignment(line);
  if (!assignment) return line;
  return `${assignment.key}=${values.get(assignment.key) ?? assignment.value}`;
});

await writeFile(envPath, `${output.join("\n")}\n`, { mode: 0o600 });
process.stdout.write(`Runtime signing identity is ready for ${manifest.app.slug}.\n`);

function readEnvironmentValues(lines: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of lines) {
    const assignment = readAssignment(line);
    if (assignment) values.set(assignment.key, assignment.value);
  }
  return values;
}

function readAssignment(line: string): { key: string; value: string } | null {
  if (line.trimStart().startsWith("#")) return null;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
  return match ? { key: match[1]!, value: match[2]! } : null;
}
