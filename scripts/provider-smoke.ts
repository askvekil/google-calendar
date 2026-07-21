import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type * as GoogleCalendarAppModule from "@vekil/google-calendar-app";

const require = createRequire(import.meta.url);
const {
  defaultGoogleCalendarSchedulingConstraints,
  GoogleCalendarHttpOAuthClient,
  GoogleCalendarHttpProvider
} = require("@vekil/google-calendar-app") as typeof GoogleCalendarAppModule;

const clientId = required("GOOGLE_CALENDAR_CLIENT_ID");
const clientSecret = required("GOOGLE_CALENDAR_CLIENT_SECRET");
const refreshToken = required("GOOGLE_CALENDAR_ACCEPTANCE_REFRESH_TOKEN");
const timezone = process.env.GOOGLE_CALENDAR_ACCEPTANCE_TIMEZONE?.trim() || "UTC";
const oauth = new GoogleCalendarHttpOAuthClient();
const provider = new GoogleCalendarHttpProvider();
const token = await oauth.refreshToken({ clientId, clientSecret, refreshToken });
const calendars = await provider.listCalendars(token.accessToken);
const selectedCalendarId =
  process.env.GOOGLE_CALENDAR_ACCEPTANCE_CALENDAR_ID?.trim() ||
  calendars.find((calendar) => calendar.primary)?.id ||
  calendars[0]?.id;

if (!selectedCalendarId) throw new Error("The connected account has no eligible calendars.");

const start = new Date(Date.now() + 24 * 60 * 60 * 1_000);
const end = new Date(start.getTime() + 30 * 60 * 1_000);
const busy = await provider.getBusyBlocks(token.accessToken, {
  calendarIds: [selectedCalendarId],
  durationMinutes: 30,
  schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
  timeMin: start.toISOString(),
  timeMax: new Date(start.getTime() + 8 * 60 * 60 * 1_000).toISOString(),
  timezone
});

process.stdout.write(
  `${JSON.stringify({ calendars: calendars.length, freeBusyBlocks: busy.length })}\n`
);

if (process.env.GOOGLE_CALENDAR_ACCEPTANCE_ALLOW_WRITES !== "true") {
  process.stdout.write("Write smoke skipped; set GOOGLE_CALENDAR_ACCEPTANCE_ALLOW_WRITES=true.\n");
  process.exit(0);
}

const runId = randomUUID();
const attendeeEmail = process.env.GOOGLE_CALENDAR_ACCEPTANCE_ATTENDEE_EMAIL?.trim();
const event = await provider.createEvent(token.accessToken, {
  attendeeEmails: attendeeEmail ? [attendeeEmail] : [],
  calendarId: selectedCalendarId,
  createGoogleMeet: false,
  description: "Controlled Vekil Google Calendar provider smoke.",
  end: end.toISOString(),
  idempotencyKey: `google-calendar-provider-smoke:${runId}`,
  start: start.toISOString(),
  summary: `Vekil provider smoke ${runId.slice(0, 8)}`,
  schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
  timezone
});

try {
  const updatedStart = new Date(start.getTime() + 15 * 60 * 1_000);
  const updatedEnd = new Date(end.getTime() + 15 * 60 * 1_000);
  await provider.updateEvent(token.accessToken, {
    calendarId: selectedCalendarId,
    end: updatedEnd.toISOString(),
    eventId: event.id,
    idempotencyKey: `google-calendar-provider-smoke-update:${runId}`,
    schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
    start: updatedStart.toISOString(),
    summary: `Vekil provider smoke updated ${runId.slice(0, 8)}`,
    timezone
  });
} finally {
  await provider.cancelEvent(token.accessToken, {
    calendarId: selectedCalendarId,
    eventId: event.id,
    idempotencyKey: `google-calendar-provider-smoke-cancel:${runId}`
  });
}

process.stdout.write("Create, update, and cancel smoke passed.\n");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
