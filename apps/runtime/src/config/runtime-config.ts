import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import {
  AppRuntimeHost,
  appManifestSchema,
  readAppRuntimeSigningIdentity,
  type AppManifest,
  type AppProtocolSigningIdentity
} from "@vekil/app-sdk/runtime";

const environmentSchema = z.enum(["development", "test", "production"]);
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z.string().min(1).optional()
);
const runtimeUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    );
  }, "Runtime URLs must use HTTPS outside localhost");

const runtimeEnvSchema = z
  .object({
    APP_ENV: environmentSchema,
    GOOGLE_CALENDAR_RUNTIME_PORT: z.coerce.number().int().min(1).max(65_535).default(4_100),
    GOOGLE_CALENDAR_RUNTIME_DATABASE_URL: z.string().min(1),
    GOOGLE_CALENDAR_RUNTIME_BASE_URL: runtimeUrlSchema,
    VEKIL_APP_MANIFEST_PATH: z.string().min(1),
    VEKIL_PLATFORM_ISSUER: z.string().min(1).max(160).default("vekil"),
    VEKIL_PLATFORM_JWKS_URL: runtimeUrlSchema,
    GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID: z.string().min(1),
    GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL: z.string().min(1),
    GOOGLE_CALENDAR_CLIENT_ID: optionalString,
    GOOGLE_CALENDAR_CLIENT_SECRET: optionalString,
    GOOGLE_CALENDAR_VAULT_KEY_BASE64URL: z.string().refine((value) => {
      try {
        return Buffer.from(value, "base64url").byteLength === 32;
      } catch {
        return false;
      }
    }, "Vault key must contain exactly 32 base64url-encoded bytes")
  })
  .superRefine((env, context) => {
    if (Boolean(env.GOOGLE_CALENDAR_CLIENT_ID) !== Boolean(env.GOOGLE_CALENDAR_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        message: "Google Calendar OAuth client fields must be configured together.",
        path: [
          env.GOOGLE_CALENDAR_CLIENT_ID
            ? "GOOGLE_CALENDAR_CLIENT_SECRET"
            : "GOOGLE_CALENDAR_CLIENT_ID"
        ]
      });
    }

    if (env.APP_ENV !== "production") {
      return;
    }

    if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      context.addIssue({
        code: "custom",
        message: "Google Calendar OAuth is required in production.",
        path: ["GOOGLE_CALENDAR_CLIENT_ID"]
      });
    }

    for (const [field, value] of [
      ["GOOGLE_CALENDAR_RUNTIME_BASE_URL", env.GOOGLE_CALENDAR_RUNTIME_BASE_URL],
      ["VEKIL_PLATFORM_JWKS_URL", env.VEKIL_PLATFORM_JWKS_URL]
    ] as const) {
      if (new URL(value).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: `${field} must use HTTPS in production.`,
          path: [field]
        });
      }
    }
  });

export interface GoogleCalendarRuntimeConfig {
  appEnvironment: "development" | "test" | "production";
  baseUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  databaseUrl: string;
  oauthCallbackUrl: string;
  platformIssuer: string;
  platformJwksUrl: string;
  port: number;
  manifest: AppManifest;
  signingIdentity: AppProtocolSigningIdentity;
  vaultKey: Buffer;
}

export function readGoogleCalendarRuntimeConfig(
  source: NodeJS.ProcessEnv = process.env
): GoogleCalendarRuntimeConfig {
  const env = runtimeEnvSchema.parse(source);
  const manifestPath = isAbsolute(env.VEKIL_APP_MANIFEST_PATH)
    ? env.VEKIL_APP_MANIFEST_PATH
    : resolve(process.cwd(), env.VEKIL_APP_MANIFEST_PATH);
  const manifest = appManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8")) as unknown
  );

  if (manifest.runtime.host !== AppRuntimeHost.REMOTE) {
    throw new Error("google_calendar_runtime_manifest_must_be_remote");
  }

  if (
    new URL(manifest.runtime.baseUrl).toString() !==
    new URL(env.GOOGLE_CALENDAR_RUNTIME_BASE_URL).toString()
  ) {
    throw new Error("google_calendar_runtime_manifest_base_url_mismatch");
  }

  const signingIdentity = readAppRuntimeSigningIdentity({
    manifest,
    keyId: env.GOOGLE_CALENDAR_RUNTIME_SIGNING_KEY_ID,
    privateJwkBase64url: env.GOOGLE_CALENDAR_RUNTIME_SIGNING_PRIVATE_JWK_BASE64URL
  });

  if (!signingIdentity) {
    throw new Error("google_calendar_runtime_signing_identity_missing");
  }

  return {
    appEnvironment: env.APP_ENV,
    baseUrl: env.GOOGLE_CALENDAR_RUNTIME_BASE_URL,
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID ?? null,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? null,
    databaseUrl: env.GOOGLE_CALENDAR_RUNTIME_DATABASE_URL,
    oauthCallbackUrl: new URL(
      "/oauth/google/callback",
      env.GOOGLE_CALENDAR_RUNTIME_BASE_URL
    ).toString(),
    manifest,
    platformIssuer: env.VEKIL_PLATFORM_ISSUER,
    platformJwksUrl: env.VEKIL_PLATFORM_JWKS_URL,
    port: env.GOOGLE_CALENDAR_RUNTIME_PORT,
    signingIdentity,
    vaultKey: Buffer.from(env.GOOGLE_CALENDAR_VAULT_KEY_BASE64URL, "base64url")
  };
}
