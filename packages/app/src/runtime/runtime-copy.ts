export interface GoogleCalendarRuntimeCopy {
  locale: string;
  reconnect: string;
  unsupportedAction: string;
  invalidInput: string;
  executionFailed: string;
  cancelledBadge: string;
  cancelledBody: string;
  cancelledTitle: string;
  calendarLabel: string;
  eventLabel: string;
  optionsLabel: (count: number) => string;
  noOpenTimes: string;
  meetingOptionsBody: string;
  availabilityBody: string;
  noMeetingOptionsBody: string;
  noAvailabilityBody: string;
  optionLabel: (index: number) => string;
  chooseTimeTitle: string;
  availableTimesTitle: string;
  noAvailableTimesTitle: string;
  timeUnavailableBadge: string;
  slotUnavailableWithAlternativesBody: string;
  slotUnavailableBody: string;
  chooseAnotherTimeTitle: string;
  openEventAction: string;
  doneBadge: string;
  eventUpdatedBody: string;
  startLabel: string;
  endLabel: string;
  meetingCreatedTitle: string;
  meetingRescheduledTitle: string;
}

const copyByLanguage: Record<string, GoogleCalendarRuntimeCopy> = {
  en: {
    locale: "en",
    reconnect: "Reconnect Google Calendar.",
    unsupportedAction: "This Google Calendar action is not supported.",
    invalidInput: "The calendar action input is invalid.",
    executionFailed: "Google Calendar could not complete this action.",
    cancelledBadge: "Cancelled",
    cancelledBody: "The calendar event was cancelled and attendees were notified.",
    cancelledTitle: "Meeting cancelled",
    calendarLabel: "Calendar",
    eventLabel: "Event",
    optionsLabel: (count) => `${count} ${count === 1 ? "option" : "options"}`,
    noOpenTimes: "No open times",
    meetingOptionsBody: "These times fit the calendar rules. Choose the one that works for you.",
    availabilityBody: "These times are free under the current calendar rules.",
    noMeetingOptionsBody:
      "There is not enough free time in this window. Send another time range to continue.",
    noAvailabilityBody: "There is not enough free time in this window.",
    optionLabel: (index) => `Option ${index}`,
    chooseTimeTitle: "Choose a time",
    availableTimesTitle: "Available times",
    noAvailableTimesTitle: "No available times",
    timeUnavailableBadge: "Time unavailable",
    slotUnavailableWithAlternativesBody:
      "That time is not available. These nearby times fit the calendar rules.",
    slotUnavailableBody: "That time is not available. Ask for another time range to continue.",
    chooseAnotherTimeTitle: "Choose another time",
    openEventAction: "Open event",
    doneBadge: "Done",
    eventUpdatedBody: "Google Calendar has been updated and attendees were notified.",
    startLabel: "Start",
    endLabel: "End",
    meetingCreatedTitle: "Meeting created",
    meetingRescheduledTitle: "Meeting rescheduled"
  },
  ru: {
    locale: "ru",
    reconnect: "Переподключите Google Calendar.",
    unsupportedAction: "Google Calendar не поддерживает это действие.",
    invalidInput: "Не удалось проверить данные для действия с календарём.",
    executionFailed: "Google Calendar не смог выполнить это действие.",
    cancelledBadge: "Отменена",
    cancelledBody: "Встреча отменена, участники получили уведомление.",
    cancelledTitle: "Встреча отменена",
    calendarLabel: "Календарь",
    eventLabel: "Событие",
    optionsLabel: (count) => `${count} ${russianOptionNoun(count)}`,
    noOpenTimes: "Нет свободного времени",
    meetingOptionsBody: "Эти варианты подходят под правила календаря. Выберите удобное время.",
    availabilityBody: "Это свободное время с учётом текущих правил календаря.",
    noMeetingOptionsBody:
      "В этом диапазоне недостаточно свободного времени. Укажите другой день или диапазон.",
    noAvailabilityBody: "В этом диапазоне недостаточно свободного времени.",
    optionLabel: (index) => `Вариант ${index}`,
    chooseTimeTitle: "Выберите время",
    availableTimesTitle: "Свободное время",
    noAvailableTimesTitle: "Нет свободного времени",
    timeUnavailableBadge: "Время уже занято",
    slotUnavailableWithAlternativesBody:
      "Это время уже недоступно. Вот ближайшие варианты, подходящие под правила календаря.",
    slotUnavailableBody: "Это время уже недоступно. Укажите другой день или диапазон.",
    chooseAnotherTimeTitle: "Выберите другое время",
    openEventAction: "Открыть встречу",
    doneBadge: "Готово",
    eventUpdatedBody: "Google Calendar обновлён, участники получили уведомление.",
    startLabel: "Начало",
    endLabel: "Конец",
    meetingCreatedTitle: "Встреча создана",
    meetingRescheduledTitle: "Встреча перенесена"
  }
};

export function resolveGoogleCalendarRuntimeCopy(locale: string): GoogleCalendarRuntimeCopy {
  const language = locale.trim().split(/[-_]/, 1)[0]?.toLowerCase() ?? "en";
  return copyByLanguage[language] ?? copyByLanguage.en!;
}

function russianOptionNoun(count: number): string {
  const modulo100 = count % 100;
  const modulo10 = count % 10;

  if (modulo100 >= 11 && modulo100 <= 14) {
    return "вариантов";
  }

  if (modulo10 === 1) {
    return "вариант";
  }

  return modulo10 >= 2 && modulo10 <= 4 ? "варианта" : "вариантов";
}
