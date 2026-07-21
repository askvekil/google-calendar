import { z } from "zod";

export enum GoogleCalendarActionKey {
  LIST_CALENDARS = "list-calendars",
  GET_AVAILABILITY = "get-availability",
  CREATE_EVENT = "create-event",
  UPDATE_EVENT = "update-event",
  CANCEL_EVENT = "cancel-event"
}

export enum GoogleCalendarIntentKey {
  AVAILABILITY_ASK = "availability-ask",
  MEETING_CREATE = "meeting-create",
  MEETING_RESCHEDULE = "meeting-reschedule",
  MEETING_CANCEL = "meeting-cancel"
}

export enum GoogleCalendarCapabilityKey {
  CALENDAR_LIST = "calendar-list",
  AVAILABILITY_READ = "availability-read",
  EVENT_CREATE = "event-create",
  EVENT_UPDATE = "event-update",
  EVENT_CANCEL = "event-cancel"
}

export enum GoogleCalendarArtifactKey {
  AVAILABILITY = "availability",
  MEETING_SLOT = "meeting-slot",
  EVENT = "event"
}

export enum GoogleCalendarSettingKey {
  SELECTED_CALENDAR_ID = "selected-calendar-id",
  DEFAULT_DURATION_MINUTES = "default-duration-minutes",
  WORKING_DAYS = "working-days",
  WORKING_DAY_START = "working-day-start",
  WORKING_DAY_END = "working-day-end",
  BUFFER_BEFORE_MINUTES = "buffer-before-minutes",
  BUFFER_AFTER_MINUTES = "buffer-after-minutes",
  MINIMUM_NOTICE_HOURS = "minimum-notice-hours"
}

export enum GoogleCalendarWeekday {
  MONDAY = "monday",
  TUESDAY = "tuesday",
  WEDNESDAY = "wednesday",
  THURSDAY = "thursday",
  FRIDAY = "friday",
  SATURDAY = "saturday",
  SUNDAY = "sunday"
}

export enum GoogleCalendarPolicyKey {
  UNKNOWN_REQUESTER_APPROVAL = "unknown-requester-approval",
  HIDE_EVENT_TITLES = "hide-event-titles"
}

export enum GoogleCalendarOutcomeKey {
  CALENDAR_LIST_SUCCESS = "calendar-list-success",
  AVAILABILITY_SUCCESS = "availability-success",
  MEETING_OPTIONS_SUCCESS = "meeting-options-success",
  EVENT_CREATE_SUCCESS = "event-create-success",
  EVENT_UPDATE_SUCCESS = "event-update-success",
  EVENT_CANCEL_SUCCESS = "event-cancel-success",
  SLOT_UNAVAILABLE = "slot-unavailable",
  RESCHEDULE_SLOT_UNAVAILABLE = "reschedule-slot-unavailable"
}

export const googleCalendarScopes = {
  openid: "openid",
  email: "https://www.googleapis.com/auth/userinfo.email",
  profile: "https://www.googleapis.com/auth/userinfo.profile",
  calendarList: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  freeBusy: "https://www.googleapis.com/auth/calendar.freebusy",
  events: "https://www.googleapis.com/auth/calendar.events"
} as const;

export const googleCalendarProviderScopes = Object.freeze([
  googleCalendarScopes.openid,
  googleCalendarScopes.email,
  googleCalendarScopes.profile,
  googleCalendarScopes.calendarList,
  googleCalendarScopes.freeBusy,
  googleCalendarScopes.events
]);

export const googleCalendarSchedulingConstraintsSchema = z.strictObject({
  workingDays: z.array(z.nativeEnum(GoogleCalendarWeekday)).min(1).max(7),
  workingDayStart: z.string().regex(/^\d{2}:\d{2}$/),
  workingDayEnd: z.string().regex(/^\d{2}:\d{2}$/),
  bufferBeforeMinutes: z.number().int().min(0).max(240),
  bufferAfterMinutes: z.number().int().min(0).max(240),
  minimumNoticeMinutes: z.number().int().min(0).max(60 * 24 * 90)
});

export const defaultGoogleCalendarSchedulingConstraints: GoogleCalendarSchedulingConstraints = {
  workingDays: [
    GoogleCalendarWeekday.MONDAY,
    GoogleCalendarWeekday.TUESDAY,
    GoogleCalendarWeekday.WEDNESDAY,
    GoogleCalendarWeekday.THURSDAY,
    GoogleCalendarWeekday.FRIDAY
  ],
  workingDayStart: "09:00",
  workingDayEnd: "18:00",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 120
};

export const calendarListActionInputSchema = z.strictObject({});

export const availabilityActionInputSchema = z.strictObject({
  calendarIds: z.array(z.string().min(1)).min(1).max(16),
  durationMinutes: z.number().int().min(5).max(480),
  schedulingConstraints: googleCalendarSchedulingConstraintsSchema,
  timeMin: z.string().datetime({ offset: true }),
  timeMax: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(100)
});

export const createEventActionInputSchema = z.strictObject({
  calendarId: z.string().min(1).max(1_024),
  summary: z.string().min(1).max(1_000),
  description: z.string().max(8_000).optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
  attendeeEmails: z.array(z.string().email()).max(64),
  createGoogleMeet: z.boolean(),
  schedulingConstraints: googleCalendarSchedulingConstraintsSchema,
  idempotencyKey: z.string().min(16).max(240)
});

export const updateEventActionInputSchema = z.strictObject({
  calendarId: z.string().min(1).max(1_024),
  eventId: z.string().min(1).max(1_024),
  summary: z.string().min(1).max(1_000).optional(),
  description: z.string().max(8_000).optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
  schedulingConstraints: googleCalendarSchedulingConstraintsSchema,
  idempotencyKey: z.string().min(16).max(240)
});

export const cancelEventActionInputSchema = z.strictObject({
  calendarId: z.string().min(1).max(1_024),
  eventId: z.string().min(1).max(1_024),
  idempotencyKey: z.string().min(16).max(240)
});

export type GoogleCalendarAvailabilityInput = z.infer<typeof availabilityActionInputSchema>;
export type GoogleCalendarSchedulingConstraints = z.infer<
  typeof googleCalendarSchedulingConstraintsSchema
>;
export type GoogleCalendarCreateEventInput = z.infer<typeof createEventActionInputSchema>;
export type GoogleCalendarUpdateEventInput = z.infer<typeof updateEventActionInputSchema>;
export type GoogleCalendarCancelEventInput = z.infer<typeof cancelEventActionInputSchema>;

export interface GoogleCalendarBusyBlock {
  end: string;
  start: string;
}

export interface GoogleCalendarAvailabilitySlot {
  durationMinutes: number;
  end: string;
  start: string;
}
