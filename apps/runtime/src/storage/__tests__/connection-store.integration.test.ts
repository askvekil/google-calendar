import { randomUUID } from "node:crypto";
import { AppInstallationConnectionStatus } from "@vekil/app-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaGoogleCalendarConnectionStore } from "../connection-store";
import { createRuntimePrismaClient, type RuntimePrismaClient } from "../prisma-client";
import { RuntimeVault } from "../runtime-vault";

const runId = randomUUID().replaceAll("-", "");
const installationId = `calendar-store-${runId}`;
const connectionId = `connection-${runId}`;
const authorizationContractHash = "a".repeat(64);
const appVersionId = "calendar-runtime-version-test";
const stateHash = `state-${runId}`;
const completionHash = `completion-${runId}`;
const connectionIdentity = {
  authorizationContractHash,
  connectionId,
  connectionRevision: 1,
  installationId
};
const connectionAuthority = {
  ...connectionIdentity,
  appVersionId
};

describe("Google Calendar Runtime connection storage", () => {
  let prisma: RuntimePrismaClient;
  let store: PrismaGoogleCalendarConnectionStore;

  beforeAll(() => {
    const databaseUrl = process.env.GOOGLE_CALENDAR_RUNTIME_DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("GOOGLE_CALENDAR_RUNTIME_DATABASE_URL is required for integration tests.");
    }

    prisma = createRuntimePrismaClient(databaseUrl);
    store = new PrismaGoogleCalendarConnectionStore(prisma, new RuntimeVault(Buffer.alloc(32, 11)));
  });

  afterAll(async () => {
    await Promise.all([
      prisma.runtimeAuthorizationSession.deleteMany({
        where: { installation_id: installationId }
      }),
      prisma.runtimeCompletion.deleteMany({ where: { installation_id: installationId } }),
      prisma.runtimeCredential.deleteMany({ where: { installation_id: installationId } })
    ]);
    await prisma.$disconnect();
  });

  it("stores provider credentials only as encrypted runtime-owned payload", async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    await store.saveCredential({
      accessToken: "database-access-token",
      accessTokenExpiresAt: expiresAt,
      accountLabel: "owner@example.com",
      authorizedAppVersionId: appVersionId,
      ...connectionIdentity,
      externalAccountId: "google-account-1",
      grantedPermissionKeys: ["identity", "calendar-list"],
      metadata: { name: "Owner" },
      refreshToken: "database-refresh-token",
      runtimeAccountReference: `google_account_${runId}`,
      scopes: ["scope-1"],
      tokenType: "Bearer"
    });

    const raw = await prisma.runtimeCredential.findUniqueOrThrow({
      where: {
        connection_id_connection_revision: {
          connection_id: connectionId,
          connection_revision: 1
        }
      }
    });
    expect(raw.encrypted_payload).not.toContain("database-access-token");
    expect(raw.encrypted_payload).not.toContain("database-refresh-token");
    await expect(store.findCredential(connectionIdentity)).resolves.toMatchObject({
      accessToken: "database-access-token",
      refreshToken: "database-refresh-token",
      accountLabel: "owner@example.com",
      connectionRevision: 1
    });
  });

  it("grants one atomic refresh lease under concurrent claims", async () => {
    const now = new Date();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.claimCredentialRefresh({
          identity: connectionIdentity,
          leaseExpiresAt: new Date(now.getTime() + 30_000),
          now
        })
      )
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    await store.failCredentialRefresh(connectionIdentity);
  });

  it("consumes authorization sessions only once and never after expiry", async () => {
    const now = new Date();
    await store.createAuthorizationSession({
      ...connectionAuthority,
      codeVerifier: "a".repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
      requestedPermissionKeys: ["identity", "calendar-list"],
      returnUrl: "https://vekil.example/apps/google-calendar",
      stateHash
    });

    await expect(store.consumeAuthorizationSession(stateHash, now)).resolves.toMatchObject({
      installationId,
      stateHash
    });
    await expect(store.consumeAuthorizationSession(stateHash, now)).resolves.toBeNull();

    const expiredStateHash = `${stateHash}-expired`;
    await store.createAuthorizationSession({
      ...connectionAuthority,
      codeVerifier: "b".repeat(64),
      expiresAt: new Date(now.getTime() - 1_000),
      requestedPermissionKeys: ["identity", "calendar-list"],
      returnUrl: "https://vekil.example/apps/google-calendar",
      stateHash: expiredStateHash
    });
    await expect(store.consumeAuthorizationSession(expiredStateHash, now)).resolves.toBeNull();
  });

  it("binds a one-time completion token to the exact connection authority", async () => {
    const now = new Date();
    await store.createCompletion({
      ...connectionAuthority,
      accountLabel: "owner@example.com",
      expiresAt: new Date(now.getTime() + 60_000),
      grantedPermissionKeys: ["identity", "calendar-list"],
      runtimeAccountReference: `google_account_${runId}`,
      status: AppInstallationConnectionStatus.CONNECTED,
      tokenHash: completionHash
    });

    await expect(
      store.consumeCompletion(
        completionHash,
        { ...connectionAuthority, connectionRevision: 2 },
        now
      )
    ).resolves.toBeNull();
    await expect(
      store.consumeCompletion(completionHash, connectionAuthority, now)
    ).resolves.toMatchObject({
      installationId,
      connectionId,
      connectionRevision: 1,
      status: AppInstallationConnectionStatus.CONNECTED
    });
    await expect(
      store.consumeCompletion(completionHash, connectionAuthority, now)
    ).resolves.toBeNull();
  });
});
