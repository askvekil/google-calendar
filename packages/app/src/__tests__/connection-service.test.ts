import {
  AppInstallationConnectionStatus,
  AppRuntimeErrorCode,
  appCompleteInstallationRequestSchema,
  appDisconnectInstallationRequestSchema,
  appPrepareInstallationRequestSchema,
  appProtocolVersion,
  type AppInstallationGrant
} from "@vekil/app-sdk";
import { describe, expect, it } from "vitest";
import {
  GoogleCalendarConnectionService,
  GoogleCalendarOAuthError,
  GoogleCalendarOAuthErrorCode,
  googleCalendarProviderScopes,
  type GoogleCalendarAuthorizationSession,
  type GoogleCalendarCompletion,
  type GoogleCalendarConnectionAuthority,
  type GoogleCalendarConnectionIdentity,
  type GoogleCalendarConnectionStore,
  type GoogleCalendarOAuthClient,
  type GoogleCalendarStoredCredential
} from "..";
import {
  googleCalendarTestAppVersionId,
  googleCalendarTestBindings
} from "./fixtures/runtime-requests";

const now = new Date("2026-07-11T08:00:00.000Z");
const authorizationContractHash = "a".repeat(64);
const permissionKeys = ["identity", "calendar-list", "availability-read", "event-write"];

