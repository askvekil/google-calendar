import { DateTime } from "luxon";
import {
  AppPlanStatus,
  AppRuntimeErrorCode,
  appProtocolVersion,
  type AppPlanActionRequest,
  type AppPlanActionResponse,
  type JsonObject
} from "@vekil/app-sdk/runtime";
import type { AppRuntimeBindings } from "@vekil/app-sdk/runtime";
import {
  GoogleCalendarActionKey,
  GoogleCalendarIntentKey,
  GoogleCalendarSettingKey,
  GoogleCalendarWeekday,
  defaultGoogleCalendarSchedulingConstraints,
  googleCalendarSchedulingConstraintsSchema,
  type GoogleCalendarSchedulingConstraints
} from "../contracts";

export function planGoogleCalendarAction(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings
): AppPlanActionResponse {
  switch (request.intentId) {
    case bindings.intentId(GoogleCalendarIntentKey.AVAILABILITY_ASK):
      return planAvailability(request, bindings);
    case bindings.intentId(GoogleCalendarIntentKey.MEETING_CREATE):
      return planCreateEvent(request, bindings);
    case bindings.intentId(GoogleCalendarIntentKey.MEETING_RESCHEDULE):
      return planUpdateEvent(request, bindings);
    case bindings.intentId(GoogleCalendarIntentKey.MEETING_CANCEL):
      return planCancelEvent(request, bindings);
    default:
      return rejected(request.requestId, "This Google Calendar intent is not supported.");
  }
}

function planAvailability(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings
): AppPlanActionResponse {
  const missingFields = missing(request.input, ["time-min", "time-max"]);

  if (missingFields.length > 0) {
    return clarification(request.requestId, missingFields);
  }

  const calendarId = readCalendarId(request);
  const timezone = readString(request.input, "timezone") ?? request.context.locale.timezone;
  const durationMinutes =
    readInteger(request.input, "duration-minutes") ?? readDefaultDuration(request);
  const timeMin = readString(request.input, "time-min");
  const timeMax = readString(request.input, "time-max");
  const schedulingConstraints = readSchedulingConstraints(request);

  if (
    !calendarId ||
    !timeMin ||
    !timeMax ||
    !schedulingConstraints ||
    !validRange(timeMin, timeMax)
  ) {
    return rejected(request.requestId, "The requested availability window is invalid.");
  }

  return ready(request, bindings, GoogleCalendarActionKey.GET_AVAILABILITY, {
    calendarIds: [calendarId],
    durationMinutes,
    schedulingConstraints,
    timeMin,
    timeMax,
    timezone
  });
}

function planCreateEvent(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings
): AppPlanActionResponse {
  const start = readString(request.input, "start");
  const timeMin = readString(request.input, "time-min");
  const timeMax = readString(request.input, "time-max");
  const requesterEmail =
    readString(request.input, "requester-email") ?? request.context.viewer.contact?.email ?? null;
  const purpose = readString(request.input, "purpose");
  const missingFields = [
    ...(purpose ? [] : ["purpose"]),
    ...(!start && !timeMin ? ["time-min"] : []),
    ...(!start && !timeMax ? ["time-max"] : []),
    ...(start && !requesterEmail ? ["requester-email"] : [])
  ];

  if (missingFields.length > 0) {
    return clarification(request.requestId, missingFields);
  }

  const calendarId = readCalendarId(request);
  const timezone = readString(request.input, "timezone") ?? request.context.locale.timezone;
  const durationMinutes =
    readInteger(request.input, "duration-minutes") ?? readDefaultDuration(request);
  const schedulingConstraints = readSchedulingConstraints(request);

  if (!calendarId || !purpose || !schedulingConstraints) {
    return rejected(request.requestId, "The calendar scheduling settings are invalid.");
  }

  if (!start && timeMin && timeMax) {
    if (!validRange(timeMin, timeMax)) {
      return rejected(request.requestId, "The requested meeting window is invalid.");
    }

    return ready(request, bindings, GoogleCalendarActionKey.GET_AVAILABILITY, {
      calendarIds: [calendarId],
      durationMinutes,
      schedulingConstraints,
      timeMin,
      timeMax,
      timezone
    });
  }

  const end = readString(request.input, "end") ?? addMinutes(start, durationMinutes);
  if (!start || !end || !requesterEmail || !validRange(start, end)) {
    return rejected(request.requestId, "The requested meeting details are invalid.");
  }

  const attendeeEmails = uniqueStrings([
    requesterEmail,
    ...readStringArray(request.input, "attendee-emails")
  ]);
  const requesterName = request.context.viewer["display-name"]?.trim() || null;
  const requesterReference = requesterName
    ? `${requesterName} <${requesterEmail}>`
    : `requester <${requesterEmail}>`;

  return ready(request, bindings, GoogleCalendarActionKey.CREATE_EVENT, {
    attendeeEmails,
    calendarId,
    createGoogleMeet: true,
    description: [`Purpose: ${purpose}`, `Requested through Vekil by ${requesterReference}.`].join(
      "\n\n"
    ),
    end,
    idempotencyKey: request.context.execution["idempotency-key"],
    schedulingConstraints,
    start,
    summary: readString(request.input, "title") ?? buildMeetingSummary(purpose, requesterName),
    timezone
  });
}

