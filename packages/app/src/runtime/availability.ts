import { DateTime, Interval } from "luxon";
import {
  GoogleCalendarWeekday,
  type GoogleCalendarAvailabilityInput,
  type GoogleCalendarAvailabilitySlot,
  type GoogleCalendarBusyBlock,
  type GoogleCalendarSchedulingConstraints
} from "../contracts";

const slotStepMinutes = 15;
const maxSuggestedSlots = 5;

export interface NormalizedAvailabilityWindow {
  end: DateTime;
  providerTimeMax: string;
  providerTimeMin: string;
  start: DateTime;
}

export function normalizeAvailabilityWindow(
  input: GoogleCalendarAvailabilityInput
): NormalizedAvailabilityWindow | null {
  const start = parseCalendarDateTime(input.timeMin, input.timezone);
  const end = parseCalendarDateTime(input.timeMax, input.timezone);

  if (!start?.isValid || !end?.isValid || end <= start) {
    return null;
  }

  const providerTimeMin = start.toUTC().toISO({ suppressMilliseconds: true });
  const providerTimeMax = end.toUTC().toISO({ suppressMilliseconds: true });

  if (!providerTimeMin || !providerTimeMax) {
    return null;
  }

  return { end, providerTimeMax, providerTimeMin, start };
}

export function findAvailableMeetingSlots({
  busy,
  input,
  referenceTime,
  window = normalizeAvailabilityWindow(input)
}: {
  busy: GoogleCalendarBusyBlock[];
  input: GoogleCalendarAvailabilityInput;
  referenceTime?: string;
  window?: NormalizedAvailabilityWindow | null;
}): GoogleCalendarAvailabilitySlot[] {
  if (!window) {
    return [];
  }

  const durationMinutes = Math.max(5, Math.min(input.durationMinutes, 480));
  const busyIntervals = normalizeBusyIntervals(busy, input.timezone);
  const minimumStart = readMinimumStart({
    constraints: input.schedulingConstraints,
    referenceTime,
    timezone: input.timezone
  });
  const slots: GoogleCalendarAvailabilitySlot[] = [];
  let cursor = roundUpToStep(
    minimumStart && minimumStart > window.start ? minimumStart : window.start,
    slotStepMinutes
  );

  while (slots.length < maxSuggestedSlots) {
    const slotEnd = cursor.plus({ minutes: durationMinutes });

    if (slotEnd > window.end) {
      break;
    }

    if (!isInsideWorkingSchedule(cursor, slotEnd, input.schedulingConstraints)) {
      cursor = roundUpToStep(cursor.plus({ minutes: slotStepMinutes }), slotStepMinutes);
      continue;
    }

    const candidate = bufferedMeetingInterval(cursor, slotEnd, input.schedulingConstraints);
    const conflict = busyIntervals.find((interval) => interval.overlaps(candidate));

    if (conflict) {
      cursor = roundUpToStep(
        (conflict.end ?? slotEnd).plus({
          minutes: input.schedulingConstraints.bufferBeforeMinutes
        }),
        slotStepMinutes
      );
      continue;
    }

    const start = cursor.toISO({ suppressMilliseconds: true });
    const end = slotEnd.toISO({ suppressMilliseconds: true });

    if (start && end) {
      slots.push({ durationMinutes, end, start });
    }

    cursor = slotEnd;
  }

  return slots;
}

export function overlapsBusyBlock({
  busy,
  end,
  schedulingConstraints,
  start,
  timezone
}: {
  busy: GoogleCalendarBusyBlock[];
  end: string;
  schedulingConstraints?: GoogleCalendarSchedulingConstraints;
  start: string;
  timezone: string;
}): boolean {
  const candidateStart = parseCalendarDateTime(start, timezone);
  const candidateEnd = parseCalendarDateTime(end, timezone);

  if (!candidateStart || !candidateEnd || candidateEnd <= candidateStart) {
    return true;
  }

  const candidate = schedulingConstraints
    ? bufferedMeetingInterval(candidateStart, candidateEnd, schedulingConstraints)
    : Interval.fromDateTimes(candidateStart, candidateEnd);
  return normalizeBusyIntervals(busy, timezone).some((interval) => interval.overlaps(candidate));
}

