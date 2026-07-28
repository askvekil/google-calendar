# Architecture

Google Calendar has two explicit parts.

## App Definition

`packages/app/src/definition.ts` describes what the App offers:

- public metadata and localized copy;
- connection permissions;
- supported intents;
- capabilities and actions;
- installation settings and policies;
- typed artifacts and outcomes;
- the context scopes required by each action.

The Definition contains no Google client secret, user credential, access token,
or platform-assigned identity. Vekil compiles it into the immutable Manifest
used for one tested release.

## Remote Runtime

`apps/runtime` is the independently deployable service. It owns:

- the Google OAuth redirect and token exchange;
- encrypted provider credentials;
- access-token refresh coordination;
- signed Vekil protocol handling;
- request replay protection;
- availability reads and event writes;
- Runtime health and public signing keys.

The Runtime database is private to this service. Vekil stores only normalized
installation and connection state.

## Request lifecycle

1. A requester asks for availability or a meeting.
2. Vekil matches the request to a declared intent and gathers only missing
   request details.
3. Vekil creates a scoped action plan from the installed App settings and
   policy result.
4. For a write, the owner reviews the exact proposed change.
5. Vekil signs a Runtime request containing the approved action and scoped App
   Context.
6. The Runtime verifies signature, audience, expiry, nonce, connection
   revision, action schema, and approval.
7. The Runtime refreshes the Google credential if necessary.
8. It rechecks availability immediately before a create or reschedule.
9. It performs the Google API call and returns a typed outcome.
10. Vekil renders the outcome and updates the request state.

The Runtime returns structured facts, artifacts, outcomes, and presentation
data. Vekil remains responsible for conversation wording and durable request
state.

## Provider boundaries

Google-specific concepts remain in this repository:

- OAuth scopes and endpoints;
- calendar and event identifiers;
- free/busy payloads;
- Google Meet creation;
- Google API error mapping;
- provider idempotency.

The App consumes only public contracts from `@vekil/app-sdk` and its documented
subpaths.

## Failure and retry behavior

- Provider requests have bounded timeouts.
- Rate limits and transient provider failures are marked retryable.
- Invalid grants require reconnection.
- Calendar writes carry stable idempotency keys.
- Create uses a deterministic provider event ID and validates collisions.
- A failed Runtime or provider call never produces a successful outcome.
- Disconnect revokes the provider token when possible and always deletes the
  local credential.

## Data protection

- Refresh and access tokens are encrypted before persistence.
- The encryption key is supplied only to the Runtime environment.
- OAuth state and PKCE verifier records are short-lived and single-use.
- Completion tokens are short-lived and single-use.
- Signed Runtime requests are audience-bound and replay-protected.
- Free/busy reads do not require or return event titles.
- The default policy keeps event titles out of requester-facing output.
