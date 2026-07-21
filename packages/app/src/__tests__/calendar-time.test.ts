import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  defaultGoogleCalendarSchedulingConstraints,
  findAvailableMeetingSlots,
  GoogleCalendarWeekday,
  normalizeAvailabilityWindow,
  overlapsBusyBlock
} from "..";

describe("Google Calendar time normalization", () => {
  it("keeps elapsed duration correct across the spring DST transition", () => {
    const input = {
      calendarIds: ["primary"],
      durationMinutes: 30,
      schedulingConstraints: {
        ...defaultGoogleCalendarSchedulingConstraints,
        workingDays: [
          ...defaultGoogleCalendarSchedulingConstraints.workingDays,
          GoogleCalendarWeekday.SUNDAY
        ],
        workingDayStart: "00:00",
        workingDayEnd: "23:59"
      },
      timeMin: "2026-03-08T01:30:00-05:00",
      timeMax: "2026-03-08T04:30:00-04:00",
      timezone: "America/New_York"
    };
    const slots = findAvailableMeetingSlots({
      busy: [
        {
          start: "2026-03-08T07:00:00Z",
          end: "2026-03-08T07:30:00Z"
        }
      ],
      input
    });

    expect(normalizeAvailabilityWindow(input)).toMatchObject({
      providerTimeMin: "2026-03-08T06:30:00Z",
      providerTimeMax: "2026-03-08T08:30:00Z"
    });
    expect(slots[0]).toMatchObject({
      start: "2026-03-08T01:30:00-05:00",
      end: "2026-03-08T03:00:00-04:00"
    });
    expect(slots[1]).toMatchObject({
      start: "2026-03-08T03:30:00-04:00",
      end: "2026-03-08T04:00:00-04:00"
    });
    expect(elapsedMinutes(slots[0]?.start, slots[0]?.end)).toBe(30);
  });

  it("keeps repeated fall-back wall times unambiguous through explicit offsets", () => {
    const slots = findAvailableMeetingSlots({
      busy: [],
      input: {
        calendarIds: ["primary"],
        durationMinutes: 60,
        schedulingConstraints: {
          ...defaultGoogleCalendarSchedulingConstraints,
          workingDays: [
            ...defaultGoogleCalendarSchedulingConstraints.workingDays,
            GoogleCalendarWeekday.SUNDAY
          ],
          workingDayStart: "00:00",
          workingDayEnd: "23:59"
        },
        timeMin: "2026-11-01T00:30:00-04:00",
        timeMax: "2026-11-01T02:30:00-05:00",
        timezone: "America/New_York"
      }
    });

    expect(slots.slice(0, 3).map((slot) => [slot.start, slot.end])).toEqual([
      ["2026-11-01T00:30:00-04:00", "2026-11-01T01:30:00-04:00"],
      ["2026-11-01T01:30:00-04:00", "2026-11-01T01:30:00-05:00"],
      ["2026-11-01T01:30:00-05:00", "2026-11-01T02:30:00-05:00"]
    ]);
    expect(slots.slice(0, 3).every((slot) => elapsedMinutes(slot.start, slot.end) === 60)).toBe(
      true
    );
  });

  it("treats malformed ranges and invalid zones as unavailable", () => {
    expect(
      normalizeAvailabilityWindow({
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: defaultGoogleCalendarSchedulingConstraints,
        timeMin: "2026-07-14T15:30:00+05:00",
        timeMax: "2026-07-14T15:00:00+05:00",
        timezone: "Asia/Samarkand"
      })
    ).toBeNull();
    expect(
      overlapsBusyBlock({
        busy: [],
        start: "2026-07-14T15:00:00+05:00",
        end: "2026-07-14T15:30:00+05:00",
        timezone: "Not/A_Zone"
      })
    ).toBe(true);
  });

  it("only suggests times inside the configured working schedule", () => {
    const slots = findAvailableMeetingSlots({
      busy: [],
      input: {
        calendarIds: ["primary"],
        durationMinutes: 60,
        schedulingConstraints: {
          ...defaultGoogleCalendarSchedulingConstraints,
          workingDays: [GoogleCalendarWeekday.MONDAY],
          workingDayStart: "10:00",
          workingDayEnd: "12:00"
        },
        timeMin: "2026-07-19T09:00:00+05:00",
        timeMax: "2026-07-20T13:00:00+05:00",
        timezone: "Asia/Samarkand"
      }
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T10:00:00+05:00",
      "2026-07-20T11:00:00+05:00"
    ]);
  });

  it("respects minimum notice and buffers around busy events", () => {
    const slots = findAvailableMeetingSlots({
      busy: [
        {
          start: "2026-07-20T11:00:00+05:00",
          end: "2026-07-20T11:30:00+05:00"
        }
      ],
      input: {
        calendarIds: ["primary"],
        durationMinutes: 30,
        schedulingConstraints: {
          ...defaultGoogleCalendarSchedulingConstraints,
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
          minimumNoticeMinutes: 60,
          workingDays: [GoogleCalendarWeekday.MONDAY],
          workingDayStart: "09:00",
          workingDayEnd: "13:00"
        },
        timeMin: "2026-07-20T09:00:00+05:00",
        timeMax: "2026-07-20T13:00:00+05:00",
        timezone: "Asia/Samarkand"
      },
      referenceTime: "2026-07-20T09:30:00+05:00"
    });

    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-07-20T11:45:00+05:00",
      "2026-07-20T12:15:00+05:00"
    ]);
  });
});

function elapsedMinutes(start?: string, end?: string): number | null {
  if (!start || !end) {
    return null;
  }

  return DateTime.fromISO(end, { setZone: true }).diff(
    DateTime.fromISO(start, { setZone: true }),
    "minutes"
  ).minutes;
}