export function isMeetingSlotAvailable({
  busy,
  end,
  input,
  referenceTime,
  start
}: {
  busy: GoogleCalendarBusyBlock[];
  end: string;
  input: GoogleCalendarAvailabilityInput;
  referenceTime?: string;
  start: string;
}): boolean {
  const candidateStart = parseCalendarDateTime(start, input.timezone);
  const candidateEnd = parseCalendarDateTime(end, input.timezone);

  if (!candidateStart || !candidateEnd || candidateEnd <= candidateStart) {
    return false;
  }

  const minimumStart = readMinimumStart({
    constraints: input.schedulingConstraints,
    referenceTime,
    timezone: input.timezone
  });

  if (minimumStart && candidateStart < minimumStart) {
    return false;
  }

  if (!isInsideWorkingSchedule(candidateStart, candidateEnd, input.schedulingConstraints)) {
    return false;
  }

  return !overlapsBusyBlock({
    busy,
    end,
    schedulingConstraints: input.schedulingConstraints,
    start,
    timezone: input.timezone
  });
}

function normalizeBusyIntervals(busy: GoogleCalendarBusyBlock[], timezone: string): Interval[] {
  return busy
    .map((block) => {
      const start = parseCalendarDateTime(block.start, timezone);
      const end = parseCalendarDateTime(block.end, timezone);

      return start?.isValid && end?.isValid && end > start
        ? Interval.fromDateTimes(start, end)
        : null;
    })
    .filter((interval): interval is Interval => interval !== null)
    .sort((left, right) => (left.start?.toMillis() ?? 0) - (right.start?.toMillis() ?? 0));
}

function bufferedMeetingInterval(
  start: DateTime,
  end: DateTime,
  constraints: GoogleCalendarSchedulingConstraints
): Interval {
  return Interval.fromDateTimes(
    start.minus({ minutes: constraints.bufferBeforeMinutes }),
    end.plus({ minutes: constraints.bufferAfterMinutes })
  );
}

function isInsideWorkingSchedule(
  start: DateTime,
  end: DateTime,
  constraints: GoogleCalendarSchedulingConstraints
): boolean {
  if (start.toISODate() !== end.toISODate()) {
    return false;
  }

  const weekday = weekdayByIsoNumber[start.weekday];
  if (!weekday || !constraints.workingDays.includes(weekday)) {
    return false;
  }

  const workingStart = atLocalTime(start, constraints.workingDayStart);
  const workingEnd = atLocalTime(start, constraints.workingDayEnd);

  return (
    workingStart !== null &&
    workingEnd !== null &&
    workingEnd > workingStart &&
    start >= workingStart &&
    end <= workingEnd
  );
}

function readMinimumStart({
  constraints,
  referenceTime,
  timezone
}: {
  constraints: GoogleCalendarSchedulingConstraints;
  referenceTime?: string;
  timezone: string;
}): DateTime | null {
  if (!referenceTime) {
    return null;
  }

  const reference = parseCalendarDateTime(referenceTime, timezone);
  return reference?.plus({ minutes: constraints.minimumNoticeMinutes }) ?? null;
}

function atLocalTime(day: DateTime, value: string): DateTime | null {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const result = day.startOf("day").set({ hour, minute });
  return result.isValid ? result : null;
}

function parseCalendarDateTime(value: string, timezone: string): DateTime | null {
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = hasExplicitZone
    ? DateTime.fromISO(value, { setZone: true }).setZone(timezone)
    : DateTime.fromISO(value, { zone: timezone });

  return parsed.isValid ? parsed : null;
}

function roundUpToStep(value: DateTime, stepMinutes: number): DateTime {
  const normalized = value.set({ second: 0, millisecond: 0 });
  const remainder = normalized.minute % stepMinutes;
  const hasSubMinuteValue = value.second > 0 || value.millisecond > 0;
  const minutesToAdd = remainder === 0 && !hasSubMinuteValue ? 0 : stepMinutes - remainder;

  return normalized.plus({ minutes: minutesToAdd });
}

const weekdayByIsoNumber: Partial<Record<number, GoogleCalendarWeekday>> = {
  1: GoogleCalendarWeekday.MONDAY,
  2: GoogleCalendarWeekday.TUESDAY,
  3: GoogleCalendarWeekday.WEDNESDAY,
  4: GoogleCalendarWeekday.THURSDAY,
  5: GoogleCalendarWeekday.FRIDAY,
  6: GoogleCalendarWeekday.SATURDAY,
  7: GoogleCalendarWeekday.SUNDAY
};
