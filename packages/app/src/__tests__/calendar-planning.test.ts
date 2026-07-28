import { AppPlanStatus } from "@vekil/app-sdk/runtime";
import { describe, expect, it } from "vitest";
import { GoogleCalendarActionKey, GoogleCalendarIntentKey, planGoogleCalendarAction } from "..";
import { createCalendarPlanRequest, googleCalendarTestBindings } from "./fixtures/runtime-requests";

describe("Google Calendar planning acceptance", () => {
  it("starts with purpose and a preferred window without asking for email too early", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {},
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.NEEDS_CLARIFICATION,
      missingFields: ["purpose", "time-min", "time-max"]
    });
  });

  it("finds meeting options before collecting an invitation email", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          "duration-minutes": 45,
          purpose: "Review the product roadmap",
          "time-max": "2026-07-17T18:00:00+05:00",
          "time-min": "2026-07-14T09:00:00+05:00"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.READY,
      actions: [
        {
          actionId: googleCalendarTestBindings.actionId(GoogleCalendarActionKey.GET_AVAILABILITY),
          input: {
            calendarIds: ["primary"],
            durationMinutes: 45,
            timeMax: "2026-07-17T18:00:00+05:00",
            timeMin: "2026-07-14T09:00:00+05:00"
          }
        }
      ]
    });
  });

  it("builds a deterministic create action from verified identity and Vekil settings", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          purpose: "Review the project roadmap",
          start: "2026-07-14T15:00:00+05:00",
          title: "Project sync"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.READY,
      actions: [
        {
          actionId: googleCalendarTestBindings.actionId(GoogleCalendarActionKey.CREATE_EVENT),
          input: {
            attendeeEmails: ["alex@example.com"],
            calendarId: "primary",
            description: expect.stringContaining("Purpose: Review the project roadmap"),
            end: "2026-07-14T15:30:00+05:00",
            idempotencyKey: "calendar-idempotency-key-1",
            schedulingConstraints: {
              bufferAfterMinutes: 0,
              bufferBeforeMinutes: 0,
              minimumNoticeMinutes: 120,
              workingDayEnd: "18:00",
              workingDayStart: "09:00",
              workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"]
            },
            start: "2026-07-14T15:00:00+05:00",
            summary: "Project sync",
            timezone: "Asia/Samarkand"
          }
        }
      ]
    });
  });

  it("uses the meeting purpose as the event identity when no title is supplied", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          purpose: "Discuss a frontend architecture review",
          start: "2026-07-14T15:00:00+05:00"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.READY,
      actions: [
        {
          input: {
            description: expect.stringContaining("Purpose: Discuss a frontend architecture review"),
            summary: "Discuss a frontend architecture review - Alex"
          }
        }
      ]
    });
  });

  it("does not infer a requester's name from the email address", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          purpose: "Discuss a frontend architecture review",
          start: "2026-07-14T15:00:00+05:00"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE,
        requesterDisplayName: null
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.READY,
      actions: [
        {
          input: {
            description: expect.stringContaining("requester <alex@example.com>"),
            summary: "Discuss a frontend architecture review"
          }
        }
      ]
    });
    expect(JSON.stringify(result)).not.toContain(" - alex");
  });

  it("rejects an invalid meeting range before it can become an external action", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          purpose: "Project sync",
          start: "2026-07-14T15:30:00+05:00",
          end: "2026-07-14T15:00:00+05:00"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_CREATE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.REJECTED,
      actions: []
    });
  });

  it("carries App scheduling constraints into a reschedule action", () => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({
        input: {
          "event-id": "event-1",
          start: "2026-07-14T16:00:00+05:00"
        },
        intentKey: GoogleCalendarIntentKey.MEETING_RESCHEDULE
      }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.READY,
      actions: [
        {
          actionId: googleCalendarTestBindings.actionId(GoogleCalendarActionKey.UPDATE_EVENT),
          input: {
            eventId: "event-1",
            schedulingConstraints: {
              minimumNoticeMinutes: 120,
              workingDayEnd: "18:00",
              workingDayStart: "09:00"
            }
          }
        }
      ]
    });
  });

  it.each([
    {
      intentKey: GoogleCalendarIntentKey.AVAILABILITY_ASK,
      missingFields: ["time-min", "time-max"]
    },
    {
      intentKey: GoogleCalendarIntentKey.MEETING_RESCHEDULE,
      missingFields: ["event-id", "start"]
    },
    {
      intentKey: GoogleCalendarIntentKey.MEETING_CANCEL,
      missingFields: ["event-id"]
    }
  ])("returns typed clarification for $intentKey", ({ intentKey, missingFields }) => {
    const result = planGoogleCalendarAction(
      createCalendarPlanRequest({ input: {}, intentKey }),
      googleCalendarTestBindings
    );

    expect(result).toMatchObject({
      status: AppPlanStatus.NEEDS_CLARIFICATION,
      missingFields
    });
  });
});
