import { createHash, randomBytes } from "node:crypto";
import {
  AppInstallationConnectionStatus,
  AppRuntimeErrorCode,
  appProtocolVersion,
  type AppCompleteInstallationRequest,
  type AppCompleteInstallationResponse,
  type AppDisconnectInstallationRequest,
  type AppDisconnectInstallationResponse,
  type AppInstallationGrant,
  type AppPrepareInstallationRequest,
  type AppPrepareInstallationResponse
} from "@vekil/app-sdk";
import { googleCalendarProviderScopes } from "../contracts";
import {
  GoogleCalendarOAuthError,
  GoogleCalendarOAuthErrorCode,
  type GoogleCalendarOAuthClient
} from "../provider/oauth-client";
import {
  readGoogleCalendarConnectionAuthority,
  readGoogleCalendarConnectionIdentity
} from "./connection-store";
import type {
  GoogleCalendarAuthorizationSession,
  GoogleCalendarConnectionStore,
  GoogleCalendarStoredCredential
} from "./connection-store";
import type { GoogleCalendarCredentialProvider } from "./executor";

const authorizationLifetimeMs = 10 * 60 * 1_000;
const completionLifetimeMs = 5 * 60 * 1_000;
const refreshLeaseMs = 30_000;
const refreshSkewMs = 60_000;

export interface GoogleCalendarConnectionConfig {
  clientId: string | null;
  clientSecret: string | null;
  oauthCallbackUrl: string;
}

export interface GoogleCalendarOAuthCallbackInput {
  code?: string;
  providerError?: string;
  state?: string;
}

export class GoogleCalendarConnectionService implements GoogleCalendarCredentialProvider {
  private readonly config: GoogleCalendarConnectionConfig;
  private readonly now: () => Date;
  private readonly oauth: GoogleCalendarOAuthClient;
  private readonly store: GoogleCalendarConnectionStore;

  constructor({
    config,
    now = () => new Date(),
    oauth,
    store
  }: {
    config: GoogleCalendarConnectionConfig;
    now?: () => Date;
    oauth: GoogleCalendarOAuthClient;
    store: GoogleCalendarConnectionStore;
  }) {
    this.config = config;
    this.now = now;
    this.oauth = oauth;
    this.store = store;
  }

  async prepareInstallation(
    request: AppPrepareInstallationRequest
  ): Promise<AppPrepareInstallationResponse> {
    if (!this.isConfigured()) {
      return {
        protocolVersion: appProtocolVersion,
        requestId: request.requestId,
        status: AppInstallationConnectionStatus.FAILED,
        error: {
          code: AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE,
          message: "Google Calendar connection is not configured by the App operator.",
          retryable: false
        }
      };
    }

    const oauthConfig = this.requireOAuthConfig();

    const authority = readGoogleCalendarConnectionAuthority(request.grant);
    const existing = await this.store.findCredential(authority);

    if (
      existing &&
      samePermissionKeys(existing.grantedPermissionKeys, request.grant.permissionKeys) &&
      hasRequiredProviderScopes(existing.scopes)
    ) {
      return {
        protocolVersion: appProtocolVersion,
        requestId: request.requestId,
        status: AppInstallationConnectionStatus.CONNECTED,
        connection: credentialAttestation(existing)
      };
    }

    const state = randomToken();
    const codeVerifier = randomToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + authorizationLifetimeMs);
    const session: GoogleCalendarAuthorizationSession = {
      ...authority,
      codeVerifier,
      expiresAt,
      requestedPermissionKeys: [...request.grant.permissionKeys],
      returnUrl: request.returnUrl,
      stateHash: hashToken(state)
    };
    await this.store.createAuthorizationSession(session);
    const authorizationUrl = this.oauth.createAuthorizationUrl({
      clientId: oauthConfig.clientId,
      codeChallenge: hashToken(codeVerifier),
      redirectUri: this.config.oauthCallbackUrl,
      state
    });