function planUpdateEvent(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings
): AppPlanActionResponse {
  const missingFields = missing(request.input, ["event-id", "start"]);

  if (missingFields.length > 0) {
    return clarification(request.requestId, missingFields);
  }

  const calendarId = readString(request.input, "calendar-id") ?? readCalendarId(request);
  const eventId = readString(request.input, "event-id");
  const timezone = readString(request.input, "timezone") ?? request.context.locale.timezone;
  const start = readString(request.input, "start");
  const schedulingConstraints = readSchedulingConstraints(request);
  const end =
    readString(request.input, "end") ??
    addMinutes(
      start,
      readInteger(request.input, "duration-minutes") ?? readDefaultDuration(request)
    );

  if (
    !calendarId ||
    !eventId ||
    !start ||
    !end ||
    !schedulingConstraints ||
    !validRange(start, end)
  ) {
    return rejected(request.requestId, "The requested reschedule details are invalid.");
  }

  return ready(request, bindings, GoogleCalendarActionKey.UPDATE_EVENT, {
    calendarId,
    end,
    eventId,
    idempotencyKey: request.context.execution["idempotency-key"],
    schedulingConstraints,
    start,
    timezone
  });
}

function planCancelEvent(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings
): AppPlanActionResponse {
  const missingFields = missing(request.input, ["event-id"]);

  if (missingFields.length > 0) {
    return clarification(request.requestId, missingFields);
  }

  const calendarId = readString(request.input, "calendar-id") ?? readCalendarId(request);
  const eventId = readString(request.input, "event-id");

  if (!calendarId || !eventId) {
    return rejected(request.requestId, "The requested cancellation details are invalid.");
  }

  return ready(request, bindings, GoogleCalendarActionKey.CANCEL_EVENT, {
    calendarId,
    eventId,
    idempotencyKey: request.context.execution["idempotency-key"]
  });
}

function ready(
  request: AppPlanActionRequest,
  bindings: AppRuntimeBindings,
  actionKey: GoogleCalendarActionKey,
  input: JsonObject
): AppPlanActionResponse {
  return {
    protocolVersion: appProtocolVersion,
    requestId: request.requestId,
    status: AppPlanStatus.READY,
    actions: [
      {
        stepKey: actionKey,
        actionId: bindings.actionId(actionKey),
        input,
        dependsOn: []
      }
    ],
    missingFields: [],
    grounding: []
  };
}

function clarification(requestId: string, missingFields: string[]): AppPlanActionResponse {
  return {
    protocolVersion: appProtocolVersion,
    requestId,
    status: AppPlanStatus.NEEDS_CLARIFICATION,
    actions: [],
    missingFields,
    grounding: []
  };
}

function rejected(requestId: string, message: string): AppPlanActionResponse {
  return {
    protocolVersion: appProtocolVersion,
    requestId,
    status: AppPlanStatus.REJECTED,
    actions: [],
    missingFields: [],
    grounding: [],
    error: {
      code: AppRuntimeErrorCode.INVALID_REQUEST,
      message,
      retryable: false
    }
  };
}

