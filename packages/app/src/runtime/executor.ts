import { DateTime } from "luxon";
import {
  BubbleActionRiskLevel,
  BubbleActionType,
  BubbleBadgeTone,
  BubbleContentVisibility,
  BubbleSensitivity,
  BubbleType,
  BubbleVariant,
  bubbleDescriptorSchema,
  bubbleSchemaVersion,
  type BubbleDescriptor
} from "@vekil/app-sdk";
import {
  AppExecutionStatus,
  AppRuntimeErrorCode,
  appProtocolVersion,
  jsonObjectSchema,
  readAppActionInput,
  type AppExecuteActionRequest,
  type AppExecuteActionResponse,
  type AppInstallationGrant,
  type JsonObject
} from "@vekil/app-sdk";
import type { AppRuntimeBindings } from "@vekil/app-sdk/runtime";
import {
  GoogleCalendarActionKey,
  GoogleCalendarArtifactKey,
  GoogleCalendarIntentKey,
  GoogleCalendarOutcomeKey,
  availabilityActionInputSchema,
  cancelEventActionInputSchema,
  createEventActionInputSchema,
  updateEventActionInputSchema,
  type GoogleCalendarAvailabilityInput,
  type GoogleCalendarAvailabilitySlot
} from "../contracts";
import {
  GoogleCalendarProviderError,
  GoogleCalendarProviderErrorCode,
  type GoogleCalendarProvider,
  type GoogleCalendarProviderEvent
} from "../provider/calendar-client";
import {
  GoogleCalendarOAuthError,
  GoogleCalendarOAuthErrorCode
} from "../provider/oauth-client";
import { findAvailableMeetingSlots, isMeetingSlotAvailable } from "./availability";
import {
  resolveGoogleCalendarRuntimeCopy,
  type GoogleCalendarRuntimeCopy
} from "./runtime-copy";

const publicRequesterOrigins = [
  "public-authenticated",
  "public-guest",
  "public-verified-external"
] as const;

export interface GoogleCalendarCredentialProvider {
  getAccessToken(grant: AppInstallationGrant): Promise<string | null>;
  invalidateCredential(grant: AppInstallationGrant): Promise<void>;
}

export interface GoogleCalendarExecutionDependencies {
  bindings: AppRuntimeBindings;
  credentials: GoogleCalendarCredentialProvider;
  provider: GoogleCalendarProvider;
}

export async function executeGoogleCalendarAction(
  request: AppExecuteActionRequest,
  dependencies: GoogleCalendarExecutionDependencies
): Promise<AppExecuteActionResponse> {
  const copy = runtimeCopy(request);

  try {
    const accessToken = await dependencies.credentials.getAccessToken(request.grant);

    if (!accessToken) {
      return failed(request, AppRuntimeErrorCode.CONNECTION_REQUIRED, copy.reconnect);
    }

    switch (request.actionId) {
      case dependencies.bindings.actionId(GoogleCalendarActionKey.LIST_CALENDARS):
        return await executeListCalendars(
          request,
          accessToken,
          dependencies.provider,
          dependencies.bindings
        );
      case dependencies.bindings.actionId(GoogleCalendarActionKey.GET_AVAILABILITY):
        return await executeAvailability(
          request,
          accessToken,
          dependencies.provider,
          dependencies.bindings
        );
      case dependencies.bindings.actionId(GoogleCalendarActionKey.CREATE_EVENT):
        return await executeCreateEvent(
          request,
          accessToken,
          dependencies.provider,
          dependencies.bindings
        );
      case dependencies.bindings.actionId(GoogleCalendarActionKey.UPDATE_EVENT):
        return await executeUpdateEvent(
          request,
          accessToken,
          dependencies.provider,
          dependencies.bindings
        );
      case dependencies.bindings.actionId(GoogleCalendarActionKey.CANCEL_EVENT):
        return await executeCancelEvent(
          request,
          accessToken,
          dependencies.provider,
          dependencies.bindings
        );
      default:
        return failed(
          request,
          AppRuntimeErrorCode.ACTION_NOT_SUPPORTED,
          copy.unsupportedAction
        );
    }
  } catch (error) {
    if (
      (error instanceof GoogleCalendarProviderError ||
        error instanceof GoogleCalendarOAuthError) &&
      error.reconnectRequired
    ) {
      await dependencies.credentials.invalidateCredential(request.grant);
    }

    logExecutionError(request, error);
    return mapExecutionError(request, error, copy);
  }
}