describe("GoogleCalendarConnectionService", () => {
  it("fails explicitly when the App operator has not configured OAuth", async () => {
    const service = new GoogleCalendarConnectionService({
      config: {
        clientId: null,
        clientSecret: null,
        oauthCallbackUrl: "http://localhost:4100/oauth/google/callback"
      },
      now: () => now,
      oauth: new FakeOAuthClient(),
      store: new MemoryConnectionStore()
    });

    await expect(service.prepareInstallation(prepareRequest())).resolves.toMatchObject({
      status: AppInstallationConnectionStatus.FAILED,
      error: {
        code: AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE,
        retryable: false
      }
    });
    expect(service.isConfigured()).toBe(false);
  });

  it("completes OAuth once and returns only an opaque runtime attestation", async () => {
    const store = new MemoryConnectionStore();
    const service = createService(store);
    const prepared = await service.prepareInstallation(prepareRequest());
    const state = readAuthorizationState(prepared.authorizationUrl);
    const returnUrl = await service.completeOAuthCallback({ code: "code", state });
    const completionToken = returnUrl.searchParams.get("completion_token");

    expect(returnUrl.origin).toBe("http://localhost:3000");
    expect(completionToken).toBeTruthy();
    expect(returnUrl.searchParams.has("app")).toBe(false);

    const completed = await service.completeInstallation(completeRequest(completionToken ?? ""));
    expect(completed).toMatchObject({
      status: AppInstallationConnectionStatus.CONNECTED,
      connection: {
        accountLabel: "owner@example.com",
        authorizationContractHash,
        connectionId: "connection-1",
        connectionRevision: 1,
        grantedPermissionKeys: permissionKeys
      }
    });
    expect(JSON.stringify(completed)).not.toContain("google-user-1");

    const replayed = await service.completeInstallation(completeRequest(completionToken ?? ""));
    expect(replayed).toMatchObject({
      status: AppInstallationConnectionStatus.FAILED,
      error: { code: AppRuntimeErrorCode.INVALID_REQUEST }
    });
  });

  it("starts a new authorization flow when stored Google scopes no longer satisfy the App", async () => {
    const store = new MemoryConnectionStore();
    store.seedCredential(
      credential({
        accessToken: "still-valid-but-under-scoped",
        accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
        scopes: ["openid"]
      })
    );
    const service = createService(store);

    await expect(service.prepareInstallation(prepareRequest())).resolves.toMatchObject({
      status: AppInstallationConnectionStatus.ACTION_REQUIRED,
      authorizationUrl: expect.stringContaining("accounts.google.com")
    });
    await expect(service.getAccessToken(grant())).resolves.toBeNull();
  });

  it("does not let a completion from an older connection revision authorize a new revision", async () => {
    const store = new MemoryConnectionStore();
    const service = createService(store);
    const prepared = await service.prepareInstallation(prepareRequest());
    const returnUrl = await service.completeOAuthCallback({
      code: "code",
      state: readAuthorizationState(prepared.authorizationUrl)
    });
    const completionToken = returnUrl.searchParams.get("completion_token") ?? "";
    const newerGrant = grant({ connectionRevision: 2, grantId: "grant-2" });

    await expect(
      service.completeInstallation(completeRequest(completionToken, newerGrant))
    ).resolves.toMatchObject({
      status: AppInstallationConnectionStatus.FAILED,
      error: { code: AppRuntimeErrorCode.INVALID_REQUEST }
    });
    await expect(store.findCredential(identity(newerGrant))).resolves.toBeNull();
    await expect(store.findCredential(identity(grant()))).resolves.toMatchObject({
      connectionRevision: 1
    });
  });

  it("returns a typed failed completion when the user cancels Google authorization", async () => {
    const service = createService(new MemoryConnectionStore());
    const prepared = await service.prepareInstallation(prepareRequest());
    const returnUrl = await service.completeOAuthCallback({
      providerError: "access_denied",
      state: readAuthorizationState(prepared.authorizationUrl)
    });
    const completed = await service.completeInstallation(
      completeRequest(returnUrl.searchParams.get("completion_token") ?? "")
    );

    expect(completed).toMatchObject({
      status: AppInstallationConnectionStatus.FAILED,
      error: {
        code: AppRuntimeErrorCode.INVALID_REQUEST,
        retryable: false
      }
    });
  });

  it("destroys the exact local credential even when provider revocation is unavailable", async () => {
    const store = new MemoryConnectionStore();
    const oauth = new FakeOAuthClient({
      revokeError: new GoogleCalendarOAuthError({
        code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
        message: "Google is unavailable.",
        retryable: true
      })
    });
    store.seedCredential(credential());
    const service = createService(store, oauth);

    await expect(service.disconnectInstallation(disconnectRequest())).resolves.toMatchObject({
      disconnected: true
    });
    await expect(store.findCredential(identity(grant()))).resolves.toBeNull();
  });

  it("destroys unusable credentials when refresh state cannot reconnect safely", async () => {
    const scenarios = [
      {
        name: "missing refresh token",
        credential: credential({ refreshToken: undefined }),
        oauth: new FakeOAuthClient()
      },
      {
        name: "invalid grant",
        credential: credential(),
        oauth: new FakeOAuthClient({
          refreshError: new GoogleCalendarOAuthError({
            code: GoogleCalendarOAuthErrorCode.INVALID_GRANT,
            message: "Grant revoked.",
            reconnectRequired: true
          })
        })
      },
      {
        name: "scope downgrade",
        credential: credential(),
        oauth: new FakeOAuthClient({
          refreshResult: {
            accessToken: "scope-downgraded-token",
            expiresInSeconds: 3_600,
            scopes: ["openid"]
          }
        })
      }
    ];

    for (const scenario of scenarios) {
      const store = new MemoryConnectionStore();
      store.seedCredential(scenario.credential);
      const service = createService(store, scenario.oauth);

      await expect(service.getAccessToken(grant()), scenario.name).resolves.toBeNull();
      await expect(store.findCredential(identity(grant())), scenario.name).resolves.toBeNull();
    }
  });

  it("uses one refresh lease for concurrent access-token requests", async () => {
    const store = new MemoryConnectionStore();
    const oauth = new FakeOAuthClient();
    store.seedCredential(credential());
    const service = createService(store, oauth);

    await expect(
      Promise.all([service.getAccessToken(grant()), service.getAccessToken(grant())])
    ).resolves.toEqual(["refreshed-access-token", "refreshed-access-token"]);
    expect(oauth.refreshCalls).toBe(1);
  });
});

