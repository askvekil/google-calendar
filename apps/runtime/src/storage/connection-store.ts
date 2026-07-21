import { AppInstallationConnectionStatus, AppRuntimeErrorCode } from "@vekil/app-sdk";
import type {
  GoogleCalendarAuthorizationSession,
  GoogleCalendarCompletion,
  GoogleCalendarConnectionAuthority,
  GoogleCalendarConnectionIdentity,
  GoogleCalendarConnectionStore,
  GoogleCalendarStoredCredential
} from "@vekil/google-calendar-app";
import { z } from "zod";
import { RuntimeCompletionStatus } from "../generated/prisma/enums";
import type { RuntimePrismaClient } from "./prisma-client";
import type { RuntimeVault } from "./runtime-vault";

const credentialPayloadSchema = z.object({
  accessToken: z.string().min(1),
  idToken: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  refreshToken: z.string().optional(),
  scopes: z.array(z.string()),
  tokenType: z.string().optional()
});

export class PrismaGoogleCalendarConnectionStore implements GoogleCalendarConnectionStore {
  private readonly prisma: RuntimePrismaClient;
  private readonly vault: RuntimeVault;

  constructor(prisma: RuntimePrismaClient, vault: RuntimeVault) {
    this.prisma = prisma;
    this.vault = vault;
  }

  async createAuthorizationSession(session: GoogleCalendarAuthorizationSession): Promise<void> {
    await this.prisma.runtimeAuthorizationSession.create({
      data: {
        app_version_id: session.appVersionId,
        authorization_contract_hash: session.authorizationContractHash,
        connection_id: session.connectionId,
        connection_revision: session.connectionRevision,
        encrypted_code_verifier: this.vault.encrypt(
          { codeVerifier: session.codeVerifier },
          authorizationPurpose(session.stateHash)
        ),
        expires_at: session.expiresAt,
        installation_id: session.installationId,
        requested_permission_keys: session.requestedPermissionKeys,
        return_url: session.returnUrl,
        state_hash: session.stateHash
      }
    });
  }

  async consumeAuthorizationSession(
    stateHash: string,
    now: Date
  ): Promise<GoogleCalendarAuthorizationSession | null> {
    const claimed = await this.prisma.runtimeAuthorizationSession.updateMany({
      data: { consumed_at: now },
      where: {
        consumed_at: null,
        expires_at: { gt: now },
        state_hash: stateHash
      }
    });

    if (claimed.count !== 1) return null;

    const row = await this.prisma.runtimeAuthorizationSession.findUniqueOrThrow({
      where: { state_hash: stateHash }
    });
    const secret = z
      .object({ codeVerifier: z.string().min(43).max(128) })
      .parse(this.vault.decrypt(row.encrypted_code_verifier, authorizationPurpose(stateHash)));

    return {
      appVersionId: row.app_version_id,
      authorizationContractHash: row.authorization_contract_hash,
      codeVerifier: secret.codeVerifier,
      connectionId: row.connection_id,
      connectionRevision: row.connection_revision,
      expiresAt: row.expires_at,
      installationId: row.installation_id,
      requestedPermissionKeys: row.requested_permission_keys,
      returnUrl: row.return_url,
      stateHash: row.state_hash
    };
  }

  async saveCredential(credential: GoogleCalendarStoredCredential): Promise<void> {
    const encryptedPayload = encryptCredential(this.vault, credential);
    await this.prisma.runtimeCredential.upsert({
      create: credentialData(credential, encryptedPayload),
      update: credentialData(credential, encryptedPayload),
      where: {
        connection_id_connection_revision: {
          connection_id: credential.connectionId,
          connection_revision: credential.connectionRevision
        }
      }
    });
  }

  async findCredential(
    identity: GoogleCalendarConnectionIdentity
  ): Promise<GoogleCalendarStoredCredential | null> {
    const row = await this.prisma.runtimeCredential.findFirst({
      where: credentialIdentityWhere(identity)
    });
    return row ? decryptCredential(this.vault, row) : null;
  }

