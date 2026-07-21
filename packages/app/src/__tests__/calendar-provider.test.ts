import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GoogleCalendarHttpProvider,
  GoogleCalendarProviderErrorCode,
  defaultGoogleCalendarSchedulingConstraints,
  type GoogleCalendarCreateEventInput
} from "..";

describe("Google Calendar provider contract", () => {
  it("normalizes a DST-crossing free-busy window and exposes no event details", async () => {
    const requests: CapturedRequest[] = [];
    const provider = new GoogleCalendarHttpProvider(
      captureFetch(requests, () =>
        Response.json({
          calendars: {
            primary: {
              busy: [
                {
                  start: "2026-03-08T07:00:00Z",
                  end: "2026-03-08T07:30:00Z"
                }
              ]
            }
          }
        })
      )
    );

    await expect(
      provider.getBusyBlocks("access-token", {
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        timeMin: "2026-03-08T01:30:00-05:00",
        timeMax: "2026-03-08T04:30:00-04:00",
        timezone: "America/New_York"
      })
    ).resolves.toEqual([
      {
        start: "2026-03-08T07:00:00Z",
        end: "2026-03-08T07:30:00Z"
      }
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.toString()).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      items: [{ id: "primary" }],
      timeMax: "2026-03-08T08:30:00Z",
      timeMin: "2026-03-08T06:30:00Z",
      timeZone: "America/New_York"
    });
  });

  it("reconciles an ambiguous duplicate create through a deterministic event id", async () => {
    const requests: CapturedRequest[] = [];
    const input = createEventInput();
    const hash = createHash("sha256").update(input.idempotencyKey).digest("hex");
    const eventId = `vkl${hash}`;
    const provider = new GoogleCalendarHttpProvider(
      captureFetch(requests, ({ index }) =>
        index === 0
          ? new Response(null, { status: 409 })
          : Response.json({
              id: eventId,
              htmlLink: "https://calendar.google.com/calendar/event?eid=test",
              extendedProperties: {
                private: { vekilIdempotencyHash: hash }
              }
            })
      )
    );

    await expect(provider.createEvent("access-token", input)).resolves.toMatchObject({
      id: eventId
    });

    expect(requests).toHaveLength(2);
    const createUrl = requests[0]?.url;
    expect(createUrl?.searchParams.get("sendUpdates")).toBe("all");
    expect(createUrl?.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      id: eventId,
      extendedProperties: {
        private: { vekilIdempotencyHash: hash }
      }
    });
    expect(requests[1]?.url.pathname.endsWith(`/events/${eventId}`)).toBe(true);
  });

  it("treats an already absent event as an idempotent cancellation outcome", async () => {
    const provider = new GoogleCalendarHttpProvider(async () =>
      Promise.resolve(new Response(null, { status: 410 }))
    );

    await expect(
      provider.cancelEvent("access-token", {
        calendarId: "primary",
        eventId: "event-1",
        idempotencyKey: "cancel-idempotency-key-1"
      })
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      body: {},
      code: GoogleCalendarProviderErrorCode.RATE_LIMITED,
      reconnectRequired: false,
      retryable: true,
      status: 429
    },
    {
      body: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
      code: GoogleCalendarProviderErrorCode.RATE_LIMITED,
      reconnectRequired: false,
      retryable: true,
      status: 403
    },
    {
      body: { error: { errors: [{ reason: "authError" }] } },
      code: GoogleCalendarProviderErrorCode.AUTHORIZATION_REJECTED,
      reconnectRequired: true,
      retryable: false,
      status: 403
    },
    {
      body: {},
      code: GoogleCalendarProviderErrorCode.PROVIDER_UNAVAILABLE,
      reconnectRequired: false,
      retryable: true,
      status: 503
    }
  ])(
    "maps Google status $status to the typed runtime error contract",
    async ({ body, code, reconnectRequired, retryable, status }) => {
      const provider = new GoogleCalendarHttpProvider(async () =>
        Promise.resolve(Response.json(body, { status }))
      );

      await expect(provider.listCalendars("access-token")).rejects.toMatchObject({
        code,
        reconnectRequired,
        retryable,
        status
      });
    }
  );

  it("bounds provider latency and maps a timeout to a retryable outage", async () => {
    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true
        });
      });
    const provider = new GoogleCalendarHttpProvider(fetchImpl, 5);

    await expect(provider.listCalendars("access-token")).rejects.toMatchObject({
      code: GoogleCalendarProviderErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true
    });
  });
});

interface CapturedRequest {
  init: RequestInit;
  url: URL;
}

function captureFetch(
  requests: CapturedRequest[],
  respond: (input: { index: number; request: CapturedRequest }) => Response
): typeof fetch {
  return async (input, init = {}) => {
    const request = {
      init,
      url: new URL(input instanceof Request ? input.url : input.toString())
    };
    const index = requests.push(request) - 1;
    return respond({ index, request });
  };
}

function createEventInput(): GoogleCalendarCreateEventInput {
  return {
    attendeeEmails: ["requester@example.com"],
    calendarId: "primary",
    createGoogleMeet: true,
    description: "Requested through Vekil.",
    end: "2026-07-14T15:30:00+05:00",
    idempotencyKey: "create-idempotency-key-1",
    start: "2026-07-14T15:00:00+05:00",
    summary: "Meeting",
    schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
    timezone: "Asia/Samarkand"
  };
}