async function executeListCalendars(
  request: AppExecuteActionRequest,
  accessToken: string,
  provider: GoogleCalendarProvider,
  bindings: AppRuntimeBindings
): Promise<AppExecuteActionResponse> {
  const calendars = await provider.listCalendars(accessToken);
  const output = jsonObjectSchema.parse({ calendars });

  return succeeded({
    bindings,
    request,
    outcomeKey: GoogleCalendarOutcomeKey.CALENDAR_LIST_SUCCESS,
    output,
    bubbles: []
  });
}

async function executeAvailability(
  request: AppExecuteActionRequest,
  accessToken: string,
  provider: GoogleCalendarProvider,
  bindings: AppRuntimeBindings
): Promise<AppExecuteActionResponse> {
  const parsed = availabilityActionInputSchema.safeParse(readAppActionInput(request.input));

  if (!parsed.success) {
    return invalidInput(request);
  }

  const busy = await provider.getBusyBlocks(accessToken, parsed.data);
  const slots = findAvailableMeetingSlots({
    busy,
    input: parsed.data,
    referenceTime: request.context["issued-at"]
  });
  const output = jsonObjectSchema.parse({ busy, slots });
  const meetingSelectionRequired =
    request.context.request["intent-id"] ===
    bindings.intentId(GoogleCalendarIntentKey.MEETING_CREATE);

  return succeeded({
    bindings,
    request,
    outcomeKey: meetingSelectionRequired
      ? GoogleCalendarOutcomeKey.MEETING_OPTIONS_SUCCESS
      : GoogleCalendarOutcomeKey.AVAILABILITY_SUCCESS,
    output,
    artifacts: [
      {
        artifactId: bindings.artifactId(GoogleCalendarArtifactKey.AVAILABILITY),
        resultKey: "availability",
        schemaVersion: 1,
        value: output
      },
      ...meetingSlotArtifacts(bindings, slots, parsed.data.timezone)
    ],
    bubbles: [
      availabilityBubble(
        parsed.data,
        slots,
        meetingSelectionRequired,
        runtimeCopy(request)
      )
    ]
  });
}

async function executeCreateEvent(
  request: AppExecuteActionRequest,
  accessToken: string,
  provider: GoogleCalendarProvider,
  bindings: AppRuntimeBindings
): Promise<AppExecuteActionResponse> {
  const parsed = createEventActionInputSchema.safeParse(readAppActionInput(request.input));

  if (!parsed.success) {
    return invalidInput(request);
  }

  const input = parsed.data;
  const durationMinutes = readDurationMinutes(input.start, input.end);
  const alternativeWindowEnd = DateTime.fromISO(input.start, { setZone: true })
    .plus({ days: 14 })
    .toISO({ suppressMilliseconds: true });

  if (!durationMinutes || !alternativeWindowEnd) {
    return invalidInput(request);
  }

  const availabilityInput: GoogleCalendarAvailabilityInput = {
    calendarIds: [input.calendarId],
    durationMinutes,
    schedulingConstraints: input.schedulingConstraints,
    timeMin: input.start,
    timeMax: alternativeWindowEnd,
    timezone: input.timezone
  };
  const busy = await provider.getBusyBlocks(accessToken, availabilityInput);

  if (
    !isMeetingSlotAvailable({
      busy,
      end: input.end,
      input: availabilityInput,
      referenceTime: request.context["issued-at"],
      start: input.start
    })
  ) {
    const slots = findAvailableMeetingSlots({
      busy,
      input: availabilityInput,
      referenceTime: request.context["issued-at"]
    });
    return succeeded({
      bindings,
      request,
      outcomeKey: GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE,
      output: jsonObjectSchema.parse({ slots }),
      artifacts: meetingSlotArtifacts(bindings, slots, input.timezone),
      bubbles: [slotUnavailableBubble(slots, input.timezone, runtimeCopy(request))]
    });
  }

  const event = await provider.createEvent(accessToken, input);
  return eventSucceeded(
    request,
    bindings,
    GoogleCalendarOutcomeKey.EVENT_CREATE_SUCCESS,
    input.calendarId,
    input.start,
    input.end,
    input.timezone,
    event,
    runtimeCopy(request).meetingCreatedTitle,
    runtimeCopy(request)
  );
}

