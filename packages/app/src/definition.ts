import {
  AppApprovalMode,
  AppArtifactCardinality,
  AppCategoryId,
  AppClarificationMode,
  AppConnectionType,
  AppContactIdentityAttribute,
  AppFieldType,
  AppIntentMode,
  AppOrigin,
  AppOutcomeStatus,
  AppPermissionSensitivity,
  AppPolicyEffect,
  AppRequesterReviewMode,
  AppRiskLevel,
  AppRuntimeHost,
  AppSideEffectType,
  AppSettingsOptionsSourceType,
  appContactIdentityAttributeJsonSchemaKey,
  appDefinitionVersion,
  defineRemoteApp,
  type AppDefinition,
  type JsonObject
} from "@vekil/app-sdk";
import {
  GoogleCalendarActionKey,
  GoogleCalendarArtifactKey,
  GoogleCalendarCapabilityKey,
  GoogleCalendarIntentKey,
  GoogleCalendarOutcomeKey,
  GoogleCalendarPolicyKey,
  GoogleCalendarSettingKey,
  GoogleCalendarWeekday
} from "./contracts";

const en = (value: string) => ({ en: value });
const localized = (english: string, russian: string) => ({
  en: english,
  ru: russian
});
const allRequestOrigins = [
  AppOrigin.PUBLIC_GUEST,
  AppOrigin.PUBLIC_VERIFIED_EXTERNAL,
  AppOrigin.PUBLIC_AUTHENTICATED,
  AppOrigin.AGENT_TO_AGENT
];
const authenticatedOrigins = [
  AppOrigin.PUBLIC_VERIFIED_EXTERNAL,
  AppOrigin.PUBLIC_AUTHENTICATED,
  AppOrigin.AGENT_TO_AGENT
];
const schedulingSettingKeys = [
  GoogleCalendarSettingKey.WORKING_DAYS,
  GoogleCalendarSettingKey.WORKING_DAY_START,
  GoogleCalendarSettingKey.WORKING_DAY_END,
  GoogleCalendarSettingKey.BUFFER_BEFORE_MINUTES,
  GoogleCalendarSettingKey.BUFFER_AFTER_MINUTES,
  GoogleCalendarSettingKey.MINIMUM_NOTICE_HOURS
];
const schedulingConstraintsInputSchema = {
  type: "object",
  properties: {
    workingDays: {
      type: "array",
      items: { type: "string", enum: Object.values(GoogleCalendarWeekday) },
      minItems: 1,
      maxItems: 7
    },
    workingDayStart: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
    workingDayEnd: { type: "string", pattern: "^\\d{2}:\\d{2}$" },
    bufferBeforeMinutes: { type: "integer", minimum: 0, maximum: 240 },
    bufferAfterMinutes: { type: "integer", minimum: 0, maximum: 240 },
    minimumNoticeMinutes: { type: "integer", minimum: 0, maximum: 129_600 }
  },
  required: [
    "workingDays",
    "workingDayStart",
    "workingDayEnd",
    "bufferBeforeMinutes",
    "bufferAfterMinutes",
    "minimumNoticeMinutes"
  ]
};

const availabilityInputSchema = {
  type: "object",
  properties: {
    calendarIds: { type: "array", items: { type: "string" }, minItems: 1 },
    durationMinutes: { type: "integer", minimum: 5, maximum: 480 },
    schedulingConstraints: schedulingConstraintsInputSchema,
    timeMin: { type: "string", format: "date-time" },
    timeMax: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1 }
  },
  required: [
    "calendarIds",
    "durationMinutes",
    "schedulingConstraints",
    "timeMin",
    "timeMax",
    "timezone"
  ]
};

const availabilityOutputSchema = {
  type: "object",
  properties: {
    busy: { type: "array" },
    slots: { type: "array" }
  },
  required: ["busy", "slots"]
};

const eventOutputSchema = {
  type: "object",
  properties: {
    provider_id: { type: "string" },
    html_link: { type: ["string", "null"] }
  },
  required: ["provider_id", "html_link"]
};

const eventActionInputSchema = {
  type: "object",
  properties: {
    calendarId: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    description: { type: "string" },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1 },
    attendeeEmails: { type: "array", items: { type: "string", format: "email" } },
    createGoogleMeet: { type: "boolean" },
    schedulingConstraints: schedulingConstraintsInputSchema,
    idempotencyKey: { type: "string", minLength: 16 }
  },
  required: [
    "calendarId",
    "summary",
    "start",
    "end",
    "timezone",
    "attendeeEmails",
    "createGoogleMeet",
    "schedulingConstraints",
    "idempotencyKey"
  ]
};

const updateActionInputSchema = {
  type: "object",
  properties: {
    calendarId: { type: "string", minLength: 1 },
    eventId: { type: "string", minLength: 1 },
    summary: { type: "string" },
    description: { type: "string" },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    timezone: { type: "string", minLength: 1 },
    schedulingConstraints: schedulingConstraintsInputSchema,
    idempotencyKey: { type: "string", minLength: 16 }
  },
  required: [
    "calendarId",
    "eventId",
    "start",
    "end",
    "timezone",
    "schedulingConstraints",
    "idempotencyKey"
  ]
};