function createService(
  store: GoogleCalendarConnectionStore,
  oauth: GoogleCalendarOAuthClient = new FakeOAuthClient()
) {
  return new GoogleCalendarConnectionService({
    config: {
      clientId: "client-id",
      clientSecret: "client-secret",
      oauthCallbackUrl: "http://localhost:4100/oauth/google/callback"
    },
    now: () => now,
    oauth,
    store
  });
}

function disconnectRequest() {
  return appDisconnectInstallationRequestSchema.parse({
    protocolVersion: appProtocolVersion,
    requestId: "request-disconnect-1",
    grant: grant(),
    reason: "owner_disconnect"
  });
}

function credential(
  overrides: Partial<GoogleCalendarStoredCredential> = {}
): GoogleCalendarStoredCredential {
  return {
    accessToken: "expired-access-token",
    accessTokenExpiresAt: new Date(now.getTime() - 1_000),
    accountLabel: "owner@example.com",
    authorizationContractHash,
    authorizedAppVersionId: googleCalendarTestAppVersionId,
    connectionId: "connection-1",
    connectionRevision: 1,
    externalAccountId: "google-user-1",
    grantedPermissionKeys: [...permissionKeys],
    installationId: "installation-1",
    metadata: {},
    refreshToken: "refresh-token",
    runtimeAccountReference: "google_account_runtime_1",
    scopes: [...googleCalendarProviderScopes],
    ...overrides
  };
}

function prepareRequest(inputGrant: AppInstallationGrant = grant()) {
  return appPrepareInstallationRequestSchema.parse({
    protocolVersion: appProtocolVersion,
    requestId: "request-prepare-1",
    grant: inputGrant,
    returnUrl: "http://localhost:3000/apps/calendar-runtime-test/complete",
    locale: "en"
  });
}

function completeRequest(completionToken: string, inputGrant: AppInstallationGrant = grant()) {
  return appCompleteInstallationRequestSchema.parse({
    protocolVersion: appProtocolVersion,
    requestId: "request-complete-1",
    grant: inputGrant,
    completionToken
  });
}

function grant(overrides: Partial<AppInstallationGrant> = {}): AppInstallationGrant {
  return {
    protocolVersion: appProtocolVersion,
    grantId: "grant-1",
    installationId: "installation-1",
    connectionId: "connection-1",
    connectionRevision: 1,
    authorizationContractHash,
    appId: googleCalendarTestBindings.appId,
    appVersionId: googleCalendarTestAppVersionId,
    appVersion: googleCalendarTestBindings.appVersion,
    targetVekilId: "vekil-1",
    runtimeAudience: googleCalendarTestBindings.appId,
    capabilityIds: [],
    permissionKeys: [...permissionKeys],
    contextScopes: [],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides
  };
}

function identity(inputGrant: AppInstallationGrant): GoogleCalendarConnectionIdentity {
  return {
    authorizationContractHash: inputGrant.authorizationContractHash,
    connectionId: inputGrant.connectionId,
    connectionRevision: inputGrant.connectionRevision,
    installationId: inputGrant.installationId
  };
}

function readAuthorizationState(value: string | undefined): string {
  if (!value) throw new Error("authorization_url_missing");
  const state = new URL(value).searchParams.get("state");
  if (!state) throw new Error("authorization_state_missing");
  return state;
}

class FakeOAuthClient implements GoogleCalendarOAuthClient {
  refreshCalls = 0;

  private readonly refreshError?: Error;
  private readonly refreshResult?: Awaited<ReturnType<GoogleCalendarOAuthClient["refreshToken"]>>;
  private readonly revokeError?: Error;

  constructor({
    refreshError,
    refreshResult,
    revokeError
  }: {
    refreshError?: Error;
    refreshResult?: Awaited<ReturnType<GoogleCalendarOAuthClient["refreshToken"]>>;
    revokeError?: Error;
  } = {}) {
    this.refreshError = refreshError;
    this.refreshResult = refreshResult;
    this.revokeError = revokeError;
  }

  createAuthorizationUrl(input: {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }): URL {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("state", input.state);
    return url;
  }

