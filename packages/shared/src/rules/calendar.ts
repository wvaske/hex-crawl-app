import type { CalendarConfig } from '../domain.js';
import { formatTimeOfDay, timeOfDay } from './time.js';

/**
 * Fantasy calendars over the campaign clock (issue #79).
 *
 * The clock stays what it always was — minutes since campaign start — and this
 * module is pure naming on top of it. Nothing here mutates state, and with no
 * calendar configured every function falls back to the original "Day N".
 *
 * Model: months all share one length (`monthLength`); festivals are
 * intercalary days that sit *between* months and belong to no month, so
 * "Midwinter" is a date in its own right rather than "Hammer 31". A year is
 * `months.length * monthLength + festivals.length` days.
 *
 * Import direction is one-way — this file imports `time.ts`, never the other
 * way round — so `formatDay`/`formatClock` stay calendar-free and callers that
 * *have* a calendar reach for `formatCalendarDate`/`formatCalendarClock`.
 */

export interface CalendarDate {
  /** Year number. */
  year: number;
  /** 0-based day of year. */
  dayOfYear: number;
  /** 0-based month index, or null on a festival day. */
  monthIndex: number | null;
  /** Month name, or null on a festival day. */
  month: string | null;
  /** 1-based day within the month, or null on a festival day. */
  day: number | null;
  /** Festival name when this day is a festival, else null. */
  festival: string | null;
}

/** Days in one year of this calendar (months plus intercalary festivals). */
export function calendarYearLength(calendar: CalendarConfig): number {
  return calendar.months.length * calendar.monthLength + (calendar.festivals?.length ?? 0);
}

/**
 * The ordered day slots of one year: each month's days in turn, with a
 * festival slotted in after the month it follows (`afterMonth`, 0-based).
 * Festivals whose `afterMonth` is out of range are appended at year's end so a
 * misconfigured calendar still renders every day.
 */
function yearSlots(calendar: CalendarConfig): CalendarDate[] {
  const festivals = calendar.festivals ?? [];
  const slots: CalendarDate[] = [];
  const push = (partial: Omit<CalendarDate, 'year' | 'dayOfYear'>) =>
    slots.push({ year: 0, dayOfYear: slots.length, ...partial });

  calendar.months.forEach((month, monthIndex) => {
    for (let day = 1; day <= calendar.monthLength; day++) {
      push({ monthIndex, month, day, festival: null });
    }
    for (const f of festivals.filter((x) => x.afterMonth === monthIndex)) {
      push({ monthIndex: null, month: null, day: null, festival: f.name });
    }
  });
  for (const f of festivals.filter((x) => x.afterMonth >= calendar.months.length)) {
    push({ monthIndex: null, month: null, day: null, festival: f.name });
  }
  return slots;
}

/**
 * Resolve a campaign day number (1-based, as `timeOfDay().day` reports it) to
 * a calendar date. `calendar.startDayOfYear` says where in the year day 1
 * falls, so a campaign can open on Marpenoth 12 rather than New Year's Day.
 */
export function calendarDateForDay(day: number, calendar: CalendarConfig): CalendarDate {
  const yearLength = calendarYearLength(calendar);
  const slots = yearSlots(calendar);
  const absolute = Math.max(0, Math.floor(day) - 1) + (calendar.startDayOfYear ?? 0);
  const yearOffset = Math.floor(absolute / yearLength);
  const dayOfYear = ((absolute % yearLength) + yearLength) % yearLength;
  const slot = slots[dayOfYear]!;
  return { ...slot, year: calendar.startYear + yearOffset, dayOfYear };
}

/** "Marpenoth 12, 1492 DR" / "Midwinter, 1492 DR". */
export function formatCalendarDay(date: CalendarDate, calendar: CalendarConfig): string {
  const suffix = calendar.yearSuffix ? ` ${calendar.yearSuffix}` : '';
  const head = date.festival ?? `${date.month} ${date.day}`;
  return `${head}, ${date.year}${suffix}`;
}

/**
 * The campaign date for a clock reading: a calendar date when the campaign has
 * one configured, and the plain "Day 3" otherwise.
 */
export function formatCalendarDate(
  minutes: number,
  calendar?: CalendarConfig | null,
): string {
  const { day } = timeOfDay(minutes);
  if (!calendar) return `Day ${day}`;
  return formatCalendarDay(calendarDateForDay(day, calendar), calendar);
}

/** "Marpenoth 12, 1492 DR, 6:40 PM" — the calendar-aware `formatClock`. */
export function formatCalendarClock(minutes: number, calendar?: CalendarConfig | null): string {
  return `${formatCalendarDate(minutes, calendar)}, ${formatTimeOfDay(minutes)}`;
}

/**
 * The Calendar of Harptos (Forgotten Realms): twelve 30-day months with five
 * intercalary festivals, 365 days a year.
 *
 * Shieldmeet — the leap day after Midsummer every fourth year — is deliberately
 * NOT modelled: the calendar model has no leap rule, and adding one for a
 * single setting would complicate every date computation. A Harptos campaign
 * that plays through a Shieldmeet year drifts one day; the DM can nudge the
 * clock with `time.set` if it matters.
 */
export const HARPTOS_PRESET: CalendarConfig = {
  name: 'Harptos',
  monthLength: 30,
  months: [
    'Hammer',
    'Alturiak',
    'Ches',
    'Tarsakh',
    'Mirtul',
    'Kythorn',
    'Flamerule',
    'Eleasis',
    'Eleint',
    'Marpenoth',
    'Uktar',
    'Nightal',
  ],
  startYear: 1492,
  yearSuffix: 'DR',
  festivals: [
    { name: 'Midwinter', afterMonth: 0 },
    { name: 'Greengrass', afterMonth: 3 },
    { name: 'Midsummer', afterMonth: 6 },
    { name: 'Highharvestide', afterMonth: 8 },
    { name: 'Feast of the Moon', afterMonth: 10 },
  ],
  startDayOfYear: 0,
};

/** Calendar presets offered in the UI (plus "none", which stores null). */
export const CALENDAR_PRESETS: CalendarConfig[] = [HARPTOS_PRESET];

/**
 * Every day of a calendar year as a pickable label, in order — the "campaign
 * starts on …" selector in settings. The index is the `startDayOfYear` value.
 */
export function calendarDayOptions(calendar: CalendarConfig): { value: number; label: string }[] {
  return yearSlots(calendar).map((slot, value) => ({
    value,
    label: slot.festival ?? `${slot.month} ${slot.day}`,
  }));
}