const cancelActionInputSchema = {
  type: "object",
  properties: {
    calendarId: { type: "string", minLength: 1 },
    eventId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 16 }
  },
  required: ["calendarId", "eventId", "idempotencyKey"]
};

export interface GoogleCalendarDefinitionOptions {
  baseUrl: string;
  jwksUrl?: string;
}

export function createGoogleCalendarDefinition({
  baseUrl,
  jwksUrl = new URL("/.well-known/jwks.json", baseUrl).toString()
}: GoogleCalendarDefinitionOptions): AppDefinition {
  return defineRemoteApp({
    definitionVersion: appDefinitionVersion,
    defaultLocale: "en",
    app: {
      name: localized("Google Calendar", "Google Календарь"),
      shortDescription: localized(
        "Coordinate meetings through your calendar.",
        "Согласовывайте встречи через свой календарь."
      ),
      longDescription: localized(
        "Google Calendar lets your Vekil check safe availability and complete approved meeting changes without exposing private event details.",
        "Google Календарь позволяет Vekil безопасно проверять свободное время и выполнять одобренные изменения встреч, не раскрывая детали личных событий."
      ),
      categoryId: AppCategoryId.PRODUCTIVITY,
      providerName: "Google"
    },
    publication: {
      supportEmail: "support@vekil.me",
      privacyPolicyUrl: "https://vekil.me/privacy",
      termsUrl: "https://vekil.me/terms"
    },
    connection: {
      type: AppConnectionType.OAUTH2,
      required: true,
      title: localized("Connect Google Calendar", "Подключить Google Календарь"),
      description: localized(
        "Choose the Google account your Vekil should coordinate with.",
        "Выберите Google-аккаунт, с календарём которого будет работать Vekil."
      ),
      permissions: [
        {
          key: "identity",
          label: en("Google account"),
          description: en("Verify the connected Google account."),
          sensitivity: AppPermissionSensitivity.STANDARD
        },
        {
          key: "calendar-list",
          label: en("Calendar list"),
          description: en("Read calendar names so you can select one."),
          sensitivity: AppPermissionSensitivity.STANDARD
        },
        {
          key: "availability-read",
          label: en("Availability"),
          description: en("Read free and busy time without exposing event titles."),
          sensitivity: AppPermissionSensitivity.SENSITIVE
        },
        {
          key: "event-write",
          label: en("Calendar events"),
          description: en("Create, reschedule, and cancel approved events."),
          sensitivity: AppPermissionSensitivity.SENSITIVE
        }
      ]
    },
    intents: [
      {
        key: GoogleCalendarIntentKey.AVAILABILITY_ASK,
        mode: AppIntentMode.EXECUTE,
        title: localized("Ask availability", "Узнать свободное время"),
        description: localized(
          "Ask when the owner may be free.",
          "Узнать, когда владелец может быть свободен."
        ),
        responseInstructions: localized(
          "Answer with safe available times without revealing private event details.",
          "Покажи безопасные свободные интервалы, не раскрывая детали личных событий."
        ),
        examples: {
          en: ["Is the owner free tomorrow afternoon?", "What times work next Friday?"],
          ru: ["Есть ли у владельца свободное время завтра?", "Какое время подойдёт в пятницу?"]
        },
        negativeExamples: {
          en: ["Create a GitHub issue.", "Share a Drive file."],
          ru: ["Создай задачу в GitHub.", "Поделись файлом из Google Drive."]
        },
        entityHints: {
          "time-min": "ISO 8601 range start",
          "time-max": "ISO 8601 range end",
          "duration-minutes": [15, 30, 45, 60]
        },
        inputSchema: {
          type: "object",
          properties: {
            "time-min": { type: "string", format: "date-time" },
            "time-max": { type: "string", format: "date-time" },
            "duration-minutes": { type: "integer", minimum: 5, maximum: 480 },
            timezone: { type: "string" }
          },
          required: ["time-min", "time-max"]
        },
        requiredFields: ["time-min", "time-max"],
        optionalFields: ["duration-minutes", "timezone"],
        knowledgeKeys: [],
        capabilityKeys: [GoogleCalendarCapabilityKey.AVAILABILITY_READ],
        actionKeys: [GoogleCalendarActionKey.GET_AVAILABILITY],
        riskLevel: AppRiskLevel.LOW,
        allowedOrigins: allRequestOrigins,
        clarificationMode: AppClarificationMode.ASK_MISSING_FIELDS,
        missingFieldsQuestion: localized(
          "What day or time range should I check?",
          "Какой день или диапазон времени проверить?"
        ),
        fieldQuestions: {
          "time-min": localized("When should I start checking?", "С какого времени искать?"),
          "time-max": localized("When should I stop checking?", "До какого времени искать?")
        },
        requesterReview: AppRequesterReviewMode.NOT_REQUIRED
      },
      {
        key: GoogleCalendarIntentKey.MEETING_CREATE,
        mode: AppIntentMode.EXECUTE,
        title: localized("Request meeting", "Запросить встречу"),
        description: localized(
          "Find a suitable time, then request a new meeting with the owner.",
          "Найти подходящее время и отправить владельцу запрос на встречу."
        ),
        responseInstructions: localized(
          "Learn the meeting purpose and preferred time window. Offer safe available times when no exact time was chosen. Ask for an invitation email only after a specific time is selected, then create only an approved event.",
          "Узнай цель встречи и предпочтительный диапазон времени. Если точное время не выбрано, предложи безопасные свободные варианты. Проси email для приглашения только после выбора конкретного времени и создавай событие только после одобрения."
        ),
        examples: {
          en: [
            "Schedule a 30 minute call tomorrow at 15:00.",
            "I would like to discuss the roadmap sometime next week."
          ],
          ru: [
            "Назначь 30-минутный созвон завтра в 15:00.",
            "Я хочу обсудить продуктовую стратегию на следующей неделе."
          ]
        },
        negativeExamples: {
          en: ["Cancel the existing meeting.", "Book a restaurant."],
          ru: ["Отмени существующую встречу.", "Забронируй ресторан."]
        },
        entityHints: {
          start: "ISO 8601 meeting start",
          end: "ISO 8601 meeting end",
          "time-min": "ISO 8601 preferred window start",
          "time-max": "ISO 8601 preferred window end",
          purpose: "Why the requester wants to meet",
          "requester-email":
            "The requester's own email address that should receive the invitation",
          "attendee-emails":
            "Optional additional guest email addresses; never the owner's email address"
        },
        inputSchema: {
          type: "object",
          properties: {
            start: { type: "string", format: "date-time", title: "Requested time" },
            end: { type: "string", format: "date-time", title: "End time" },
            "time-min": {
              type: "string",
              format: "date-time",
              title: "Preferred window starts"
            },
            "time-max": {
              type: "string",
              format: "date-time",
              title: "Preferred window ends"
            },
            "duration-minutes": {
              type: "integer",
              minimum: 5,
              maximum: 480,
              title: "Duration"
            },
            purpose: {
              type: "string",
              minLength: 3,
              maxLength: 1_000,
              title: "Meeting purpose"
            },
            "requester-email": {
              type: "string",
              format: "email",
              title: "Your invitation email",
              description:
                "The requester's own email address that should receive the meeting invitation.",
              [appContactIdentityAttributeJsonSchemaKey]: AppContactIdentityAttribute.EMAIL
            },
            "attendee-emails": {
              type: "array",
              items: { type: "string", format: "email" },
              description:
                "Optional additional guests to invite. This is never the owner's email address."
            },
            title: { type: "string" },
            timezone: { type: "string" }
          },
          required: ["purpose"]
        },
        requiredFields: ["purpose"],
        optionalFields: [
          "start",
          "end",
          "time-min",
          "time-max",
          "duration-minutes",
          "requester-email",
          "attendee-emails",
          "title",
          "timezone"
        ],
        knowledgeKeys: [],
        capabilityKeys: [
          GoogleCalendarCapabilityKey.AVAILABILITY_READ,
          GoogleCalendarCapabilityKey.EVENT_CREATE
        ],
        actionKeys: [
          GoogleCalendarActionKey.GET_AVAILABILITY,
          GoogleCalendarActionKey.CREATE_EVENT
        ],
        riskLevel: AppRiskLevel.MEDIUM,
        allowedOrigins: allRequestOrigins,
        clarificationMode: AppClarificationMode.ASK_MISSING_FIELDS,
        missingFieldsQuestion: localized(
          "What would you like to discuss, and what day or time range could work?",
          "Что вы хотите обсудить и какой день или диапазон времени вам подходит?"
        ),
        fieldQuestions: {
          purpose: localized(
            "What would you like to discuss in the meeting?",
            "Что вы хотите обсудить на встрече?"
          ),
          "time-min": localized(
            "What day or time range could work?",
            "Какой день или диапазон времени вам подходит?"
          ),
          "time-max": localized(
            "How late should I look for a suitable time?",
            "До какого времени искать подходящий вариант?"
          ),
          start: localized(
            "Which available time works for you?",
            "Какой из свободных вариантов вам подходит?"
          ),
          "requester-email": localized(
            "What is your email? The meeting invitation will be sent there.",
            "Укажите ваш email — на него будет отправлено приглашение на встречу."
          )
        },
        requesterReview: AppRequesterReviewMode.NOT_REQUIRED
      },
      {
        key: GoogleCalendarIntentKey.MEETING_RESCHEDULE,
        mode: AppIntentMode.EXECUTE,
        title: en("Reschedule meeting"),
        description: en("Move an existing meeting to another time."),
        responseInstructions: en(
          "Confirm the exact meeting and replacement time before proposing the change."
        ),
        examples: { en: ["Move our meeting to Friday at 16:00."] },
        negativeExamples: { en: ["Create a new meeting.", "Cancel the meeting."] },
        entityHints: { "event-id": "Google Calendar event ID", start: "New ISO 8601 start" },
        inputSchema: {
          type: "object",
          properties: {
            "calendar-id": { type: "string" },
            "event-id": { type: "string" },
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
            "duration-minutes": { type: "integer", minimum: 5, maximum: 480 },
            timezone: { type: "string" }
          },
          required: ["event-id", "start"]
        },
        requiredFields: ["event-id", "start"],
        optionalFields: ["calendar-id", "end", "duration-minutes", "timezone"],
        knowledgeKeys: [],
        capabilityKeys: [GoogleCalendarCapabilityKey.EVENT_UPDATE],
        actionKeys: [GoogleCalendarActionKey.UPDATE_EVENT],
        riskLevel: AppRiskLevel.MEDIUM,
        allowedOrigins: authenticatedOrigins,
        clarificationMode: AppClarificationMode.ASK_MISSING_FIELDS,
        missingFieldsQuestion: en("Which meeting should move, and what new time should I use?"),
        fieldQuestions: {
          "event-id": en("Which meeting should I move?"),
          start: en("What new time should I use?")
        },
        requesterReview: AppRequesterReviewMode.REQUIRED
      },
      {
        key: GoogleCalendarIntentKey.MEETING_CANCEL,
        mode: AppIntentMode.EXECUTE,
        title: en("Cancel meeting"),
        description: en("Cancel an existing meeting."),
        responseInstructions: en("Confirm the exact meeting before proposing a cancellation."),
        examples: { en: ["Cancel our Friday meeting."] },
        negativeExamples: { en: ["Move the meeting.", "When is the owner free?"] },
        entityHints: { "event-id": "Google Calendar event ID" },
        inputSchema: {
          type: "object",
          properties: {
            "calendar-id": { type: "string" },
            "event-id": { type: "string" }
          },
          required: ["event-id"]
        },
        requiredFields: ["event-id"],
        optionalFields: ["calendar-id"],
        knowledgeKeys: [],
        capabilityKeys: [GoogleCalendarCapabilityKey.EVENT_CANCEL],
        actionKeys: [GoogleCalendarActionKey.CANCEL_EVENT],
        riskLevel: AppRiskLevel.MEDIUM,
        allowedOrigins: authenticatedOrigins,
        clarificationMode: AppClarificationMode.ASK_MISSING_FIELDS,
        missingFieldsQuestion: en("Which meeting should I cancel?"),
        fieldQuestions: { "event-id": en("Which meeting should I cancel?") },
        requesterReview: AppRequesterReviewMode.REQUIRED
      }
    ],
    capabilities: [
      capability(
        GoogleCalendarCapabilityKey.CALENDAR_LIST,
        "List calendars",
        "List calendars available to the connected account.",
        GoogleCalendarActionKey.LIST_CALENDARS,
        AppRiskLevel.LOW,
        AppApprovalMode.NOT_REQUIRED
      ),
      capability(
        GoogleCalendarCapabilityKey.AVAILABILITY_READ,
        "Check availability",
        "Read free and busy time without event titles.",
        GoogleCalendarActionKey.GET_AVAILABILITY,
        AppRiskLevel.LOW,
        AppApprovalMode.NOT_REQUIRED,
        availabilityInputSchema,
        availabilityOutputSchema
      ),
      capability(
        GoogleCalendarCapabilityKey.EVENT_CREATE,
        "Create meeting",
        "Create an approved calendar event.",
        GoogleCalendarActionKey.CREATE_EVENT,
        AppRiskLevel.MEDIUM,
        AppApprovalMode.POLICY,
        eventActionInputSchema,
        eventOutputSchema
      ),
      capability(
        GoogleCalendarCapabilityKey.EVENT_UPDATE,
        "Reschedule event",
        "Update an approved calendar event.",
        GoogleCalendarActionKey.UPDATE_EVENT,
        AppRiskLevel.MEDIUM,
        AppApprovalMode.ALWAYS,
        updateActionInputSchema,
        eventOutputSchema
      ),
      capability(
        GoogleCalendarCapabilityKey.EVENT_CANCEL,
        "Cancel event",
        "Cancel an approved calendar event.",
        GoogleCalendarActionKey.CANCEL_EVENT,
        AppRiskLevel.MEDIUM,
        AppApprovalMode.ALWAYS,
        cancelActionInputSchema,
        {
          type: "object",
          properties: { provider_id: { type: "string" }, status: { type: "string" } },
          required: ["provider_id", "status"]
        }
      )
    ],
    actions: [
      action({
        key: GoogleCalendarActionKey.LIST_CALENDARS,
        capabilityKey: GoogleCalendarCapabilityKey.CALENDAR_LIST,
        label: "List calendars",
        description: "List calendars for App configuration.",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          properties: { calendars: { type: "array" } },
          required: ["calendars"]
        },
        outcomeKeys: [GoogleCalendarOutcomeKey.CALENDAR_LIST_SUCCESS]
      }),
      action({
        key: GoogleCalendarActionKey.GET_AVAILABILITY,
        capabilityKey: GoogleCalendarCapabilityKey.AVAILABILITY_READ,
        label: "Check availability",
        description: "Read free and busy time and calculate safe meeting slots.",
        inputSchema: availabilityInputSchema,
        outputSchema: availabilityOutputSchema,
        requiresSettings: [GoogleCalendarSettingKey.SELECTED_CALENDAR_ID, ...schedulingSettingKeys],
        requiresPolicies: [GoogleCalendarPolicyKey.HIDE_EVENT_TITLES],
        outputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.AVAILABILITY,
            schemaVersion: 1,
            required: true,
            cardinality: AppArtifactCardinality.ONE
          },
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.MANY
          }
        ],
        outcomeKeys: [
          GoogleCalendarOutcomeKey.AVAILABILITY_SUCCESS,
          GoogleCalendarOutcomeKey.MEETING_OPTIONS_SUCCESS
        ]
      }),
      action({
        key: GoogleCalendarActionKey.CREATE_EVENT,
        capabilityKey: GoogleCalendarCapabilityKey.EVENT_CREATE,
        label: "Create event",
        description: "Verify availability and create an approved event.",
        inputSchema: eventActionInputSchema,
        outputSchema: {
          type: "object",
          properties: {
            provider_id: { type: "string" },
            html_link: { type: ["string", "null"] },
            slots: { type: "array" }
          }
        },
        riskLevel: AppRiskLevel.MEDIUM,
        sideEffect: AppSideEffectType.WRITE_EXTERNAL_STATE,
        approval: AppApprovalMode.POLICY,
        requiresSettings: [
          GoogleCalendarSettingKey.SELECTED_CALENDAR_ID,
          GoogleCalendarSettingKey.DEFAULT_DURATION_MINUTES,
          ...schedulingSettingKeys
        ],
        requiresPolicies: [
          GoogleCalendarPolicyKey.UNKNOWN_REQUESTER_APPROVAL,
          GoogleCalendarPolicyKey.HIDE_EVENT_TITLES
        ],
        inputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.ONE
          }
        ],
        outputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.EVENT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.ONE
          },
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.MANY
          }
        ],
        outcomeKeys: [
          GoogleCalendarOutcomeKey.EVENT_CREATE_SUCCESS,
          GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE
        ]
      }),
      action({
        key: GoogleCalendarActionKey.UPDATE_EVENT,
        capabilityKey: GoogleCalendarCapabilityKey.EVENT_UPDATE,
        label: "Update event",
        description: "Move an approved calendar event.",
        inputSchema: updateActionInputSchema,
        outputSchema: {
          type: "object",
          properties: {
            provider_id: { type: "string" },
            html_link: { type: ["string", "null"] },
            slots: { type: "array" }
          }
        },
        riskLevel: AppRiskLevel.MEDIUM,
        sideEffect: AppSideEffectType.WRITE_EXTERNAL_STATE,
        approval: AppApprovalMode.ALWAYS,
        requiresSettings: [
          GoogleCalendarSettingKey.SELECTED_CALENDAR_ID,
          GoogleCalendarSettingKey.DEFAULT_DURATION_MINUTES,
          ...schedulingSettingKeys
        ],
        requiresPolicies: [
          GoogleCalendarPolicyKey.UNKNOWN_REQUESTER_APPROVAL,
          GoogleCalendarPolicyKey.HIDE_EVENT_TITLES
        ],
        inputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.EVENT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.ONE
          },
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.ONE
          }
        ],
        outputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.EVENT,
            schemaVersion: 1,
            required: true,
            cardinality: AppArtifactCardinality.ONE
          },
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.MANY
          }
        ],
        outcomeKeys: [
          GoogleCalendarOutcomeKey.EVENT_UPDATE_SUCCESS,
          GoogleCalendarOutcomeKey.RESCHEDULE_SLOT_UNAVAILABLE
        ]
      }),
      action({
        key: GoogleCalendarActionKey.CANCEL_EVENT,
        capabilityKey: GoogleCalendarCapabilityKey.EVENT_CANCEL,
        label: "Cancel event",
        description: "Cancel an approved calendar event.",
        inputSchema: cancelActionInputSchema,
        outputSchema: {
          type: "object",
          properties: { provider_id: { type: "string" }, status: { type: "string" } },
          required: ["provider_id", "status"]
        },
        riskLevel: AppRiskLevel.MEDIUM,
        sideEffect: AppSideEffectType.WRITE_EXTERNAL_STATE,
        approval: AppApprovalMode.ALWAYS,
        requiresSettings: [GoogleCalendarSettingKey.SELECTED_CALENDAR_ID],
        requiresPolicies: [
          GoogleCalendarPolicyKey.UNKNOWN_REQUESTER_APPROVAL,
          GoogleCalendarPolicyKey.HIDE_EVENT_TITLES
        ],
        inputArtifacts: [
          {
            artifactKey: GoogleCalendarArtifactKey.EVENT,
            schemaVersion: 1,
            required: false,
            cardinality: AppArtifactCardinality.ONE
          }
        ],
        outcomeKeys: [GoogleCalendarOutcomeKey.EVENT_CANCEL_SUCCESS]
      })
    ],
    triggers: [],
    resources: ["event", "calendar"],
    artifactContracts: [
      {
        key: GoogleCalendarArtifactKey.AVAILABILITY,
        schemaVersion: 1,
        schema: availabilityOutputSchema,
        description: en("Safe free and busy output without event titles.")
      },
      {
        key: GoogleCalendarArtifactKey.MEETING_SLOT,
        schemaVersion: 1,
        schema: {
          type: "object",
          properties: {
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
            timezone: { type: "string" },
            "duration-minutes": { type: "integer", minimum: 5, maximum: 480 }
          },
          required: ["start", "end", "timezone", "duration-minutes"]
        },
        description: en("A safe meeting slot selected from availability."),
        sensitivityLevel: "LOW"
      },
      {
        key: GoogleCalendarArtifactKey.EVENT,
        schemaVersion: 1,
        schema: {
          type: "object",
          properties: {
            "calendar-id": { type: "string" },
            "provider-id": { type: "string" },
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
            timezone: { type: "string" },
            "html-link": { type: ["string", "null"] },
            status: { type: "string" }
          },
          required: ["calendar-id", "provider-id", "status"]
        },
        description: en("A Google Calendar event reference for follow-up actions.")
      }
    ],
    context: {
      defaultScopes: [
        "target-vekil.profile.public",
        "request.current",
        "request.entities",
        "request.intent",
        "request.locale",
        "app-installation.settings",
        "app-installation.policies",
        "policy.result",
        "approval.result",
        "execution.metadata",
        "locale.current",
        "timezone.current"
      ],
      optionalScopes: ["viewer.identity.basic", "viewer.identity.contact"],
      prohibitedScopes: [
        "conversation.full-thread",
        "owner.private-profile",
        "other-app.settings",
        "other-app.credentials"
      ],
      copy: {
        receives: [
          {
            scope: "request.entities",
            label: en("Meeting details"),
            description: en("Structured time, duration, and attendee details for this request.")
          },
          {
            scope: "app-installation.settings",
            label: en("Calendar settings"),
            description: en("Only settings required by the selected calendar action.")
          },
          {
            scope: "approval.result",
            label: en("Approval status"),
            description: en("Whether the owner approved this exact calendar change.")
          }
        ],
        doesNotReceive: [
          {
            scope: "other-app.credentials",
            label: en("Other App credentials"),
            description: en("Credentials from other Apps are never shared.")
          },
          {
            scope: "conversation.full-thread",
            label: en("Full conversation"),
            description: en("Unrelated conversation history stays outside this App.")
          }
        ]
      }
    },
    settings: {
      fields: [
        {
          key: GoogleCalendarSettingKey.SELECTED_CALENDAR_ID,
          type: AppFieldType.SELECT,
          label: en("Calendar"),
          description: en("Calendar used for availability and approved events."),
          help: en("Loaded from the connected Google account."),
          required: true,
          default: "primary",
          optionsSource: {
            type: AppSettingsOptionsSourceType.APP_ACTION,
            actionKey: GoogleCalendarActionKey.LIST_CALENDARS,
            cacheTtlSeconds: 300,
            outputPath: ["calendars"],
            valueField: "id",
            labelField: "label"
          }
        },
        {
          key: GoogleCalendarSettingKey.DEFAULT_DURATION_MINUTES,
          type: AppFieldType.INTEGER,
          label: en("Default meeting duration"),
          description: en("Used when a requester does not specify a duration."),
          required: true,
          default: 30,
          validation: { minimum: 15, maximum: 180, multipleOf: 15 }
        },
        {
          key: GoogleCalendarSettingKey.WORKING_DAYS,
          type: AppFieldType.MULTI_SELECT,
          label: en("Available days"),
          description: en("Days when Vekil may suggest meeting times."),
          required: true,
          default: [
            GoogleCalendarWeekday.MONDAY,
            GoogleCalendarWeekday.TUESDAY,
            GoogleCalendarWeekday.WEDNESDAY,
            GoogleCalendarWeekday.THURSDAY,
            GoogleCalendarWeekday.FRIDAY
          ],
          options: [
            { value: GoogleCalendarWeekday.MONDAY, label: en("Monday") },
            { value: GoogleCalendarWeekday.TUESDAY, label: en("Tuesday") },
            { value: GoogleCalendarWeekday.WEDNESDAY, label: en("Wednesday") },
            { value: GoogleCalendarWeekday.THURSDAY, label: en("Thursday") },
            { value: GoogleCalendarWeekday.FRIDAY, label: en("Friday") },
            { value: GoogleCalendarWeekday.SATURDAY, label: en("Saturday") },
            { value: GoogleCalendarWeekday.SUNDAY, label: en("Sunday") }
          ]
        },
        {
          key: GoogleCalendarSettingKey.WORKING_DAY_START,
          type: AppFieldType.TIME,
          label: en("Day starts"),
          description: en("Earliest time Vekil may suggest."),
          required: true,
          default: "09:00"
        },
        {
          key: GoogleCalendarSettingKey.WORKING_DAY_END,
          type: AppFieldType.TIME,
          label: en("Day ends"),
          description: en("Latest time a suggested meeting may end."),
          required: true,
          default: "18:00"
        },
        {
          key: GoogleCalendarSettingKey.BUFFER_BEFORE_MINUTES,
          type: AppFieldType.INTEGER,
          label: en("Time before meetings"),
          description: en("Keep this many minutes free before each suggested meeting."),
          required: true,
          default: 0,
          validation: { minimum: 0, maximum: 240, multipleOf: 5 }
        },
        {
          key: GoogleCalendarSettingKey.BUFFER_AFTER_MINUTES,
          type: AppFieldType.INTEGER,
          label: en("Time after meetings"),
          description: en("Keep this many minutes free after each suggested meeting."),
          required: true,
          default: 0,
          validation: { minimum: 0, maximum: 240, multipleOf: 5 }
        },
        {
          key: GoogleCalendarSettingKey.MINIMUM_NOTICE_HOURS,
          type: AppFieldType.INTEGER,
          label: en("Minimum notice"),
          description: en("How many hours ahead a meeting should be requested."),
          required: true,
          default: 2,
          validation: { minimum: 0, maximum: 2_160, multipleOf: 1 }
        }
      ]
    },
    policies: {
      rules: [
        {
          key: GoogleCalendarPolicyKey.UNKNOWN_REQUESTER_APPROVAL,
          label: en("Unknown requesters"),
          description: en("Choose how meeting requests from unknown people are handled."),
          conditionFields: [],
          behaviors: approvalBehaviors(),
          defaultBehavior: "require-approval"
        },
        {
          key: GoogleCalendarPolicyKey.HIDE_EVENT_TITLES,
          label: en("Event privacy"),
          description: en("Keep private event titles out of requester-facing output."),
          conditionFields: [],
          behaviors: [
            { effect: AppPolicyEffect.ALLOW, value: "hide", label: en("Hide titles") },
            { effect: AppPolicyEffect.ALLOW, value: "show", label: en("Show titles") }
          ],
          defaultBehavior: "hide"
        }
      ]
    },
    customRules: {
      families: [
        "time-constraints",
        "duration-constraints",
        "day-constraints",
        "approval-rules",
        "privacy-rules",
        "ranking-preferences"
      ],
      examples: {
        en: ["Do not schedule meetings after 17:00.", "Prefer Tuesday and Thursday afternoons."]
      },
      unsupportedExamples: { en: ["Review pull requests before meetings."] }
    },
    publicActions: [
      {
        key: "request-meeting",
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE,
        label: localized("Request meeting", "Запросить встречу"),
        description: localized(
          "Suggest a meeting time and wait for approval.",
          "Выбрать время встречи и дождаться одобрения."
        ),
        capabilityKeys: [
          GoogleCalendarCapabilityKey.AVAILABILITY_READ,
          GoogleCalendarCapabilityKey.EVENT_CREATE
        ],
        allowedOrigins: [AppOrigin.PUBLIC_GUEST, AppOrigin.PUBLIC_AUTHENTICATED],
        riskLevel: AppRiskLevel.MEDIUM
      },
      {
        key: "ask-availability",
        intentKey: GoogleCalendarIntentKey.AVAILABILITY_ASK,
        label: localized("Ask availability", "Узнать свободное время"),
        description: localized(
          "Ask what time could work.",
          "Узнать, какое время может подойти."
        ),
        capabilityKeys: [GoogleCalendarCapabilityKey.AVAILABILITY_READ],
        allowedOrigins: [AppOrigin.PUBLIC_GUEST, AppOrigin.PUBLIC_AUTHENTICATED],
        riskLevel: AppRiskLevel.LOW
      },
      {
        key: "reschedule-meeting",
        intentKey: GoogleCalendarIntentKey.MEETING_RESCHEDULE,
        label: en("Choose another time"),
        description: en("Choose a different time for the meeting."),
        capabilityKeys: [
          GoogleCalendarCapabilityKey.AVAILABILITY_READ,
          GoogleCalendarCapabilityKey.EVENT_UPDATE
        ],
        allowedOrigins: authenticatedOrigins,
        riskLevel: AppRiskLevel.MEDIUM
      }
    ],
    outcomes: [
      outcome(
        GoogleCalendarOutcomeKey.CALENDAR_LIST_SUCCESS,
        GoogleCalendarActionKey.LIST_CALENDARS,
        "Calendars loaded",
        "The connected account calendars were loaded.",
        { type: "object", properties: { calendars: { type: "array" } }, required: ["calendars"] }
      ),
      outcome(
        GoogleCalendarOutcomeKey.AVAILABILITY_SUCCESS,
        GoogleCalendarActionKey.GET_AVAILABILITY,
        "Availability checked",
        "Availability was checked without exposing event details.",
        availabilityOutputSchema
      ),
      outcome(
        GoogleCalendarOutcomeKey.MEETING_OPTIONS_SUCCESS,
        GoogleCalendarActionKey.GET_AVAILABILITY,
        "Meeting times found",
        "Safe meeting options are ready for the requester to choose.",
        availabilityOutputSchema,
        AppOutcomeStatus.SUCCESS,
        [
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            key: "request-meeting",
            label: en("Choose a time")
          }
        ]
      ),
      outcome(
        GoogleCalendarOutcomeKey.EVENT_CREATE_SUCCESS,
        GoogleCalendarActionKey.CREATE_EVENT,
        "Meeting created",
        "The approved calendar event was created.",
        eventOutputSchema
      ),
      outcome(
        GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE,
        GoogleCalendarActionKey.CREATE_EVENT,
        "Time is unavailable",
        "The requested time cannot be booked under the current scheduling rules and safe alternatives are available.",
        { type: "object", properties: { slots: { type: "array" } }, required: ["slots"] },
        AppOutcomeStatus.SUCCESS,
        [
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            key: "request-meeting",
            label: en("Choose another time")
          }
        ]
      ),
      outcome(
        GoogleCalendarOutcomeKey.EVENT_UPDATE_SUCCESS,
        GoogleCalendarActionKey.UPDATE_EVENT,
        "Meeting rescheduled",
        "The approved calendar event was updated.",
        eventOutputSchema
      ),
      outcome(
        GoogleCalendarOutcomeKey.RESCHEDULE_SLOT_UNAVAILABLE,
        GoogleCalendarActionKey.UPDATE_EVENT,
        "New time is unavailable",
        "The requested replacement time cannot be booked and safe alternatives are available.",
        { type: "object", properties: { slots: { type: "array" } }, required: ["slots"] },
        AppOutcomeStatus.SUCCESS,
        [
          {
            artifactKey: GoogleCalendarArtifactKey.MEETING_SLOT,
            key: "reschedule-meeting",
            label: en("Choose another time")
          }
        ]
      ),
      outcome(
        GoogleCalendarOutcomeKey.EVENT_CANCEL_SUCCESS,
        GoogleCalendarActionKey.CANCEL_EVENT,
        "Meeting cancelled",
        "The approved calendar event was cancelled.",
        {
          type: "object",
          properties: { provider_id: { type: "string" }, status: { type: "string" } },
          required: ["provider_id", "status"]
        }
      )
    ],
    runtime: {
      host: AppRuntimeHost.REMOTE,
      baseUrl,
      jwksUrl,
      connectionRequired: true
    }
  });
}