    return {
      protocolVersion: appProtocolVersion,
      requestId: request.requestId,
      status: AppInstallationConnectionStatus.ACTION_REQUIRED,
      authorizationUrl: authorizationUrl.toString(),
      authorizationExpiresAt: expiresAt.toISOString()
    };
  }

  async completeInstallation(
    request: AppCompleteInstallationRequest
  ): Promise<AppCompleteInstallationResponse> {
    const completion = await this.store.consumeCompletion(
      hashToken(request.completionToken),
      readGoogleCalendarConnectionAuthority(request.grant),
      this.now()
    );

    if (!completion) {
      return {
        protocolVersion: appProtocolVersion,
        requestId: request.requestId,
        status: AppInstallationConnectionStatus.FAILED,
        error: {
          code: AppRuntimeErrorCode.INVALID_REQUEST,
          message: "The Google Calendar connection completion token is invalid or expired.",
          retryable: false
        }
      };
    }

    if (completion.status === AppInstallationConnectionStatus.FAILED) {
      return {
        protocolVersion: appProtocolVersion,
        requestId: request.requestId,
        status: AppInstallationConnectionStatus.FAILED,
        error: completion.error
      };
    }

    return {
      protocolVersion: appProtocolVersion,
      requestId: request.requestId,
      status: AppInstallationConnectionStatus.CONNECTED,
      connection: {
        accountLabel: completion.accountLabel,
        authorizationContractHash: completion.authorizationContractHash,
        connectionId: completion.connectionId,
        connectionRevision: completion.connectionRevision,
        grantedPermissionKeys: completion.grantedPermissionKeys,
        runtimeAccountReference: completion.runtimeAccountReference
      }
    };
  }

  async disconnectInstallation(
    request: AppDisconnectInstallationRequest
  ): Promise<AppDisconnectInstallationResponse> {
    const identity = readGoogleCalendarConnectionIdentity(request.grant);
    const credential = await this.store.findCredential(identity);

    if (credential) {
      const token = credential.refreshToken ?? credential.accessToken;

      try {
        await this.oauth.revokeToken(token);
      } catch {
        // Local revocation is authoritative even when Google cannot be reached.
      }
    }

    await this.store.deleteCredential(identity);
    return {
      protocolVersion: appProtocolVersion,
      requestId: request.requestId,
      disconnected: true
    };
  }

  async completeOAuthCallback(input: GoogleCalendarOAuthCallbackInput): Promise<URL> {
    const oauthConfig = this.requireOAuthConfig();

    if (!input.state) {
      throw new Error("google_oauth_state_missing");
    }

    const session = await this.store.consumeAuthorizationSession(
      hashToken(input.state),
      this.now()
    );

    if (!session) {
      throw new Error("google_oauth_state_invalid");
    }

    const now = this.now();
    const completionToken = randomToken();

    try {
      if (input.providerError) {
        throw new GoogleCalendarOAuthError({
          code: GoogleCalendarOAuthErrorCode.AUTHORIZATION_REJECTED,
          message: "Google Calendar authorization was cancelled."
        });
      }

      if (!input.code) {
        throw new GoogleCalendarOAuthError({
          code: GoogleCalendarOAuthErrorCode.INVALID_RESPONSE,
          message: "Google did not return an authorization code."
        });
      }

      const token = await this.oauth.exchangeCode({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        code: input.code,
        codeVerifier: session.codeVerifier,
        redirectUri: this.config.oauthCallbackUrl
      });
      assertRequiredScopes(token.scopes);

      if (!token.refreshToken) {
        throw new GoogleCalendarOAuthError({
          code: GoogleCalendarOAuthErrorCode.INVALID_RESPONSE,
          message: "Google did not issue a durable refresh token."
        });
      }

      const identity = await this.oauth.fetchIdentity(token.accessToken);
      const runtimeAccountReference = `google_account_${randomToken()}`;
      await this.store.saveCredential({
        authorizationContractHash: session.authorizationContractHash,
        accessToken: token.accessToken,
        accessTokenExpiresAt: new Date(now.getTime() + token.expiresInSeconds * 1_000),
        accountLabel: identity.email,
        authorizedAppVersionId: session.appVersionId,
        connectionId: session.connectionId,
        connectionRevision: session.connectionRevision,
        externalAccountId: identity.id,
        grantedPermissionKeys: session.requestedPermissionKeys,
        ...(token.idToken ? { idToken: token.idToken } : {}),
        installationId: session.installationId,
        metadata: identity.metadata,
        refreshToken: token.refreshToken,
        runtimeAccountReference,
        scopes: token.scopes,
        ...(token.tokenType ? { tokenType: token.tokenType } : {})
      });
      await this.store.createCompletion({
        accountLabel: identity.email,
        appVersionId: session.appVersionId,
        authorizationContractHash: session.authorizationContractHash,
        connectionId: session.connectionId,
        connectionRevision: session.connectionRevision,
        expiresAt: new Date(now.getTime() + completionLifetimeMs),
        grantedPermissionKeys: session.requestedPermissionKeys,
        installationId: session.installationId,
        runtimeAccountReference,
        status: AppInstallationConnectionStatus.CONNECTED,
        tokenHash: hashToken(completionToken)
      });
    } catch (error) {
      await this.store.createCompletion({
        appVersionId: session.appVersionId,
        authorizationContractHash: session.authorizationContractHash,
        connectionId: session.connectionId,
        connectionRevision: session.connectionRevision,
        error: mapOAuthCompletionError(error),
        expiresAt: new Date(now.getTime() + completionLifetimeMs),
        installationId: session.installationId,
        status: AppInstallationConnectionStatus.FAILED,
        tokenHash: hashToken(completionToken)
      });
    }

    const returnUrl = new URL(session.returnUrl);
    returnUrl.searchParams.set("completion_token", completionToken);
    return returnUrl;
  }

  async getAccessToken(grant: AppInstallationGrant): Promise<string | null> {
    const now = this.now();
    const identity = readGoogleCalendarConnectionIdentity(grant);
    const current = await this.store.findCredential(identity);

    if (
      !current ||
      !samePermissionKeys(current.grantedPermissionKeys, grant.permissionKeys) ||
      !hasRequiredProviderScopes(current.scopes)
    ) {
      return null;
    }

    if (current.accessTokenExpiresAt.getTime() > now.getTime() + refreshSkewMs) {
      return current.accessToken;
    }

    const claimed = await this.store.claimCredentialRefresh({
      identity,
      leaseExpiresAt: new Date(now.getTime() + refreshLeaseMs),
      now
    });

    if (!claimed) {
      return this.waitForRefreshedAccessToken(grant);
    }

    if (!claimed.refreshToken) {
      await this.store.deleteCredential(identity);
      return null;
    }

    const oauthConfig = this.requireOAuthConfig();

    try {
      const refreshed = await this.oauth.refreshToken({
        clientId: oauthConfig.clientId,
        clientSecret: oauthConfig.clientSecret,
        refreshToken: claimed.refreshToken
      });
      const scopes = refreshed.scopes.length > 0 ? refreshed.scopes : claimed.scopes;
      assertRequiredScopes(scopes);
      const credential: GoogleCalendarStoredCredential = {
        ...claimed,
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: new Date(now.getTime() + refreshed.expiresInSeconds * 1_000),
        ...(refreshed.idToken ? { idToken: refreshed.idToken } : {}),
        refreshToken: refreshed.refreshToken ?? claimed.refreshToken,
        scopes,
        ...(refreshed.tokenType ? { tokenType: refreshed.tokenType } : {}),
        refreshLeaseExpiresAt: undefined
      };
      await this.store.completeCredentialRefresh(identity, credential);
      return credential.accessToken;
    } catch (error) {
      if (requiresReconnect(error)) {
        await this.store.deleteCredential(identity);
        return null;
      }

      await this.store.failCredentialRefresh(identity);
      throw error;
    }
  }

  invalidateCredential(grant: AppInstallationGrant): Promise<void> {
    return this.store.deleteCredential(readGoogleCalendarConnectionIdentity(grant));
  }

  private async waitForRefreshedAccessToken(grant: AppInstallationGrant): Promise<string> {
    const identity = readGoogleCalendarConnectionIdentity(grant);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const credential = await this.store.findCredential(identity);

      if (
        credential &&
        samePermissionKeys(credential.grantedPermissionKeys, grant.permissionKeys) &&
        hasRequiredProviderScopes(credential.scopes) &&
        credential.accessTokenExpiresAt.getTime() > this.now().getTime() + refreshSkewMs
      ) {
        return credential.accessToken;
      }
    }

    throw new GoogleCalendarOAuthError({
      code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
      message: "Google Calendar authorization is being refreshed. Try again shortly.",
      retryable: true
    });
  }

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  private requireOAuthConfig(): { clientId: string; clientSecret: string } {
    const { clientId, clientSecret } = this.config;

    if (!clientId || !clientSecret) {
      throw new GoogleCalendarOAuthError({
        code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
        message: "Google Calendar connection is not configured by the App operator."
      });
    }

    return { clientId, clientSecret };
  }
}

