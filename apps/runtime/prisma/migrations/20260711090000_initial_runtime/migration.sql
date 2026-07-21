CREATE TYPE "RuntimeCompletionStatus" AS ENUM ('CONNECTED', 'FAILED');

CREATE TABLE "runtime_authorization_sessions" (
    "state_hash" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "encrypted_code_verifier" TEXT NOT NULL,
    "return_url" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_authorization_sessions_pkey" PRIMARY KEY ("state_hash")
);

CREATE TABLE "runtime_credentials" (
    "installation_id" TEXT NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "external_account_label" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "runtime_credentials_pkey" PRIMARY KEY ("installation_id")
);

CREATE TABLE "runtime_completions" (
    "token_hash" TEXT NOT NULL,
    "installation_id" TEXT NOT NULL,
    "status" "RuntimeCompletionStatus" NOT NULL,
    "external_account_id" TEXT,
    "external_account_label" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_retryable" BOOLEAN,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_completions_pkey" PRIMARY KEY ("token_hash")
);

CREATE TABLE "runtime_signature_replays" (
    "replay_key" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runtime_signature_replays_pkey" PRIMARY KEY ("replay_key")
);

CREATE INDEX "runtime_authorization_sessions_installation_id_expires_at_idx"
ON "runtime_authorization_sessions"("installation_id", "expires_at");

CREATE INDEX "runtime_credentials_access_token_expires_at_idx"
ON "runtime_credentials"("access_token_expires_at");

CREATE INDEX "runtime_completions_installation_id_expires_at_idx"
ON "runtime_completions"("installation_id", "expires_at");

CREATE INDEX "runtime_signature_replays_expires_at_idx"
ON "runtime_signature_replays"("expires_at");