function capability(
  key: GoogleCalendarCapabilityKey,
  label: string,
  description: string,
  actionKey: GoogleCalendarActionKey,
  riskLevel: AppRiskLevel,
  approval: AppApprovalMode,
  inputSchema: JsonObject = { type: "object" },
  outputSchema: JsonObject = { type: "object" }
) {
  return {
    key,
    label: en(label),
    description: en(description),
    inputSchema,
    outputSchema,
    riskLevel,
    approval,
    actionKeys: [actionKey]
  };
}

function action({
  approval = AppApprovalMode.NOT_REQUIRED,
  capabilityKey,
  description,
  inputSchema,
  inputArtifacts = [],
  key,
  label,
  outcomeKeys,
  outputArtifacts = [],
  outputSchema,
  requiresPolicies = [],
  requiresSettings = [],
  riskLevel = AppRiskLevel.LOW,
  sideEffect = AppSideEffectType.READ_ONLY
}: {
  approval?: AppApprovalMode;
  capabilityKey: GoogleCalendarCapabilityKey;
  description: string;
  inputSchema: JsonObject;
  inputArtifacts?: Array<{
    artifactKey: GoogleCalendarArtifactKey;
    cardinality: AppArtifactCardinality;
    required: boolean;
    schemaVersion: number;
  }>;
  key: GoogleCalendarActionKey;
  label: string;
  outcomeKeys: GoogleCalendarOutcomeKey[];
  outputArtifacts?: Array<{
    artifactKey: GoogleCalendarArtifactKey;
    cardinality: AppArtifactCardinality;
    required: boolean;
    schemaVersion: number;
  }>;
  outputSchema: JsonObject;
  requiresPolicies?: GoogleCalendarPolicyKey[];
  requiresSettings?: GoogleCalendarSettingKey[];
  riskLevel?: AppRiskLevel;
  sideEffect?: AppSideEffectType;
}) {
  const write = sideEffect === AppSideEffectType.WRITE_EXTERNAL_STATE;

  return {
    key,
    capabilityKey,
    label: en(label),
    description: en(description),
    composable: key !== GoogleCalendarActionKey.CANCEL_EVENT,
    context: {
      requiredScopes: [
        "request.current" as const,
        "request.entities" as const,
        "request.intent" as const,
        "request.locale" as const,
        "app-installation.settings" as const,
        "app-installation.policies" as const,
        "policy.result" as const,
        ...(write ? (["approval.result"] as const) : []),
        "execution.metadata" as const,
        "locale.current" as const,
        "timezone.current" as const
      ],
      requiresSettings,
      requiresPolicies
    },
    dataAccessLevel: write ? "calendar-write" : "availability-only",
    inputSchema,
    outputSchema,
    inputArtifacts,
    outputArtifacts,
    riskLevel,
    sideEffect,
    approval,
    timeoutMs: write ? 20_000 : 15_000,
    idempotency: {
      required: write,
      keyFields: write ? ["idempotencyKey"] : []
    },
    retry: {
      maxAttempts: 2,
      retryableStatusCodes: [429, 500, 502, 503, 504]
    },
    outcomeKeys
  };
}

function outcome(
  key: GoogleCalendarOutcomeKey,
  actionKey: GoogleCalendarActionKey,
  title: string,
  description: string,
  schema: JsonObject,
  status = AppOutcomeStatus.SUCCESS,
  nextActions: Array<{
    artifactKey?: GoogleCalendarArtifactKey;
    key: string;
    label: Record<string, string>;
  }> = []
) {
  return {
    key,
    actionKey,
    status,
    title: en(title),
    description: en(description),
    schema,
    nextActions
  };
}

function approvalBehaviors() {
  return [
    {
      effect: AppPolicyEffect.REQUIRE_APPROVAL,
      value: "require-approval",
      label: en("Require approval")
    },
    { effect: AppPolicyEffect.ALLOW, value: "auto-approve", label: en("Auto-approve") },
    { effect: AppPolicyEffect.DENY, value: "auto-decline", label: en("Auto-decline") }
  ];
}