function mapOAuthCompletionError(error: unknown): {
  code: AppRuntimeErrorCode;
  message: string;
  retryable: boolean;
} {
  if (error instanceof GoogleCalendarOAuthError) {
    if (error.retryable) {
      return {
        code: AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE,
        message: "Google Calendar could not be connected right now. Try again shortly.",
        retryable: true
      };
    }

    return {
      code: AppRuntimeErrorCode.INVALID_REQUEST,
      message:
        error.code === GoogleCalendarOAuthErrorCode.AUTHORIZATION_REJECTED
          ? "Google Calendar authorization was cancelled."
          : "Google Calendar did not grant the connection permissions it needs.",
      retryable: false
    };
  }

  return {
    code: AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE,
    message: "Google Calendar could not be connected right now. Try again shortly.",
    retryable: true
  };
}

function assertRequiredScopes(scopes: string[]): void {
  if (!hasRequiredProviderScopes(scopes)) {
    throw new GoogleCalendarOAuthError({
      code: GoogleCalendarOAuthErrorCode.MISSING_SCOPE,
      message: "Google Calendar did not grant all required permissions."
    });
  }
}

function hasRequiredProviderScopes(scopes: string[]): boolean {
  const granted = new Set(scopes);
  return googleCalendarProviderScopes.every((scope) => granted.has(scope));
}

function requiresReconnect(error: unknown): boolean {
  return (
    error instanceof GoogleCalendarOAuthError &&
    (error.reconnectRequired ||
      error.code === GoogleCalendarOAuthErrorCode.INVALID_GRANT ||
      error.code === GoogleCalendarOAuthErrorCode.MISSING_SCOPE)
  );
}

function credentialAttestation(credential: GoogleCalendarStoredCredential) {
  return {
    accountLabel: credential.accountLabel,
    authorizationContractHash: credential.authorizationContractHash,
    connectionId: credential.connectionId,
    connectionRevision: credential.connectionRevision,
    grantedPermissionKeys: credential.grantedPermissionKeys,
    runtimeAccountReference: credential.runtimeAccountReference
  };
}

function samePermissionKeys(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((permissionKey) => rightSet.has(permissionKey))
  );
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
