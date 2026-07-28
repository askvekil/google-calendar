import {
  AppBubbleActionType,
  BubbleActionRiskLevel,
  BubbleAudience,
  BubbleContentVisibility,
  BubbleOrigin,
  BubbleSensitivity
} from "@vekil/app-sdk/bubbles";
import {
  AppExecutionStatus,
  AppRuntimeErrorCode,
  appContextArtifactInputKey,
  appExecuteActionResponseSchema,
  type AppInstallationGrant
} from "@vekil/app-sdk/runtime";
import { describe, expect, it } from "vitest";
import {
  GoogleCalendarActionKey,
  GoogleCalendarArtifactKey,
  GoogleCalendarIntentKey,
  GoogleCalendarOutcomeKey,
  GoogleCalendarProviderError,
  GoogleCalendarProviderErrorCode,
  defaultGoogleCalendarSchedulingConstraints,
  executeGoogleCalendarAction,
  type GoogleCalendarCredentialProvider,
  type GoogleCalendarProvider
} from "..";
import {
  createCalendarExecutionRequest,
  googleCalendarTestBindings
} from "./fixtures/runtime-requests";

describe("Google Calendar execution acceptance", () => {
  it("invalidates the runtime credential and requests reconnect after provider authorization loss", async () => {
    const credentials = new MemoryCredentialProvider();
    const provider = createProvider({
      listCalendars: async () => {
        throw new GoogleCalendarProviderError({
          code: GoogleCalendarProviderErrorCode.AUTHORIZATION_REJECTED,
          message: "Authorization expired.",
          reconnectRequired: true,
          status: 401
        });
      }
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.LIST_CALENDARS,
      input: {}
    });

    await expect(
      executeGoogleCalendarAction(request, {
        bindings: googleCalendarTestBindings,
        credentials,
        provider
      })
    ).resolves.toMatchObject({
      status: AppExecutionStatus.FAILED,
      error: {
        code: AppRuntimeErrorCode.CONNECTION_REQUIRED,
        retryable: false
      }
    });
    expect(credentials.invalidated).toEqual([
      {
        connectionId: "connection-calendar-1",
        connectionRevision: 1,
        installationId: "installation-calendar-1"
      }
    ]);
  });

  it("returns a retryable typed failure when Google rate limits execution", async () => {
    const provider = createProvider({
      listCalendars: async () => {
        throw new GoogleCalendarProviderError({
          code: GoogleCalendarProviderErrorCode.RATE_LIMITED,
          message: "Rate limited.",
          retryable: true,
          status: 429
        });
      }
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.LIST_CALENDARS,
      input: {}
    });

    await expect(
      executeGoogleCalendarAction(request, {
        bindings: googleCalendarTestBindings,
        credentials: new MemoryCredentialProvider(),
        provider
      })
    ).resolves.toMatchObject({
      status: AppExecutionStatus.FAILED,
      error: {
        code: AppRuntimeErrorCode.RATE_LIMITED,
        retryable: true
      }
    });
  });

  it("marks normalized availability results as safe for the public requester", async () => {
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.GET_AVAILABILITY,
      input: {
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        timeMax: "2026-07-20T16:00:00+05:00",
        timeMin: "2026-07-20T15:00:00+05:00",
        timezone: "Asia/Samarkand"
      },
      intentKey: GoogleCalendarIntentKey.AVAILABILITY_ASK
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider({
        getBusyBlocks: async () => []
      })
    });

    expect(() => appExecuteActionResponseSchema.parse(result)).not.toThrow();
    expect(result).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          artifactId: googleCalendarTestBindings.artifactId(GoogleCalendarArtifactKey.AVAILABILITY),
          resultKey: "availability"
        }),
        expect.objectContaining({
          artifactId: googleCalendarTestBindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT),
          resultKey: "meeting-slot-1",
          visibilityLevel: "PUBLIC_REQUESTER"
        })
      ]),
      bubbles: [
        {
          actions: [],
          allowed_origins: expect.arrayContaining([BubbleOrigin.PUBLIC_GUEST]),
          sensitivity: BubbleSensitivity.PUBLIC,
          visibility: BubbleContentVisibility.PUBLIC_REQUESTER
        }
      ],
      outcomeId: googleCalendarTestBindings.outcomeId(
        GoogleCalendarOutcomeKey.AVAILABILITY_SUCCESS
      ),
      status: AppExecutionStatus.SUCCEEDED
    });
    expect(
      result.artifacts.filter(
        (artifact) =>
          artifact.artifactId ===
          googleCalendarTestBindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT)
      )
    ).not.toHaveLength(0);
  });

  it("keeps meeting-option discovery open for the requester to choose a time", async () => {
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.GET_AVAILABILITY,
      input: {
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        timeMax: "2026-07-20T18:00:00+05:00",
        timeMin: "2026-07-20T14:00:00+05:00",
        timezone: "Asia/Samarkand"
      },
      intentKey: GoogleCalendarIntentKey.MEETING_CREATE
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider()
    });

    expect(result).toMatchObject({
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          artifactId: googleCalendarTestBindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT),
          visibilityLevel: "PUBLIC_REQUESTER"
        })
      ]),
      bubbles: [{ title: "Choose a time" }],
      outcomeId: googleCalendarTestBindings.outcomeId(
        GoogleCalendarOutcomeKey.MEETING_OPTIONS_SUCCESS
      ),
      status: AppExecutionStatus.SUCCEEDED
    });
    expect(
      result.artifacts.filter(
        (artifact) =>
          artifact.artifactId ===
          googleCalendarTestBindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT)
      )
    ).toHaveLength(5);
    expect(result.bubbles[0]?.actions).toHaveLength(5);
    expect(result.bubbles[0]?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action_key: "select-meeting-slot-1",
          action_type: AppBubbleActionType.SELECT_OPTION,
          artifact_result_key: "meeting-slot-1",
          allowed_audiences: [BubbleAudience.PUBLIC_REQUESTER],
          max_invocations: 1,
          option_group_key: "meeting-slot",
          requires_approval: false,
          risk_level: BubbleActionRiskLevel.LOW
        })
      ])
    );
  });

  it("renders requester-visible meeting options in the response locale", async () => {
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.GET_AVAILABILITY,
      input: {
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        timeMax: "2026-07-20T18:00:00+05:00",
        timeMin: "2026-07-20T14:00:00+05:00",
        timezone: "Asia/Samarkand"
      },
      intentKey: GoogleCalendarIntentKey.MEETING_CREATE,
      responseLocale: "ru-RU"
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider()
    });

    expect(result.bubbles[0]).toMatchObject({
      body: expect.stringContaining("Выберите удобное время"),
      actions: [
        {
          artifact_result_key: "meeting-slot-1",
          label: expect.stringContaining("20 июл.")
        },
        ...Array.from({ length: 4 }, () => expect.any(Object))
      ],
      facts: [
        {
          label: "Вариант 1",
          value: expect.stringContaining("20 июл.")
        },
        ...Array.from({ length: 4 }, () => expect.any(Object))
      ],
      title: "Выберите время"
    });
  });

  it("does not create an event when the requested slot became busy", async () => {
    let createCalls = 0;
    const provider = createProvider({
      getBusyBlocks: async () => [
        {
          start: "2026-07-14T10:05:00Z",
          end: "2026-07-14T10:35:00Z"
        }
      ],
      createEvent: async () => {
        createCalls += 1;
        return { id: "should-not-exist" };
      }
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.CREATE_EVENT,
      input: createEventInput()
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider
    });

    expect(result).toMatchObject({
      status: AppExecutionStatus.SUCCEEDED,
      outcomeId: googleCalendarTestBindings.outcomeId(GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE)
    });
    expect(createCalls).toBe(0);
    expect(result.bubbles).toHaveLength(1);
    expect(result.bubbles[0]).toMatchObject({
      allowed_origins: expect.arrayContaining([BubbleOrigin.PUBLIC_GUEST]),
      sensitivity: BubbleSensitivity.PUBLIC,
      title: "Choose another time",
      visibility: BubbleContentVisibility.PUBLIC_REQUESTER
    });
  });

  it("returns an event artifact and requester-safe Bubble after creation", async () => {
    const provider = createProvider({
      getBusyBlocks: async () => [],
      createEvent: async () => ({
        id: "provider-event-1",
        htmlLink: "https://calendar.google.com/calendar/event?eid=test",
        status: "confirmed"
      })
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.CREATE_EVENT,
      input: createEventInput()
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider
    });

    expect(result).toMatchObject({
      status: AppExecutionStatus.SUCCEEDED,
      outcomeId: googleCalendarTestBindings.outcomeId(
        GoogleCalendarOutcomeKey.EVENT_CREATE_SUCCESS
      ),
      output: {
        provider_id: "provider-event-1"
      }
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.bubbles).toHaveLength(1);
    expect(result.bubbles[0]).toMatchObject({
      actions: [
        expect.objectContaining({
          action_key: "open-calendar-event",
          allowed_audiences: [BubbleAudience.OWNER]
        })
      ],
      allowed_origins: expect.arrayContaining([BubbleOrigin.PUBLIC_GUEST]),
      facts: [
        expect.objectContaining({ label: "Start" }),
        expect.objectContaining({ label: "End" })
      ],
      sensitivity: BubbleSensitivity.PUBLIC,
      visibility: BubbleContentVisibility.PUBLIC_REQUESTER
    });
    expect(JSON.stringify(result)).not.toContain("access-token");
  });

  it("keeps typed artifact context outside the strict action input schema", async () => {
    let createCalls = 0;
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.CREATE_EVENT,
      input: {
        ...createEventInput(),
        [appContextArtifactInputKey]: [
          {
            artifactId: googleCalendarTestBindings.artifactId(
              GoogleCalendarArtifactKey.MEETING_SLOT
            ),
            cardinality: "ONE",
            provenance: [
              {
                requestArtifactId: "request-artifact-slot-1",
                sensitivityLevel: "LOW",
                shareableWithApps: false,
                sourceActionId: googleCalendarTestBindings.actionId(
                  GoogleCalendarActionKey.GET_AVAILABILITY
                ),
                sourceAppExecutionAttemptId: "source-attempt-1",
                sourceAppExecutionId: "source-execution-1",
                sourceStepId: "source-step-1",
                sourceStepKey: "availability",
                visibilityLevel: "PUBLIC_REQUESTER"
              }
            ],
            schemaVersion: 1,
            value: {
              durationMinutes: 30,
              end: "2026-07-14T15:30:00+05:00",
              start: "2026-07-14T15:00:00+05:00",
              timezone: "Asia/Samarkand"
            }
          }
        ]
      }
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider({
        createEvent: async () => {
          createCalls += 1;
          return { id: "provider-event-with-artifact" };
        }
      })
    });

    expect(result).toMatchObject({
      status: AppExecutionStatus.SUCCEEDED,
      outcomeId: googleCalendarTestBindings.outcomeId(GoogleCalendarOutcomeKey.EVENT_CREATE_SUCCESS)
    });
    expect(createCalls).toBe(1);
  });

  it("does not create an event outside the configured working schedule", async () => {
    let createCalls = 0;
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.CREATE_EVENT,
      input: {
        ...createEventInput(),
        end: "2026-07-14T20:30:00+05:00",
        start: "2026-07-14T20:00:00+05:00"
      }
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider({
        createEvent: async () => {
          createCalls += 1;
          return { id: "should-not-exist" };
        }
      })
    });

    expect(result.outcomeId).toBe(
      googleCalendarTestBindings.outcomeId(GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE)
    );
    expect(createCalls).toBe(0);
  });

  it("returns a typed event outcome after an approved reschedule", async () => {
    const provider = createProvider({
      updateEvent: async () => ({
        id: "provider-event-1",
        htmlLink: "https://calendar.google.com/calendar/event?eid=test",
        status: "confirmed"
      })
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.UPDATE_EVENT,
      input: {
        calendarId: "primary",
        end: "2026-07-14T16:30:00+05:00",
        eventId: "provider-event-1",
        idempotencyKey: "calendar-update-key-1",
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        start: "2026-07-14T16:00:00+05:00",
        timezone: "Asia/Samarkand"
      }
    });

    await expect(
      executeGoogleCalendarAction(request, {
        bindings: googleCalendarTestBindings,
        credentials: new MemoryCredentialProvider(),
        provider
      })
    ).resolves.toMatchObject({
      status: AppExecutionStatus.SUCCEEDED,
      outcomeId: googleCalendarTestBindings.outcomeId(
        GoogleCalendarOutcomeKey.EVENT_UPDATE_SUCCESS
      ),
      output: { provider_id: "provider-event-1" }
    });
  });

  it("does not reschedule an event into a conflicting slot", async () => {
    let updateCalls = 0;
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.UPDATE_EVENT,
      input: {
        calendarId: "primary",
        end: "2026-07-14T16:30:00+05:00",
        eventId: "provider-event-1",
        idempotencyKey: "calendar-update-conflict-key-1",
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        start: "2026-07-14T16:00:00+05:00",
        timezone: "Asia/Samarkand"
      },
      intentKey: GoogleCalendarIntentKey.MEETING_RESCHEDULE
    });
    const result = await executeGoogleCalendarAction(request, {
      bindings: googleCalendarTestBindings,
      credentials: new MemoryCredentialProvider(),
      provider: createProvider({
        getBusyBlocks: async () => [
          {
            end: "2026-07-14T11:20:00Z",
            start: "2026-07-14T11:05:00Z"
          }
        ],
        updateEvent: async () => {
          updateCalls += 1;
          return { id: "should-not-update" };
        }
      })
    });

    expect(result.outcomeId).toBe(
      googleCalendarTestBindings.outcomeId(GoogleCalendarOutcomeKey.RESCHEDULE_SLOT_UNAVAILABLE)
    );
    expect(updateCalls).toBe(0);
  });

  it("returns a typed terminal outcome after an approved cancellation", async () => {
    let cancelledEventId: string | null = null;
    const provider = createProvider({
      cancelEvent: async (_accessToken, input) => {
        cancelledEventId = input.eventId;
      }
    });
    const request = createCalendarExecutionRequest({
      actionKey: GoogleCalendarActionKey.CANCEL_EVENT,
      input: {
        calendarId: "primary",
        eventId: "provider-event-1",
        idempotencyKey: "calendar-cancel-key-1"
      }
    });

    await expect(
      executeGoogleCalendarAction(request, {
        bindings: googleCalendarTestBindings,
        credentials: new MemoryCredentialProvider(),
        provider
      })
    ).resolves.toMatchObject({
      status: AppExecutionStatus.SUCCEEDED,
      outcomeId: googleCalendarTestBindings.outcomeId(
        GoogleCalendarOutcomeKey.EVENT_CANCEL_SUCCESS
      ),
      output: { provider_id: "provider-event-1", status: "cancelled" }
    });
    expect(cancelledEventId).toBe("provider-event-1");
  });
});