function missing(input: JsonObject, keys: string[]): string[] {
  return keys.filter((key) => !readString(input, key));
}

function readCalendarId(request: AppPlanActionRequest): string | null {
  return readString(request.context.settings, GoogleCalendarSettingKey.SELECTED_CALENDAR_ID);
}

function readDefaultDuration(request: AppPlanActionRequest): number {
  return (
    readInteger(request.context.settings, GoogleCalendarSettingKey.DEFAULT_DURATION_MINUTES) ?? 30
  );
}

function readSchedulingConstraints(
  request: AppPlanActionRequest
): GoogleCalendarSchedulingConstraints | null {
  const settings = request.context.settings;
  const workingDays = readStringArray(settings, GoogleCalendarSettingKey.WORKING_DAYS).filter(
    (value): value is GoogleCalendarWeekday =>
      Object.values(GoogleCalendarWeekday).includes(value as GoogleCalendarWeekday)
  );
  const minimumNoticeHours = readInteger(settings, GoogleCalendarSettingKey.MINIMUM_NOTICE_HOURS);
  const candidate = {
    workingDays:
      workingDays.length > 0 ? workingDays : defaultGoogleCalendarSchedulingConstraints.workingDays,
    workingDayStart:
      readString(settings, GoogleCalendarSettingKey.WORKING_DAY_START) ??
      defaultGoogleCalendarSchedulingConstraints.workingDayStart,
    workingDayEnd:
      readString(settings, GoogleCalendarSettingKey.WORKING_DAY_END) ??
      defaultGoogleCalendarSchedulingConstraints.workingDayEnd,
    bufferBeforeMinutes:
      readInteger(settings, GoogleCalendarSettingKey.BUFFER_BEFORE_MINUTES) ??
      defaultGoogleCalendarSchedulingConstraints.bufferBeforeMinutes,
    bufferAfterMinutes:
      readInteger(settings, GoogleCalendarSettingKey.BUFFER_AFTER_MINUTES) ??
      defaultGoogleCalendarSchedulingConstraints.bufferAfterMinutes,
    minimumNoticeMinutes:
      (minimumNoticeHours ?? defaultGoogleCalendarSchedulingConstraints.minimumNoticeMinutes / 60) *
      60
  };
  const parsed = googleCalendarSchedulingConstraintsSchema.safeParse(candidate);

  if (!parsed.success || !validDailyWindow(parsed.data)) {
    return null;
  }

  return parsed.data;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return Number.isInteger(value) ? (value as number) : null;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function buildMeetingSummary(purpose: string, requesterName: string | null): string {
  const normalizedPurpose = purpose.replace(/\s+/g, " ").trim();

  if (!requesterName) {
    return normalizedPurpose.length > 120
      ? `${normalizedPurpose.slice(0, 117).trimEnd()}...`
      : normalizedPurpose;
  }

  const suffix = ` - ${requesterName}`;
  const maxPurposeLength = Math.max(1, 120 - suffix.length);
  const boundedPurpose =
    normalizedPurpose.length > maxPurposeLength
      ? `${normalizedPurpose.slice(0, Math.max(1, maxPurposeLength - 3)).trimEnd()}...`
      : normalizedPurpose;

  return `${boundedPurpose}${suffix}`;
}

function addMinutes(value: string | null, minutes: number): string | null {
  if (!value) {
    return null;
  }

  const dateTime = DateTime.fromISO(value, { setZone: true });
  return dateTime.isValid ? dateTime.plus({ minutes }).toISO({ suppressMilliseconds: true }) : null;
}

function validRange(start: string, end: string): boolean {
  const startValue = DateTime.fromISO(start, { setZone: true });
  const endValue = DateTime.fromISO(end, { setZone: true });
  return startValue.isValid && endValue.isValid && endValue > startValue;
}

function validDailyWindow(constraints: GoogleCalendarSchedulingConstraints): boolean {
  const start = DateTime.fromFormat(constraints.workingDayStart, "HH:mm");
  const end = DateTime.fromFormat(constraints.workingDayEnd, "HH:mm");
  return start.isValid && end.isValid && end > start;
}
