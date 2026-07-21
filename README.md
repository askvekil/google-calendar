# Google Calendar for Vekil

An open-source reference Remote App maintained by
[@komronrakhim](https://x.com/komronrakhim). It finds safe meeting times and,
after the required approval, creates, reschedules, or cancels Google Calendar
events.

The App demonstrates a complete production-shaped integration:

- Google OAuth with encrypted token storage;
- calendar discovery and free/busy checks;
- working days, local hours, notice, and meeting buffers;
- progressive meeting coordination with typed choices;
- a fresh availability check immediately before every write;
- signed Runtime requests, replay protection, and idempotent execution;
- explicit approval for create, reschedule, and cancel actions.

## How a meeting request works

The App first learns the meeting purpose and preferred window. It can then
offer suitable times, understand a later selection such as “option 2”, and ask
for the requester's invitation email only after a time is selected. The event
is created only after approval.

Availability and writes always respect the settings chosen during installation.
Request details such as the purpose, selected time, and requester email stay
with that request rather than becoming permanent App settings.

## Repository layout

```text
packages/app/    App Definition, contracts, Google client, planning, execution
apps/runtime/    NestJS HTTP Runtime, OAuth, persistence, encrypted credentials
scripts/         Controlled provider smoke test
artifacts/       Local generated files and the Manifest downloaded from Builder
```

The repository depends only on the public `@vekil/app-sdk` package. Google
client secrets, access tokens, refresh tokens, and encryption keys stay in the
Runtime environment and are never placed in the App Definition.

## Requirements

- Node.js 22 or newer;
- pnpm 11;
- PostgreSQL;
- a Vekil account with App authoring access;
- a Google Cloud OAuth client with Google Calendar API enabled.

## Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy `.env.example` to `.env` and add the Google OAuth client credentials.

3. Build the App Definition:

   ```bash
   pnpm definition:build
   ```

4. In Vekil, open **Apps → Build your App → Import a Remote App** and import
   `artifacts/definition.json`.

5. Prepare a test version in Builder, then download its Manifest to
   `artifacts/vekil.manifest.json`.

6. Generate local Runtime secrets from that Manifest:

   ```bash
   pnpm setup:local
   ```

7. Create the Runtime database and apply migrations:

   ```bash
   pnpm db:migrate
   ```

8. Start the Runtime:

   ```bash
   pnpm dev
   ```

9. Return to Builder and test the prepared version.

Prepare and test a new version after changing the Definition or Runtime
contract. The Runtime refuses to start when its URL, Manifest, or signing
credentials do not agree.

## Google OAuth

`GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` belong to the
deployed Runtime. Configure the callback URL shown by your deployment as an
authorized redirect URI in Google Cloud.

During installation, the user chooses App settings such as the calendar,
default duration, available days and hours, notice, and buffers. OAuth tokens
remain encrypted in the Runtime database.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm definition:validate
pnpm test:integration
```

`pnpm smoke:provider` uses an explicit controlled Google account. It performs
token refresh, calendar discovery, and free/busy reads. Create, update, and
cancel are enabled only when `GOOGLE_CALENDAR_ACCEPTANCE_ALLOW_WRITES=true`.