async function executeUpdateEvent(
  request: AppExecuteActionRequest,
  accessToken: string,
  provider: GoogleCalendarProvider,
  bindings: AppRuntimeBindings
): Promise<AppExecuteActionResponse> {
  const parsed = updateEventActionInputSchema.safeParse(readAppActionInput(request.input));

  if (!parsed.success) {
    return invalidInput(request);
  }

  const input = parsed.data;
  const durationMinutes = readDurationMinutes(input.start, input.end);
  const alternativeWindowEnd = DateTime.fromISO(input.start, { setZone: true })
    .plus({ days: 14 })
    .toISO({ suppressMilliseconds: true });

  if (!durationMinutes || !alternativeWindowEnd) {
    return invalidInput(request);
  }

  const availabilityInput: GoogleCalendarAvailabilityInput = {
    calendarIds: [input.calendarId],
    durationMinutes,
    schedulingConstraints: input.schedulingConstraints,
    timeMin: input.start,
    timeMax: alternativeWindowEnd,
    timezone: input.timezone
  };
  const busy = await provider.getBusyBlocks(accessToken, availabilityInput);

  if (
    !isMeetingSlotAvailable({
      busy,
      end: input.end,
      input: availabilityInput,
      referenceTime: request.context["issued-at"],
      start: input.start
    })
  ) {
    const slots = findAvailableMeetingSlots({
      busy,
      input: availabilityInput,
      referenceTime: request.context["issued-at"]
    });
    return succeeded({
      bindings,
      request,
      outcomeKey: GoogleCalendarOutcomeKey.RESCHEDULE_SLOT_UNAVAILABLE,
      output: jsonObjectSchema.parse({ slots }),
      artifacts: meetingSlotArtifacts(bindings, slots, input.timezone),
      bubbles: [slotUnavailableBubble(slots, input.timezone, runtimeCopy(request))]
    });
  }

  const event = await provider.updateEvent(accessToken, input);
  return eventSucceeded(
    request,
    bindings,
    GoogleCalendarOutcomeKey.EVENT_UPDATE_SUCCESS,
    input.calendarId,
    input.start,
    input.end,
    input.timezone,
    event,
    runtimeCopy(request).meetingRescheduledTitle,
    runtimeCopy(request)
  );
}

async function executeCancelEvent(
  request: AppExecuteActionRequest,
  accessToken: string,
  provider: GoogleCalendarProvider,
  bindings: AppRuntimeBindings
): Promise<AppExecuteActionResponse> {
  const parsed = cancelEventActionInputSchema.safeParse(readAppActionInput(request.input));

  if (!parsed.success) {
    return invalidInput(request);
  }

  await provider.cancelEvent(accessToken, parsed.data);
  const copy = runtimeCopy(request);

  return succeeded({
    bindings,
    request,
    outcomeKey: GoogleCalendarOutcomeKey.EVENT_CANCEL_SUCCESS,
    output: { provider_id: parsed.data.eventId, status: "cancelled" },
    bubbles: [
      bubbleDescriptorSchema.parse({
        actions: [],
        badges: [{ label: copy.cancelledBadge, tone: BubbleBadgeTone.SUCCESS }],
        body: copy.cancelledBody,
        bubble_type: BubbleType.APP_MESSAGE,
        facts: [
          { label: copy.calendarLabel, value: parsed.data.calendarId },
          { label: copy.eventLabel, value: parsed.data.eventId }
        ],
        schema_version: bubbleSchemaVersion,
        title: copy.cancelledTitle,
        variant: BubbleVariant.SUCCESS
      })
    ]
  });
}

