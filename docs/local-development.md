# Local development

The App repository is independent from Vekil source code. Local development
uses the same public Builder flow as any other Remote App:

1. build a portable App Definition;
2. import it in Builder;
3. prepare one immutable test candidate;
4. run the Runtime with that candidate's downloaded manifest;
5. test and release the same candidate.

## Prepare the App

```bash
pnpm install
pnpm local:reset
```

`local:reset`:

1. stops Runtime processes owned by this repository;
2. resets the isolated PostgreSQL container on port `54321`;
3. creates `.env` and preserves any existing secrets;
4. applies Runtime migrations;
5. builds `artifacts/definition.json`.

Add `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET` to `.env`
after the first run. See [Google Cloud setup](google-cloud-setup.md).

Use this command when the Runtime database should be preserved:

```bash
pnpm local:prepare
```

## Prepare a Builder candidate

1. Open `/apps/build/new/remote` in the Vekil product.
2. Import `artifacts/definition.json`.
3. Open the created App project.
4. Choose **Prepare test**.
5. Download the generated manifest.
6. Save it as `artifacts/vekil.manifest.json`.

Do not edit the manifest or reuse it for another candidate.

## Start and test the Runtime

```bash
pnpm local:run
```

The command derives a Runtime signing key for the downloaded manifest, starts
the service on port `4100`, waits for readiness, and prints the Builder URL.

Return to the same App project and run the Runtime test. Builder verifies the
deployed protocol against the exact candidate manifest. Release or submit only
after that test passes.

When the Definition changes, rebuild it, import the new file into the existing
project, and prepare a new candidate. A manifest from an older candidate must
not be reused.

## End-to-end acceptance flow

1. Release the tested candidate from Builder.
2. Open its App page and install Google Calendar.
3. Choose **Connect Google Calendar**.
4. Authorize the Google account.
5. Select a calendar and scheduling preferences.
6. Open the account's public Vekil page in a private browser window.
7. Ask to schedule a meeting with a purpose, duration, and preferred time.
8. Select a proposed time and provide the requester email.
9. Approve the request from the Vekil request list.
10. Confirm that the request completes and the event exists in Google Calendar.

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
pnpm runtime:configure
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
