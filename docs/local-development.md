# Local development

The local workflow uses two sibling repositories:

```text
workspace/
  vekil.me/
  vekil-google-calendar/
```

If the repositories are elsewhere, set `VEKIL_CORE_DIR` in this repository's
`.env`.

## Clean start

### Terminal 1: Vekil

```bash
cd ../vekil.me
pnpm install
pnpm dev:clean
```

Wait for Web on port `3000`, API on `4000`, and the worker to become ready.

### Terminal 2: Google Calendar

On the first run:

```bash
pnpm install
pnpm local:env
```

Add the Google OAuth client values to `.env`, then run:

```bash
pnpm dev:clean
```

`dev:clean`:

1. stops only Runtime processes owned by this repository;
2. resets the isolated PostgreSQL container on port `54321`;
3. applies Runtime migrations;
4. compiles and validates the current Definition;
5. prepares an immutable local App candidate in Vekil;
6. configures Runtime signing for that candidate;
7. starts the Runtime on port `4100`;
8. tests and publishes the candidate through the normal App lifecycle;
9. prints the exact installation URL.

Secrets already present in `.env` are preserved. Retired variables are removed
when the environment is prepared.

Use this during normal iteration:

```bash
pnpm dev:local
```

It preserves the Runtime database while rebuilding and republishing the current
Definition.

## End-to-end acceptance flow

1. Open the installation URL printed by `pnpm dev:clean`.
2. Register a fresh Vekil account.
3. Install Google Calendar.
4. Choose **Connect Google Calendar**.
5. Authorize the Google account.
6. Select a calendar and scheduling preferences.
7. Open the account's public Vekil page in a private browser window.
8. Ask to schedule a meeting with a purpose, duration, and preferred time.
9. Provide the requester email when a concrete slot is selected.
10. Approve the request from the Vekil inbox.
11. Confirm that the request completes and the event exists in Google Calendar.

This flow exercises the real OAuth, Runtime protocol, worker, provider API,
approval, and outcome rendering. There is no simulated provider success.

## Useful commands

```bash
pnpm local:stop
pnpm infra:up
pnpm infra:down
pnpm infra:reset
pnpm definition:build
pnpm definition:validate
pnpm db:migrate
```

## Controlled provider smoke test

The provider smoke test is separate from the product E2E. It requires a
dedicated refresh token in `.env`:

```dotenv
GOOGLE_CALENDAR_ACCEPTANCE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ACCEPTANCE_CALENDAR_ID=
GOOGLE_CALENDAR_ACCEPTANCE_TIMEZONE=UTC
```

Read-only calendar discovery and free/busy:

```bash
pnpm smoke:provider
```

Write testing is opt-in:

```dotenv
GOOGLE_CALENDAR_ACCEPTANCE_ALLOW_WRITES=true
GOOGLE_CALENDAR_ACCEPTANCE_ATTENDEE_EMAIL=
```

When enabled, the smoke test creates, updates, and cancels its own uniquely
named event in one run.

## Full verification

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm definition:validate
pnpm test:integration
pnpm build
```
