# Google Calendar App Agent Protocol

This repository is an independently deployed Vekil Remote App.

## Boundaries

- `packages/app` owns the App Definition, Google provider adapter, planning,
  execution, and App-specific tests.
- `apps/runtime` owns OAuth, credentials, encryption, persistence, signing,
  replay protection, and HTTP hosting.
- `scripts` owns deterministic local lifecycle and controlled provider checks.
- `infra/local` owns only this Runtime's isolated local dependencies.
- `docs` explains the public authoring, deployment, and verification workflows.
- Import Vekil contracts only from `@vekil/app-sdk` or
  `@vekil/app-sdk/runtime`. Never import private Vekil workspace packages.
- Google credentials and tokens never enter Vekil or the App Definition.
- Runtime behavior is fail-closed. Do not simulate provider success.
- Prisma fields use `snake_case`; enum types use `PascalCase`; enum values use
  `UPPER_SNAKE_CASE`.

## Before Finishing

Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm definition:validate`,
and `pnpm build`.
Run `pnpm test:integration` when changing OAuth, credentials, replay protection,
or database transactions.