function eventSucceeded(
  request: AppExecuteActionRequest,
  bindings: AppRuntimeBindings,
  outcomeKey: GoogleCalendarOutcomeKey,
  calendarId: string,
  start: string,
  end: string,
  timezone: string,
  event: GoogleCalendarProviderEvent,
  title: string,
  copy: GoogleCalendarRuntimeCopy
): AppExecuteActionResponse {
  const value = {
    "calendar-id": calendarId,
    "provider-id": event.id,
    start,
    end,
    timezone,
    "html-link": event.htmlLink ?? null,
    status: event.status ?? "confirmed"
  };

  return succeeded({
    bindings,
    request,
    outcomeKey,
    output: { provider_id: event.id, html_link: event.htmlLink ?? null },
    artifacts: [
      {
        artifactId: bindings.artifactId(GoogleCalendarArtifactKey.EVENT),
        resultKey: "event",
        schemaVersion: 1,
        value
      }
    ],
    bubbles: [eventBubble(title, start, end, timezone, event.htmlLink, copy)]
  });
}

function availabilityBubble(
  input: GoogleCalendarAvailabilityInput,
  slots: GoogleCalendarAvailabilitySlot[],
  meetingSelectionRequired: boolean,
  copy: GoogleCalendarRuntimeCopy
): BubbleDescriptor {
  return bubbleDescriptorSchema.parse({
    actions: meetingSelectionRequired
      ? meetingSlotSelectionActions(slots, input.timezone, copy)
      : [],
    badges: [
      {
        label: slots.length > 0 ? copy.optionsLabel(slots.length) : copy.noOpenTimes,
        tone: slots.length > 0 ? BubbleBadgeTone.SUCCESS : BubbleBadgeTone.WARNING
      }
    ],
    body:
      slots.length > 0
        ? meetingSelectionRequired
          ? copy.meetingOptionsBody
          : copy.availabilityBody
        : meetingSelectionRequired
          ? copy.noMeetingOptionsBody
          : copy.noAvailabilityBody,
    bubble_type: BubbleType.APP_MESSAGE,
    allowed_origins: [...publicRequesterOrigins],
    facts: slots.map((slot, index) => ({
      label: copy.optionLabel(index + 1),
      value: formatMeetingSlot(slot, input.timezone, copy.locale)
    })),
    footer: input.timezone,
    schema_version: bubbleSchemaVersion,
    sensitivity: BubbleSensitivity.PUBLIC,
    title:
      slots.length > 0
        ? meetingSelectionRequired
          ? copy.chooseTimeTitle
          : copy.availableTimesTitle
        : copy.noAvailableTimesTitle,
    variant: slots.length > 0 ? BubbleVariant.SUCCESS : BubbleVariant.WARNING,
    visibility: BubbleContentVisibility.PUBLIC_REQUESTER
  });
}

function meetingSlotArtifacts(
  bindings: AppRuntimeBindings,
  slots: GoogleCalendarAvailabilitySlot[],
  timezone: string
): AppExecuteActionResponse["artifacts"] {
  return slots.map((slot, index) => ({
    artifactId: bindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT),
    expiresAt: slot.start,
    resultKey: meetingSlotResultKey(index),
    schemaVersion: 1,
    value: {
      "duration-minutes": readDurationMinutes(slot.start, slot.end) ?? 30,
      end: slot.end,
      start: slot.start,
      timezone
    },
    visibilityLevel: "PUBLIC_REQUESTER"
  }));
}

function slotUnavailableBubble(
  slots: GoogleCalendarAvailabilitySlot[],
  timezone: string,
  copy: GoogleCalendarRuntimeCopy
): BubbleDescriptor {
  return bubbleDescriptorSchema.parse({
    actions: meetingSlotSelectionActions(slots, timezone, copy),
    badges: [{ label: copy.timeUnavailableBadge, tone: BubbleBadgeTone.WARNING }],
    body:
      slots.length > 0
        ? copy.slotUnavailableWithAlternativesBody
        : copy.slotUnavailableBody,
    bubble_type: BubbleType.APP_MESSAGE,
    allowed_origins: [...publicRequesterOrigins],
    facts: slots.map((slot, index) => ({
      label: copy.optionLabel(index + 1),
      value: formatMeetingSlot(slot, timezone, copy.locale)
    })),
    schema_version: bubbleSchemaVersion,
    sensitivity: BubbleSensitivity.PUBLIC,
    title: copy.chooseAnotherTimeTitle,
    variant: BubbleVariant.WARNING,
    visibility: BubbleContentVisibility.PUBLIC_REQUESTER
  });
}