  async exchangeCode() {
    return {
      accessToken: "access-token",
      expiresInSeconds: 3_600,
      refreshToken: "refresh-token",
      scopes: [...googleCalendarProviderScopes]
    };
  }

  async fetchIdentity() {
    return {
      email: "owner@example.com",
      id: "google-user-1",
      metadata: {}
    };
  }

  async refreshToken() {
    this.refreshCalls += 1;
    if (this.refreshError) throw this.refreshError;

    return (
      this.refreshResult ?? {
        accessToken: "refreshed-access-token",
        expiresInSeconds: 3_600,
        scopes: [...googleCalendarProviderScopes]
      }
    );
  }

  async revokeToken(): Promise<void> {
    if (this.revokeError) throw this.revokeError;
  }
}

class MemoryConnectionStore implements GoogleCalendarConnectionStore {
  private readonly authorizations = new Map<string, GoogleCalendarAuthorizationSession>();
  private readonly completions = new Map<string, GoogleCalendarCompletion>();
  private readonly credentials = new Map<string, GoogleCalendarStoredCredential>();
  private readonly refreshClaims = new Set<string>();

  seedCredential(value: GoogleCalendarStoredCredential): void {
    this.credentials.set(identityKey(value), value);
  }

  async createAuthorizationSession(session: GoogleCalendarAuthorizationSession): Promise<void> {
    this.authorizations.set(session.stateHash, session);
  }

  async consumeAuthorizationSession(stateHash: string, currentTime: Date) {
    const session = this.authorizations.get(stateHash) ?? null;
    this.authorizations.delete(stateHash);
    return session && session.expiresAt > currentTime ? session : null;
  }

  async createCompletion(completion: GoogleCalendarCompletion): Promise<void> {
    this.completions.set(completion.tokenHash, completion);
  }

  async consumeCompletion(
    tokenHash: string,
    authority: GoogleCalendarConnectionAuthority,
    currentTime: Date
  ) {
    const completion = this.completions.get(tokenHash) ?? null;
    if (!completion || completion.expiresAt <= currentTime || !sameAuthority(completion, authority)) {
      return null;
    }
    this.completions.delete(tokenHash);
    return completion;
  }

  async saveCredential(value: GoogleCalendarStoredCredential): Promise<void> {
    this.credentials.set(identityKey(value), value);
  }

  async findCredential(value: GoogleCalendarConnectionIdentity) {
    return this.credentials.get(identityKey(value)) ?? null;
  }

  async claimCredentialRefresh({
    identity: value
  }: {
    identity: GoogleCalendarConnectionIdentity;
    leaseExpiresAt: Date;
    now: Date;
  }) {
    const key = identityKey(value);
    if (this.refreshClaims.has(key)) return null;

    const current = this.credentials.get(key) ?? null;
    if (current) this.refreshClaims.add(key);
    return current;
  }

  async completeCredentialRefresh(
    value: GoogleCalendarConnectionIdentity,
    refreshed: GoogleCalendarStoredCredential
  ): Promise<void> {
    const key = identityKey(value);
    this.refreshClaims.delete(key);
    this.credentials.set(key, refreshed);
  }

  async failCredentialRefresh(value: GoogleCalendarConnectionIdentity): Promise<void> {
    this.refreshClaims.delete(identityKey(value));
  }

  async deleteCredential(value: GoogleCalendarConnectionIdentity): Promise<void> {
    const key = identityKey(value);
    this.refreshClaims.delete(key);
    this.credentials.delete(key);
  }
}

function identityKey(value: GoogleCalendarConnectionIdentity): string {
  return [
    value.installationId,
    value.connectionId,
    value.connectionRevision,
    value.authorizationContractHash
  ].join(":");
}

function sameAuthority(
  left: GoogleCalendarConnectionAuthority,
  right: GoogleCalendarConnectionAuthority
): boolean {
  return left.appVersionId === right.appVersionId && identityKey(left) === identityKey(right);
}