class MemoryCredentialProvider implements GoogleCalendarCredentialProvider {
  readonly invalidated: Array<{
    connectionId: string;
    connectionRevision: number;
    installationId: string;
  }> = [];

  async getAccessToken(): Promise<string> {
    return "access-token";
  }

  async invalidateCredential(grant: AppInstallationGrant): Promise<void> {
    this.invalidated.push({
      connectionId: grant.connectionId,
      connectionRevision: grant.connectionRevision,
      installationId: grant.installationId
    });
  }
}

function createProvider(overrides: Partial<GoogleCalendarProvider> = {}): GoogleCalendarProvider {
  return {
    cancelEvent: async () => undefined,
    createEvent: async () => ({ id: "provider-event-1" }),
    getBusyBlocks: async () => [],
    listCalendars: async () => [],
    updateEvent: async () => ({ id: "provider-event-1" }),
    ...overrides
  };
}

function createEventInput() {
  return {
    attendeeEmails: ["alex@example.com"],
    calendarId: "primary",
    createGoogleMeet: true,
    description: "Requested through Vekil.",
    end: "2026-07-14T15:30:00+05:00",
    idempotencyKey: "calendar-idempotency-key-1",
    start: "2026-07-14T15:00:00+05:00",
    summary: "Meeting with Alex",
    schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
    timezone: "Asia/Samarkand"
  };
}
