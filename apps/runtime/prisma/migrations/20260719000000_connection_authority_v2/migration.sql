DROP TABLE "runtime_completions";
DROP TABLE "runtime_credentials";
DROP TABLE "runtime_authorization_sessions";

CREATE TABLE "runtime_authorization_sessions" (
    "state_hash" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "connection_revision" INTEGER NOT NULL,
    "authorization_contract_hash" TEXT NOT NULL,
    "app_version_id" TEXT NOT NULL,
    "requested_permission_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encrypted_code_verifier" TEXT NOT NULL,
    "return_url" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_authorization_sessions_pkey" PRIMARY KEY ("state_hash")
);

CREATE TABLE "runtime_credentials" (
    "connection_id" TEXT NOT NULL,
    "connection_revision" INTEGER NOT NULL,
    "installation_id" TEXT NOT NULL,
    "authorization_contract_hash" TEXT NOT NULL,
    "authorized_app_version_id" TEXT NOT NULL,
    "runtime_account_reference" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "account_label" TEXT NOT NULL,
    "granted_permission_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encrypted_payload" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runtime_credentials_pkey"
        PRIMARY KEY ("connection_id", "connection_revision")
);

CREATE TABLE "runtime_completions" (
    "token_hash" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "connection_revision" INTEGER NOT NULL,
    "authorization_contract_hash" TEXT NOT NULL,
    "app_version_id" TEXT NOT NULL,
    "status" "RuntimeCompletionStatus" NOT NULL,
    "runtime_account_reference" TEXT,
    "account_label" TEXT,
    "granted_permission_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error_code" TEXT,
    "error_message" TEXT,
    "error_retryable" BOOLEAN,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_completions_pkey" PRIMARY KEY ("token_hash")
);

CREATE INDEX "runtime_authorization_sessions_connection_id_connection_revision_expires_at_idx"
    ON "runtime_authorization_sessions"(
        "connection_id",
        "connection_revision",
        "expires_at"
    );
CREATE INDEX "runtime_authorization_sessions_installation_id_expires_at_idx"
    ON "runtime_authorization_sessions"("installation_id", "expires_at");
CREATE INDEX "runtime_credentials_installation_id_idx"
    ON "runtime_credentials"("installation_id");
CREATE INDEX "runtime_credentials_access_token_expires_at_idx"
    ON "runtime_credentials"("access_token_expires_at");
CREATE INDEX "runtime_completions_connection_id_connection_revision_expires_at_idx"
    ON "runtime_completions"("connection_id", "connection_revision", "expires_at");
CREATE INDEX "runtime_completions_installation_id_expires_at_idx"
    ON "runtime_completions"("installation_id", "expires_at");
