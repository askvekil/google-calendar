# App Definition

The App Definition is the source for everything Vekil needs to present,
configure, understand, and safely invoke Google Calendar.

It is created in `packages/app/src/definition.ts` with `defineRemoteApp`.

## Metadata and publication

`app` contains the localized name and descriptions, the category, and the
provider name. `publication` contains support and legal links shown for this
official App.

## Connection

The App declares one required OAuth connection and four permission groups:

- Google account identity;
- calendar list;
- free/busy availability;
- event writes.

These permission keys are part of the installation grant. The Runtime maps
them to the concrete Google OAuth scopes in `packages/app/src/contracts.ts`.

## Intents

Intents describe requests Vekil can understand:

- `availability-ask`;
- `meeting-create`;
- `meeting-reschedule`;
- `meeting-cancel`.

Each intent defines examples, negative examples, input JSON Schema, field
questions, allowed origins, risk, and the capabilities/actions it may use.
Request fields such as purpose, selected time, or requester email belong to the
request. They are not permanent App settings.

Public guests may ask availability and request a new meeting. Reschedule and
cancel require an authenticated or verified requester because they modify an
existing event.

## Capabilities and actions

Capabilities are the user-facing abilities. Actions are the executable
contracts behind them.

| Capability         | Action             | Side effect | Approval            |
| ------------------ | ------------------ | ----------- | ------------------- |
| List calendars     | `list-calendars`   | Read        | None                |
| Check availability | `get-availability` | Read        | None                |
| Create meeting     | `create-event`     | Write       | Installation policy |
| Reschedule event   | `update-event`     | Write       | Always              |
| Cancel event       | `cancel-event`     | Write       | Always              |

Each action declares its input/output schema, context requirements, timeout,
retry policy, idempotency requirement, artifacts, and possible outcomes.

## Installation settings

Settings let each owner configure the same App for their own calendar:

- calendar;
- default duration;
- available weekdays;
- start and end of the working day;
- buffer before and after meetings;
- minimum notice.

The calendar options are loaded from the connected account through the
read-only `list-calendars` action.

## Policies

The owner chooses:

- how requests from unknown people are approved;
- whether event titles may appear in requester-facing output.

Custom natural-language rules may add time, duration, day, approval, privacy,
or ranking constraints. Rules outside this App's declared families are
rejected rather than guessed.

## Artifacts and outcomes

Artifacts carry typed state between actions:

- `availability`;
- `meeting-slot`;
- `event`.

Outcomes report what actually happened. For example, a stale requested time
returns `slot-unavailable` with fresh meeting-slot artifacts. Vekil can then
offer those alternatives as buttons without inventing provider state.

## Context

The App requests only the scopes needed to plan and execute calendar work:
current request, structured entities, installation settings and policies,
approval result, locale, timezone, and execution metadata.

The full conversation, owner private profile, other App settings, and other App
credentials are explicitly prohibited.

## Validate the Definition

```bash
pnpm definition:build
pnpm definition:validate
```

Generated artifacts are local build output and are not committed.
