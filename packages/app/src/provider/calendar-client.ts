import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  GoogleCalendarAvailabilityInput,
  GoogleCalendarBusyBlock,
  GoogleCalendarCancelEventInput,
  GoogleCalendarCreateEventInput,
  GoogleCalendarUpdateEventInput
} from "../contracts";
import { normalizeAvailabilityWindow } from "../runtime/availability";

const calendarListResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            primary: z.boolean().optional(),
            summary: z.string().optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

const freeBusyResponseSchema = z
  .object({
    calendars: z.record(
      z.string(),
      z
        .object({
          busy: z
            .array(
              z.object({
                end: z.string(),
                start: z.string()
              })
            )
            .optional()
        })
        .passthrough()
    )
  })
  .passthrough();

const eventResponseSchema = z
  .object({
    conferenceData: z.unknown().optional(),
    etag: z.string().optional(),
    extendedProperties: z
      .object({
        private: z.record(z.string(), z.string()).optional()
      })
      .optional(),
    htmlLink: z.string().url().optional(),
    id: z.string(),
    status: z.string().optional()
  })
  .passthrough();

const providerErrorResponseSchema = z
  .object({
    error: z
      .object({
        errors: z
          .array(
            z
              .object({
                reason: z.string()
              })
              .passthrough()
          )
          .optional()
      })
      .passthrough()
  })
  .passthrough();

const defaultProviderRequestTimeoutMs = 15_000;

export interface GoogleCalendarInfo {
  id: string;
  label: string;
  primary: boolean;
}

export interface GoogleCalendarProviderEvent {
  conferenceData?: unknown;
  etag?: string;
  htmlLink?: string;
  id: string;
  status?: string;
}

export interface GoogleCalendarProvider {
  cancelEvent(accessToken: string, input: GoogleCalendarCancelEventInput): Promise<void>;
  createEvent(
    accessToken: string,
    input: GoogleCalendarCreateEventInput
  ): Promise<GoogleCalendarProviderEvent>;
  getBusyBlocks(
    accessToken: string,
    input: GoogleCalendarAvailabilityInput
  ): Promise<GoogleCalendarBusyBlock[]>;
  listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]>;
  updateEvent(
    accessToken: string,
    input: GoogleCalendarUpdateEventInput
  ): Promise<GoogleCalendarProviderEvent>;
}

export enum GoogleCalendarProviderErrorCode {
  AUTHORIZATION_REJECTED = "AUTHORIZATION_REJECTED",
  EVENT_ID_COLLISION = "EVENT_ID_COLLISION",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  INVALID_WINDOW = "INVALID_WINDOW",
  PROVIDER_REJECTED = "PROVIDER_REJECTED",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
  RATE_LIMITED = "RATE_LIMITED"
}

export class GoogleCalendarProviderError extends Error {
  readonly code: GoogleCalendarProviderErrorCode;
  readonly reconnectRequired: boolean;
  readonly retryable: boolean;
  readonly status?: number;

  constructor({
    code,
    message,
    reconnectRequired = false,
    retryable = false,
    status
  }: {
    code: GoogleCalendarProviderErrorCode;
    message: string;
    reconnectRequired?: boolean;
    retryable?: boolean;
    status?: number;
  }) {
    super(message);
    this.name = "GoogleCalendarProviderError";
    this.code = code;
    this.reconnectRequired = reconnectRequired;
    this.retryable = retryable;
    this.status = status;
  }
}

export class GoogleCalendarHttpProvider implements GoogleCalendarProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(fetchImpl: typeof fetch = fetch, requestTimeoutMs = defaultProviderRequestTimeoutMs) {
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
    const response = await this.request(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      accessToken
    );
    const parsed = await readAndParseProviderJson(response, calendarListResponseSchema);