function meetingSlotSelectionActions(
  slots: GoogleCalendarAvailabilitySlot[],
  timezone: string,
  copy: GoogleCalendarRuntimeCopy
): BubbleDescriptor["actions"] {
  return slots.map((slot, index) => ({
    action_key: `select-meeting-slot-${index + 1}`,
    action_type: BubbleActionType.SELECT_OPTION,
    allowed_audiences: ["PUBLIC_REQUESTER"],
    allowed_origins: [...publicRequesterOrigins],
    artifact_result_key: meetingSlotResultKey(index),
    label: formatMeetingSlotAction(slot, timezone, copy.locale),
    max_invocations: 1,
    option_group_key: "meeting-slot",
    requires_approval: false,
    risk_level: BubbleActionRiskLevel.LOW
  }));
}

function meetingSlotResultKey(index: number): string {
  return `meeting-slot-${index + 1}`;
}

function eventBubble(
  title: string,
  start: string,
  end: string,
  timezone: string,
  htmlLink: string | undefined,
  copy: GoogleCalendarRuntimeCopy
): BubbleDescriptor {
  return bubbleDescriptorSchema.parse({
    actions: htmlLink
      ? [
          {
            action_key: "open-calendar-event",
            action_type: BubbleActionType.EXTERNAL_URL,
            allowed_audiences: ["OWNER"],
            allowed_origins: [
              "agent-to-agent",
              "agent-to-external-fallback",
              "public-authenticated",
              "public-guest",
              "public-verified-external"
            ],
            href: htmlLink,
            label: copy.openEventAction,
            requires_approval: false,
            risk_level: BubbleActionRiskLevel.LOW
          }
        ]
      : [],
    badges: [{ label: copy.doneBadge, tone: BubbleBadgeTone.SUCCESS }],
    body: copy.eventUpdatedBody,
    bubble_type: BubbleType.APP_MESSAGE,
    allowed_origins: [...publicRequesterOrigins],
    facts: [
      { label: copy.startLabel, value: formatDateTime(start, timezone, copy.locale) },
      { label: copy.endLabel, value: formatDateTime(end, timezone, copy.locale) }
    ],
    schema_version: bubbleSchemaVersion,
    sensitivity: BubbleSensitivity.PUBLIC,
    title,
    variant: BubbleVariant.SUCCESS,
    visibility: BubbleContentVisibility.PUBLIC_REQUESTER
  });
}

function succeeded({
  artifacts = [],
  bindings,
  bubbles,
  outcomeKey,
  output,
  request
}: {
  artifacts?: AppExecuteActionResponse["artifacts"];
  bindings: AppRuntimeBindings;
  bubbles: BubbleDescriptor[];
  outcomeKey: GoogleCalendarOutcomeKey;
  output: JsonObject;
  request: AppExecuteActionRequest;
}): AppExecuteActionResponse {
  return {
    protocolVersion: appProtocolVersion,
    requestId: request.requestId,
    executionId: request.executionId,
    status: AppExecutionStatus.SUCCEEDED,
    output,
    outcomeId: bindings.outcomeId(outcomeKey),
    artifacts,
    bubbles
  };
}

function invalidInput(request: AppExecuteActionRequest): AppExecuteActionResponse {
  return failed(
    request,
    AppRuntimeErrorCode.INVALID_REQUEST,
    runtimeCopy(request).invalidInput
  );
}

function mapExecutionError(
  request: AppExecuteActionRequest,
  error: unknown,
  copy: GoogleCalendarRuntimeCopy
): AppExecuteActionResponse {
  if (error instanceof GoogleCalendarOAuthError) {
    if (
      error.reconnectRequired ||
      error.code === GoogleCalendarOAuthErrorCode.AUTHORIZATION_REJECTED ||
      error.code === GoogleCalendarOAuthErrorCode.INVALID_GRANT ||
      error.code === GoogleCalendarOAuthErrorCode.MISSING_SCOPE
    ) {
      return failed(request, AppRuntimeErrorCode.CONNECTION_REQUIRED, copy.reconnect);
    }

    if (error.code === GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE) {
      return failed(request, AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE, error.message, true);
    }

    return failed(request, AppRuntimeErrorCode.EXECUTION_FAILED, error.message, error.retryable);
  }

  if (!(error instanceof GoogleCalendarProviderError)) {
    return failed(
      request,
      AppRuntimeErrorCode.EXECUTION_FAILED,
      copy.executionFailed
    );
  }

  if (
    error.reconnectRequired ||
    error.code === GoogleCalendarProviderErrorCode.AUTHORIZATION_REJECTED
  ) {
    return failed(request, AppRuntimeErrorCode.CONNECTION_REQUIRED, error.message);
  }

  if (error.code === GoogleCalendarProviderErrorCode.RATE_LIMITED) {
    return failed(request, AppRuntimeErrorCode.RATE_LIMITED, error.message, true);
  }

  if (error.code === GoogleCalendarProviderErrorCode.PROVIDER_UNAVAILABLE) {
    return failed(request, AppRuntimeErrorCode.TEMPORARILY_UNAVAILABLE, error.message, true);
  }

  return failed(request, AppRuntimeErrorCode.EXECUTION_FAILED, error.message, error.retryable);
}

