import type {
  AppInstallationConnectionStatus,
  AppInstallationGrant,
  AppRuntimeErrorCode
} from "@vekil/app-sdk/runtime";

export interface GoogleCalendarConnectionIdentity {
  authorizationContractHash: string;
  connectionId: string;
  connectionRevision: number;
  installationId: string;
}

export interface GoogleCalendarConnectionAuthority extends GoogleCalendarConnectionIdentity {
  appVersionId: string;
}

export interface GoogleCalendarAuthorizationSession extends GoogleCalendarConnectionAuthority {
  codeVerifier: string;
  expiresAt: Date;
  requestedPermissionKeys: string[];
  returnUrl: string;
  stateHash: string;
}

export interface GoogleCalendarStoredCredential extends GoogleCalendarConnectionIdentity {
  accessToken: string;
  accessTokenExpiresAt: Date;
  accountLabel: string;
  authorizedAppVersionId: string;
  externalAccountId: string;
  grantedPermissionKeys: string[];
  idToken?: string;
  metadata: Record<string, unknown>;
  refreshLeaseExpiresAt?: Date;
  refreshToken?: string;
  runtimeAccountReference: string;
  scopes: string[];
  tokenType?: string;
}

interface GoogleCalendarCompletionBase extends GoogleCalendarConnectionAuthority {
  expiresAt: Date;
  tokenHash: string;
}

export type GoogleCalendarCompletion =
  | (GoogleCalendarCompletionBase & {
      status: AppInstallationConnectionStatus.CONNECTED;
      accountLabel: string;
      grantedPermissionKeys: string[];
      runtimeAccountReference: string;
    })
  | (GoogleCalendarCompletionBase & {
      status: AppInstallationConnectionStatus.FAILED;
      error: {
        code: AppRuntimeErrorCode;
        message: string;
        retryable: boolean;
      };
    });

export interface GoogleCalendarConnectionStore {
  claimCredentialRefresh(input: {
    identity: GoogleCalendarConnectionIdentity;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<GoogleCalendarStoredCredential | null>;
  completeCredentialRefresh(
    identity: GoogleCalendarConnectionIdentity,
    credential: GoogleCalendarStoredCredential
  ): Promise<void>;
  consumeAuthorizationSession(
    stateHash: string,
    now: Date
  ): Promise<GoogleCalendarAuthorizationSession | null>;
  consumeCompletion(
    tokenHash: string,
    authority: GoogleCalendarConnectionAuthority,
    now: Date
  ): Promise<GoogleCalendarCompletion | null>;
  createAuthorizationSession(session: GoogleCalendarAuthorizationSession): Promise<void>;
  createCompletion(completion: GoogleCalendarCompletion): Promise<void>;
  deleteCredential(identity: GoogleCalendarConnectionIdentity): Promise<void>;
  failCredentialRefresh(identity: GoogleCalendarConnectionIdentity): Promise<void>;
  findCredential(
    identity: GoogleCalendarConnectionIdentity
  ): Promise<GoogleCalendarStoredCredential | null>;
  saveCredential(credential: GoogleCalendarStoredCredential): Promise<void>;
}

export function readGoogleCalendarConnectionAuthority(
  grant: AppInstallationGrant
): GoogleCalendarConnectionAuthority {
  return {
    appVersionId: grant.appVersionId,
    ...readGoogleCalendarConnectionIdentity(grant)
  };
}

export function readGoogleCalendarConnectionIdentity(
  grant: AppInstallationGrant
): GoogleCalendarConnectionIdentity {
  return {
    authorizationContractHash: grant.authorizationContractHash,
    connectionId: grant.connectionId,
    connectionRevision: grant.connectionRevision,
    installationId: grant.installationId
  };
}