  async claimCredentialRefresh({
    identity,
    leaseExpiresAt,
    now
  }: {
    identity: GoogleCalendarConnectionIdentity;
    leaseExpiresAt: Date;
    now: Date;
  }): Promise<GoogleCalendarStoredCredential | null> {
    const claimed = await this.prisma.runtimeCredential.updateMany({
      data: { refresh_lease_expires_at: leaseExpiresAt },
      where: {
        ...credentialIdentityWhere(identity),
        OR: [{ refresh_lease_expires_at: null }, { refresh_lease_expires_at: { lte: now } }]
      }
    });

    if (claimed.count !== 1) return null;

    const row = await this.prisma.runtimeCredential.findFirstOrThrow({
      where: credentialIdentityWhere(identity)
    });
    return decryptCredential(this.vault, row);
  }

  completeCredentialRefresh(
    identity: GoogleCalendarConnectionIdentity,
    credential: GoogleCalendarStoredCredential
  ): Promise<void> {
    return this.saveCredential({
      ...credential,
      ...identity,
      refreshLeaseExpiresAt: undefined
    });
  }

  async failCredentialRefresh(identity: GoogleCalendarConnectionIdentity): Promise<void> {
    await this.prisma.runtimeCredential.updateMany({
      data: { refresh_lease_expires_at: null },
      where: credentialIdentityWhere(identity)
    });
  }

  async deleteCredential(identity: GoogleCalendarConnectionIdentity): Promise<void> {
    await this.prisma.runtimeCredential.deleteMany({
      where: credentialIdentityWhere(identity)
    });
  }

  async createCompletion(completion: GoogleCalendarCompletion): Promise<void> {
    await this.prisma.runtimeCompletion.create({
      data: {
        account_label:
          completion.status === AppInstallationConnectionStatus.CONNECTED
            ? completion.accountLabel
            : null,
        app_version_id: completion.appVersionId,
        authorization_contract_hash: completion.authorizationContractHash,
        connection_id: completion.connectionId,
        connection_revision: completion.connectionRevision,
        error_code:
          completion.status === AppInstallationConnectionStatus.FAILED
            ? completion.error.code
            : null,
        error_message:
          completion.status === AppInstallationConnectionStatus.FAILED
            ? completion.error.message
            : null,
        error_retryable:
          completion.status === AppInstallationConnectionStatus.FAILED
            ? completion.error.retryable
            : null,
        expires_at: completion.expiresAt,
        granted_permission_keys:
          completion.status === AppInstallationConnectionStatus.CONNECTED
            ? completion.grantedPermissionKeys
            : [],
        installation_id: completion.installationId,
        runtime_account_reference:
          completion.status === AppInstallationConnectionStatus.CONNECTED
            ? completion.runtimeAccountReference
            : null,
        status:
          completion.status === AppInstallationConnectionStatus.CONNECTED
            ? RuntimeCompletionStatus.CONNECTED
            : RuntimeCompletionStatus.FAILED,
        token_hash: completion.tokenHash
      }
    });
  }

  async consumeCompletion(
    tokenHash: string,
    authority: GoogleCalendarConnectionAuthority,
    now: Date
  ): Promise<GoogleCalendarCompletion | null> {
    const claimed = await this.prisma.runtimeCompletion.updateMany({
      data: { consumed_at: now },
      where: {
        app_version_id: authority.appVersionId,
        authorization_contract_hash: authority.authorizationContractHash,
        connection_id: authority.connectionId,
        connection_revision: authority.connectionRevision,
        consumed_at: null,
        expires_at: { gt: now },
        installation_id: authority.installationId,
        token_hash: tokenHash
      }
    });

    if (claimed.count !== 1) return null;

    const row = await this.prisma.runtimeCompletion.findUniqueOrThrow({
      where: { token_hash: tokenHash }
    });
    const base = {
      appVersionId: row.app_version_id,
      authorizationContractHash: row.authorization_contract_hash,
      connectionId: row.connection_id,
      connectionRevision: row.connection_revision,
      expiresAt: row.expires_at,
      installationId: row.installation_id,
      tokenHash: row.token_hash
    };

    if (row.status === RuntimeCompletionStatus.CONNECTED) {
      if (!row.account_label || !row.runtime_account_reference) {
        throw new Error("google_calendar_completion_connected_payload_invalid");
      }

      return {
        ...base,
        accountLabel: row.account_label,
        grantedPermissionKeys: row.granted_permission_keys,
        runtimeAccountReference: row.runtime_account_reference,
        status: AppInstallationConnectionStatus.CONNECTED
      };
    }

    if (!row.error_code || !row.error_message || row.error_retryable === null) {
      throw new Error("google_calendar_completion_failed_payload_invalid");
    }

    return {
      ...base,
      error: {
        code: z.enum(AppRuntimeErrorCode).parse(row.error_code),
        message: row.error_message,
        retryable: row.error_retryable
      },
      status: AppInstallationConnectionStatus.FAILED
    };
  }
}