function logExecutionError(request: AppExecuteActionRequest, error: unknown): void {
  if (error instanceof GoogleCalendarProviderError) {
    console.error("Google Calendar provider action failed", {
      action_id: request.actionId,
      code: error.code,
      execution_id: request.executionId,
      reconnect_required: error.reconnectRequired,
      request_id: request.requestId,
      retryable: error.retryable,
      status: error.status ?? null
    });
    return;
  }

  if (error instanceof GoogleCalendarOAuthError) {
    console.error("Google Calendar credential action failed", {
      action_id: request.actionId,
      code: error.code,
      execution_id: request.executionId,
      reconnect_required: error.reconnectRequired,
      request_id: request.requestId,
      retryable: error.retryable
    });
    return;
  }

  console.error("Google Calendar action failed", {
    action_id: request.actionId,
    error_name: error instanceof Error ? error.name : "UnknownError",
    execution_id: request.executionId,
    request_id: request.requestId
  });
}

function failed(
  request: AppExecuteActionRequest,
  code: AppRuntimeErrorCode,
  message: string,
  retryable = false
): AppExecuteActionResponse {
  return {
    protocolVersion: appProtocolVersion,
    requestId: request.requestId,
    executionId: request.executionId,
    status: AppExecutionStatus.FAILED,
    artifacts: [],
    bubbles: [],
    error: { code, message, retryable }
  };
}

function readDurationMinutes(start: string, end: string): number | null {
  const startValue = DateTime.fromISO(start, { setZone: true });
  const endValue = DateTime.fromISO(end, { setZone: true });
  const minutes = endValue.diff(startValue, "minutes").minutes;
  return startValue.isValid && endValue.isValid && minutes >= 5 && minutes <= 480
    ? Math.round(minutes)
    : null;
}

function runtimeCopy(request: AppExecuteActionRequest): GoogleCalendarRuntimeCopy {
  return resolveGoogleCalendarRuntimeCopy(request.context.locale["response-locale"]);
}

function formatMeetingSlot(
  slot: GoogleCalendarAvailabilitySlot,
  timezone: string,
  locale: string
): string {
  const start = DateTime.fromISO(slot.start, { setZone: true })
    .setZone(timezone)
    .setLocale(locale);
  const end = DateTime.fromISO(slot.end, { setZone: true }).setZone(timezone).setLocale(locale);

  if (!start.isValid || !end.isValid) {
    return `${slot.start} – ${slot.end}`;
  }

  return `${start.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)} – ${end.toLocaleString(
    DateTime.TIME_SIMPLE
  )}`;
}

function formatMeetingSlotAction(
  slot: GoogleCalendarAvailabilitySlot,
  timezone: string,
  locale: string
): string {
  const start = DateTime.fromISO(slot.start, { setZone: true })
    .setZone(timezone)
    .setLocale(locale);
  const end = DateTime.fromISO(slot.end, { setZone: true }).setZone(timezone).setLocale(locale);

  if (!start.isValid || !end.isValid) {
    return `${slot.start} – ${slot.end}`.slice(0, 80);
  }

  return `${start.toLocaleString({
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })} – ${end.toLocaleString(DateTime.TIME_SIMPLE)}`;
}

function formatDateTime(value: string, timezone: string, locale: string): string {
  const dateTime = DateTime.fromISO(value, { setZone: true })
    .setZone(timezone)
    .setLocale(locale);

  return dateTime.isValid
    ? dateTime.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)
    : value;
}
