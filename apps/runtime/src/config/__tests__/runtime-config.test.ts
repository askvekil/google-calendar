import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppSignatureAlgorithm, compileAppDefinitionOrThrow } from "@vekil/app-sdk";
import { createGoogleCalendarDefinition } from "@vekil/google-calendar-app";
import { afterAll, describe, expect, it } from "vitest";
import { readGoogleCalendarRuntimeConfig } from "../runtime-config";

const fixtureDirectory = mkdtempSync(join(tmpdir(), "vekil-google-calendar-runtime-"));
const developmentManifestPath = writeManifest("http://localhost:4100");
const productionManifestPath = writeManifest("https://calendar-runtime.vekil.example");
const signingKeyId = "google-calendar-test-1";
const { privateKey } = generateKeyPairSync("ed25519");
const signingPrivateJwk = Buffer.from(
  JSON.stringify({
    ...privateKey.export({ format: "jwk" }),
    alg: AppSignatureAlgorithm.ED25519,
    crv: "Ed25519",
    kid: signingKeyId,
    kty: "OKP",
    use: "sig"
  }),
  "utf8"
).toString("base64url");
const baseEnv = {
  APP_ENV: "development",
  GOOGLE_CALENDAR_RUNTIME_BASE_URL: "http://localhost:4100",
  GOOGLE_CALENDAR_RUNTIME_DATABASE_URL:
    "postgresql://postgres:postgres@localhost:5432/vekil_google_calendar",
  GOOGLE_CALENDAR_RUNTIME_PORT: "4100",
  VEKIL_APP_MANIFEST_PATH: developmentManifestPath,
  GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID: signingKeyId,
  GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL: signingPrivateJwk,
  GOOGLE_CALENDAR_VAULT_KEY_BASE64URL: Buffer.alloc(32, 7).toString("base64url"),
  VEKIL_PLATFORM_ISSUER: "vekil",
  VEKIL_PLATFORM_JWKS_URL: "http://localhost:4000/api/.well-known/app-runtime-jwks.json"
} as const;

afterAll(() => {
  rmSync(fixtureDirectory, { force: true, recursive: true });
});

describe("Google Calendar Runtime configuration", () => {
  it("allows an explicitly degraded development runtime without provider credentials", () => {
    const config = readGoogleCalendarRuntimeConfig(baseEnv);

    expect(config.appEnvironment).toBe("development");
    expect(config.clientId).toBeNull();
    expect(config.clientSecret).toBeNull();
  });

  it("rejects a partial OAuth client configuration", () => {
    expect(() =>
      readGoogleCalendarRuntimeConfig({
        ...baseEnv,
        GOOGLE_CALENDAR_CLIENT_ID: "client-id"
      })
    ).toThrow();
  });

  it("requires provider credentials and HTTPS boundaries in production", () => {
    expect(() =>
      readGoogleCalendarRuntimeConfig({
        ...baseEnv,
        APP_ENV: "production"
      })
    ).toThrow();

    expect(() =>
      readGoogleCalendarRuntimeConfig({
        ...baseEnv,
        APP_ENV: "production",
        GOOGLE_CALENDAR_CLIENT_ID: "client-id",
        GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret"
      })
    ).toThrow();
  });

  it("accepts a complete production operator configuration", () => {
    const config = readGoogleCalendarRuntimeConfig({
      ...baseEnv,
      APP_ENV: "production",
      GOOGLE_CALENDAR_CLIENT_ID: "client-id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
      GOOGLE_CALENDAR_RUNTIME_BASE_URL: "https://calendar-runtime.vekil.example",
      VEKIL_APP_MANIFEST_PATH: productionManifestPath,
      VEKIL_PLATFORM_JWKS_URL: "https://api.vekil.example/api/.well-known/app-runtime-jwks.json"
    });

    expect(config.appEnvironment).toBe("production");
    expect(config.clientId).toBe("client-id");
    expect(config.oauthCallbackUrl).toBe(
      "https://calendar-runtime.vekil.example/oauth/google/callback"
    );
  });
});

function writeManifest(baseUrl: string): string {
  const manifest = compileAppDefinitionOrThrow(createGoogleCalendarDefinition({ baseUrl }), {
    appId: "calendar-runtime-config-test",
    appOfficial: false,
    developer: {
      handle: "@komronrakhim",
      id: "builder-komronrakhim",
      name: "Komron Rakhimov",
      officialTeamMember: false,
      verified: true
    },
    releaseVersion: "1.0.0",
    slug: "calendar-runtime-config-test"
  });
  const path = join(
    fixtureDirectory,
    new URL(baseUrl).protocol === "https:" ? "production.json" : "development.json"
  );
  writeFileSync(path, JSON.stringify(manifest), "utf8");
  return path;
}
