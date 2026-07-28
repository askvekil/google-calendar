# Google Calendar for Vekil

Google Calendar is the reference Remote App for Vekil. It lets a Vekil:

- answer availability questions without exposing private event details;
- find meeting times inside the owner's working hours;
- create approved meetings and send invitations;
- reschedule or cancel an existing event for authenticated requesters;
- respect notice periods and buffers before every calendar write.

The repository contains both the App Definition shown by Vekil and the
independently deployed Runtime that connects to Google.

## Try it locally

### Requirements

- Node.js 22 or newer;
- pnpm 11;
- Docker;
- a Vekil account with App building access;
- a local or hosted Vekil product available in the browser;
- a Google OAuth web client with Calendar API enabled.

### 1. Configure Google OAuth

From this repository:

```bash
pnpm install
pnpm local:reset
```

Add `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` to the
generated `.env`. The OAuth client must allow this redirect URI:

```text
http://localhost:4100/oauth/google/callback
```

See [Google Cloud setup](docs/google-cloud-setup.md) for the complete provider
configuration.

### 2. Import the Definition

Open `/apps/build/new/remote` in Vekil and import
`artifacts/definition.json`. Prepare a test candidate, then download its
manifest to:

```text
artifacts/vekil.manifest.json
```

The manifest is the Runtime contract for that exact candidate. Keep it
unchanged and do not reuse it after the Definition changes.

### 3. Start and test the Runtime

```bash
pnpm local:run
```

Return to the App project in Builder, run the Runtime test, and release that
same tested candidate. You can then install Google Calendar, connect a Google
account, configure scheduling rules, and exercise the public request flow.

The complete acceptance sequence is in
[Local development](docs/local-development.md).

## Repository map

```text
packages/app/
  Definition, App-local contracts, planning, provider adapter, execution

apps/runtime/
  NestJS host, OAuth, encrypted credentials, protocol verification, storage

scripts/
  Runtime setup, signing, local lifecycle, and controlled provider checks

infra/local/
  Isolated PostgreSQL service for the Runtime

docs/
  Architecture, Definition, provider setup, and local verification
```

## Design and security

The Runtime owns the Google OAuth client, provider tokens, encrypted credential
storage, and Google API calls. Tokens never enter the App Definition or Vekil.
Vekil sends signed, scoped requests; the Runtime verifies each request,
protects against replay, and returns typed outcomes.

Calendar writes are idempotent. Availability is checked again immediately
before create or reschedule, so a time that became busy is not silently booked.
Runtime and provider failures fail closed rather than simulating success.

Read [Architecture](docs/architecture.md) and
[App Definition](docs/app-definition.md) for the implementation model.

## Quality gates

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm definition:validate
pnpm test:integration
pnpm build
```

The optional provider smoke test is documented in
[Local development](docs/local-development.md#controlled-provider-smoke-test).

## License

Apache-2.0