function credentialData(credential: GoogleCalendarStoredCredential, encryptedPayload: string) {
  return {
    access_token_expires_at: credential.accessTokenExpiresAt,
    account_label: credential.accountLabel,
    authorization_contract_hash: credential.authorizationContractHash,
    authorized_app_version_id: credential.authorizedAppVersionId,
    connection_id: credential.connectionId,
    connection_revision: credential.connectionRevision,
    encrypted_payload: encryptedPayload,
    granted_permission_keys: credential.grantedPermissionKeys,
    installation_id: credential.installationId,
    provider_account_id: credential.externalAccountId,
    refresh_lease_expires_at: credential.refreshLeaseExpiresAt ?? null,
    runtime_account_reference: credential.runtimeAccountReference
  };
}

function credentialIdentityWhere(identity: GoogleCalendarConnectionIdentity) {
  return {
    authorization_contract_hash: identity.authorizationContractHash,
    connection_id: identity.connectionId,
    connection_revision: identity.connectionRevision,
    installation_id: identity.installationId
  };
}

function encryptCredential(
  vault: RuntimeVault,
  credential: GoogleCalendarStoredCredential
): string {
  return vault.encrypt(
    {
      accessToken: credential.accessToken,
      ...(credential.idToken ? { idToken: credential.idToken } : {}),
      metadata: credential.metadata,
      ...(credential.refreshToken ? { refreshToken: credential.refreshToken } : {}),
      scopes: credential.scopes,
      ...(credential.tokenType ? { tokenType: credential.tokenType } : {})
    },
    credentialPurpose(credential)
  );
}

function decryptCredential(
  vault: RuntimeVault,
  row: {
    access_token_expires_at: Date;
    account_label: string;
    authorization_contract_hash: string;
    authorized_app_version_id: string;
    connection_id: string;
    connection_revision: number;
    encrypted_payload: string;
    granted_permission_keys: string[];
    installation_id: string;
    provider_account_id: string;
    refresh_lease_expires_at: Date | null;
    runtime_account_reference: string;
  }
): GoogleCalendarStoredCredential {
  const identity = {
    authorizationContractHash: row.authorization_contract_hash,
    connectionId: row.connection_id,
    connectionRevision: row.connection_revision,
    installationId: row.installation_id
  };
  const payload = credentialPayloadSchema.parse(
    vault.decrypt(row.encrypted_payload, credentialPurpose(identity))
  );

  return {
    accessToken: payload.accessToken,
    accessTokenExpiresAt: row.access_token_expires_at,
    accountLabel: row.account_label,
    authorizationContractHash: row.authorization_contract_hash,
    authorizedAppVersionId: row.authorized_app_version_id,
    connectionId: row.connection_id,
    connectionRevision: row.connection_revision,
    externalAccountId: row.provider_account_id,
    grantedPermissionKeys: row.granted_permission_keys,
    ...(payload.idToken ? { idToken: payload.idToken } : {}),
    installationId: row.installation_id,
    metadata: payload.metadata,
    ...(payload.refreshToken ? { refreshToken: payload.refreshToken } : {}),
    ...(row.refresh_lease_expires_at
      ? { refreshLeaseExpiresAt: row.refresh_lease_expires_at }
      : {}),
    runtimeAccountReference: row.runtime_account_reference,
    scopes: payload.scopes,
    ...(payload.tokenType ? { tokenType: payload.tokenType } : {})
  };
}

function authorizationPurpose(stateHash: string): string {
  return `google-calendar:authorization:${stateHash}`;
}

function credentialPurpose(identity: GoogleCalendarConnectionIdentity): string {
  return [
    "google-calendar",
    "credential",
    identity.connectionId,
    identity.connectionRevision,
    identity.authorizationContractHash
  ].join(":");
}