    return (
      parsed.items?.map((calendar) => ({
        id: calendar.id,
        label: calendar.summary ?? calendar.id,
        primary: calendar.primary ?? false
      })) ?? []
    );
  }

  async getBusyBlocks(
    accessToken: string,
    input: GoogleCalendarAvailabilityInput
  ): Promise<GoogleCalendarBusyBlock[]> {
    const window = normalizeAvailabilityWindow(input);

    if (!window) {
      throw new GoogleCalendarProviderError({
        code: GoogleCalendarProviderErrorCode.INVALID_WINDOW,
        message: "The Google Calendar availability window is invalid."
      });
    }

    const response = await this.request(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      accessToken,
      {
        body: JSON.stringify({
          items: input.calendarIds.map((id) => ({ id })),
          timeMax: window.providerTimeMax,
          timeMin: window.providerTimeMin,
          timeZone: input.timezone
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
    const parsed = await readAndParseProviderJson(response, freeBusyResponseSchema);
    return Object.values(parsed.calendars).flatMap((calendar) => calendar.busy ?? []);
  }

  async createEvent(
    accessToken: string,
    input: GoogleCalendarCreateEventInput
  ): Promise<GoogleCalendarProviderEvent> {
    const idempotencyHash = hashIdempotencyKey(input.idempotencyKey);
    const providerEventId = `vkl${idempotencyHash}`;
    const url = calendarEventCollectionUrl(input.calendarId);
    url.searchParams.set("sendUpdates", "all");

    if (input.createGoogleMeet) {
      url.searchParams.set("conferenceDataVersion", "1");
    }

    const response = await this.request(
      url,
      accessToken,
      {
        body: JSON.stringify({
          attendees: input.attendeeEmails.map((email) => ({ email })),
          conferenceData: input.createGoogleMeet
            ? {
                createRequest: {
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                  requestId: providerEventId
                }
              }
            : undefined,
          description: input.description,
          end: { dateTime: input.end, timeZone: input.timezone },
          extendedProperties: {
            private: { vekilIdempotencyHash: idempotencyHash }
          },
          id: providerEventId,
          start: { dateTime: input.start, timeZone: input.timezone },
          summary: input.summary
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      },
      [409]
    );

    if (response.status !== 409) {
      return toProviderEvent(await readAndParseProviderJson(response, eventResponseSchema));
    }

    const existingResponse = await this.request(
      calendarEventUrl(input.calendarId, providerEventId),
      accessToken
    );
    const existing = await readAndParseProviderJson(existingResponse, eventResponseSchema);

    if (existing.extendedProperties?.private?.vekilIdempotencyHash !== idempotencyHash) {
      throw new GoogleCalendarProviderError({
        code: GoogleCalendarProviderErrorCode.EVENT_ID_COLLISION,
        message: "The deterministic Google Calendar event ID collided with another event."
      });
    }

    return toProviderEvent(existing);
  }

  async updateEvent(
    accessToken: string,
    input: GoogleCalendarUpdateEventInput
  ): Promise<GoogleCalendarProviderEvent> {
    const url = calendarEventUrl(input.calendarId, input.eventId);
    url.searchParams.set("sendUpdates", "all");
    const response = await this.request(url, accessToken, {
      body: JSON.stringify({
        description: input.description,
        end: { dateTime: input.end, timeZone: input.timezone },
        start: { dateTime: input.start, timeZone: input.timezone },
        summary: input.summary
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });

    return toProviderEvent(await readAndParseProviderJson(response, eventResponseSchema));
  }

  async cancelEvent(accessToken: string, input: GoogleCalendarCancelEventInput): Promise<void> {
    const url = calendarEventUrl(input.calendarId, input.eventId);
    url.searchParams.set("sendUpdates", "all");
    await this.request(url, accessToken, { method: "DELETE" }, [404, 410]);
  }

  private async request(
    url: string | URL,
    accessToken: string,
    init: RequestInit = {},
    acceptedStatuses: readonly number[] = []
  ): Promise<Response> {
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          authorization: `Bearer ${accessToken}`
        },
        signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch {
      throw new GoogleCalendarProviderError({
        code: GoogleCalendarProviderErrorCode.PROVIDER_UNAVAILABLE,
        message: "Google Calendar is temporarily unavailable.",
        retryable: true
      });
    }

    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      throw await classifyProviderError(response);
    }

    return response;
  }
}

async function readAndParseProviderJson<Output>(
  response: Response,
  schema: z.ZodType<Output>
): Promise<Output> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new GoogleCalendarProviderError({
      code: GoogleCalendarProviderErrorCode.INVALID_RESPONSE,
      message: "Google Calendar returned an invalid response."
    });
  }
}

async function classifyProviderError(response: Response): Promise<GoogleCalendarProviderError> {
  const status = response.status;
  const reasons = await readProviderErrorReasons(response);

  if (status === 401) {
    return new GoogleCalendarProviderError({
      code: GoogleCalendarProviderErrorCode.AUTHORIZATION_REJECTED,
      message: "Google Calendar authorization needs to be renewed.",
      reconnectRequired: true,
      status
    });
  }

  if (status === 403 && reasons.includes("authError")) {
    return new GoogleCalendarProviderError({
      code: GoogleCalendarProviderErrorCode.AUTHORIZATION_REJECTED,
      message: "Google Calendar authorization needs to be renewed.",
      reconnectRequired: true,
      status
    });
  }

  if (
    status === 429 ||
    (status === 403 &&
      reasons.some((reason) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason)))
  ) {
    return new GoogleCalendarProviderError({
      code: GoogleCalendarProviderErrorCode.RATE_LIMITED,
      message: "Google Calendar is rate limiting requests.",
      retryable: true,
      status
    });
  }

  if (status === 408 || status >= 500) {
    return new GoogleCalendarProviderError({
      code: GoogleCalendarProviderErrorCode.PROVIDER_UNAVAILABLE,
      message: "Google Calendar is temporarily unavailable.",
      retryable: true,
      status
    });
  }

  return new GoogleCalendarProviderError({
    code: GoogleCalendarProviderErrorCode.PROVIDER_REJECTED,
    message: "Google Calendar rejected the request.",
    status
  });
}

async function readProviderErrorReasons(response: Response): Promise<string[]> {
  try {
    const payload = providerErrorResponseSchema.parse(await response.clone().json());
    return payload.error.errors?.map((error) => error.reason) ?? [];
  } catch {
    return [];
  }
}

function calendarEventCollectionUrl(calendarId: string): URL {
  return new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
}

function calendarEventUrl(calendarId: string, eventId: string): URL {
  return new URL(
    `${calendarEventCollectionUrl(calendarId).toString()}/${encodeURIComponent(eventId)}`
  );
}

function hashIdempotencyKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toProviderEvent(value: z.infer<typeof eventResponseSchema>): GoogleCalendarProviderEvent {
  return {
    ...(value.conferenceData === undefined ? {} : { conferenceData: value.conferenceData }),
    ...(value.etag ? { etag: value.etag } : {}),
    ...(value.htmlLink ? { htmlLink: value.htmlLink } : {}),
    id: value.id,
    ...(value.status ? { status: value.status } : {})
  };
}
