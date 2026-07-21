import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appManifestSchema } from "@vekil/app-sdk";
import {
  generateAppRuntimeKeyMaterial,
  readAppRuntimeSigningIdentity
} from "@vekil/app-sdk/runtime";

async function main(): Promise<void> {
  const envPath = resolve(process.cwd(), "../../.env");
  const source = await readFile(envPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return "";
    throw error;
  });
  const lines = source.length > 0 ? source.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const values = new Map<string, string>();

  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator > 0 && !line.trimStart().startsWith("#")) {
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }

  const ensure = (key: string, value: string): void => {
    if (!values.has(key) || (!values.get(key)?.trim() && value)) values.set(key, value);
  };

  ensure("APP_ENV", "development");
  ensure("GOOGLE_CALENDAR_RUNTIME_PORT", "4100");
  ensure(
    "GOOGLE_CALENDAR_RUNTIME_DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/vekil_google_calendar"
  );
  ensure("GOOGLE_CALENDAR_RUNTIME_BASE_URL", "http://localhost:4100");
  ensure("VEKIL_APP_MANIFEST_PATH", "../../artifacts/vekil.manifest.json");
  ensure("VEKIL_PLATFORM_ISSUER", "vekil");
  ensure("VEKIL_PLATFORM_JWKS_URL", "http://localhost:4000/api/.well-known/app-runtime-jwks.json");
  ensure("GOOGLE_CALENDAR_CLIENT_ID", "");
  ensure("GOOGLE_CALENDAR_CLIENT_SECRET", "");
  ensure("GOOGLE_CALENDAR_VAULT_KEY_BASE64URL", randomBytes(32).toString("base64url"));

  const manifestPath = resolve(
    process.cwd(),
    values.get("VEKIL_APP_MANIFEST_PATH") ?? "../../artifacts/vekil.manifest.json"
  );
  const manifest = appManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown
  );

  const signingKeyId = values.get("GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID")?.trim();
  const signingPrivateJwk = values
    .get("GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL")
    ?.trim();

  const signingIdentity = readAppRuntimeSigningIdentity({
    manifest,
    keyId: signingKeyId,
    privateJwkBase64url: signingPrivateJwk
  });

  if (!signingIdentity) {
    const material = generateAppRuntimeKeyMaterial({ manifest });
    values.set("GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID", material.keyId);
    values.set(
      "GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL",
      material.privateJwkBase64url
    );
  }

  const output = [...lines];
  for (const [key, value] of values) {
    const index = output.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) output[index] = `${key}=${value}`;
    else output.push(`${key}=${value}`);
  }

  await writeFile(envPath, `${output.join("\n")}\n`, { mode: 0o600 });
  process.stdout.write("Local Google Calendar runtime configuration is ready.\n");
}

void main();

function isNodeError(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
