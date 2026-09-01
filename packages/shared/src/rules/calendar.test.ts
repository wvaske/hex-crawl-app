import { describe, expect, it } from 'vitest';
import {
  CALENDAR_PRESETS,
  HARPTOS_PRESET,
  calendarDateForDay,
  calendarDayOptions,
  calendarYearLength,
  formatCalendarClock,
  formatCalendarDate,
} from './calendar.js';
import { CalendarConfigSchema } from '../domain.js';
import { MINUTES_PER_DAY } from './time.js';

/** Clock minutes at 8:00 AM on the given 1-based campaign day. */
function atDay(day: number, hour = 8): number {
  return (day - 1) * MINUTES_PER_DAY + hour * 60;
}

describe('calendar fallback', () => {
  it('renders plain day numbers with no calendar configured', () => {
    expect(formatCalendarDate(atDay(1), null)).toBe('Day 1');
    expect(formatCalendarDate(atDay(3), undefined)).toBe('Day 3');
    expect(formatCalendarClock(2 * MINUTES_PER_DAY + 18 * 60 + 40, null)).toBe('Day 3, 6:40 PM');
  });
});

describe('Harptos', () => {
  it('is a valid calendar config: 12 months, 5 festivals, 365 days', () => {
    const parsed = CalendarConfigSchema.parse(HARPTOS_PRESET);
    expect(parsed.months).toHaveLength(12);
    expect(parsed.festivals).toHaveLength(5);
    expect(calendarYearLength(parsed)).toBe(365);
    expect(CALENDAR_PRESETS).toContain(HARPTOS_PRESET);
  });

  it('names the first day of the year and the first month', () => {
    expect(formatCalendarDate(atDay(1), HARPTOS_PRESET)).toBe('Hammer 1, 1492 DR');
    expect(formatCalendarDate(atDay(30), HARPTOS_PRESET)).toBe('Hammer 30, 1492 DR');
  });

  it('slots festivals between months, belonging to no month', () => {
    // Midwinter follows Hammer (day 31), and Alturiak 1 is the day after.
    const midwinter = calendarDateForDay(31, HARPTOS_PRESET);
    expect(midwinter.festival).toBe('Midwinter');
    expect(midwinter.month).toBeNull();
    expect(midwinter.monthIndex).toBeNull();
    expect(midwinter.day).toBeNull();
    expect(formatCalendarDate(atDay(31), HARPTOS_PRESET)).toBe('Midwinter, 1492 DR');
    expect(formatCalendarDate(atDay(32), HARPTOS_PRESET)).toBe('Alturiak 1, 1492 DR');
  });

  it('offsets every later month by the festivals already passed', () => {
    // Marpenoth is month 10; nine months of 30 days plus the four festivals
    // before it (Midwinter, Greengrass, Midsummer, Highharvestide) = 274 days.
    expect(formatCalendarDate(atDay(274 + 12), HARPTOS_PRESET)).toBe('Marpenoth 12, 1492 DR');
    const date = calendarDateForDay(274 + 12, HARPTOS_PRESET);
    expect(date.month).toBe('Marpenoth');
    expect(date.day).toBe(12);
    expect(date.dayOfYear).toBe(274 + 11);
  });

  it('places all five festivals where the Realms puts them', () => {
    const labels = calendarDayOptions(HARPTOS_PRESET);
    expect(labels).toHaveLength(365);
    // Month days render as "<Month> <n>"; anything else is a festival.
    const festivalDays = labels
      .map((o, i) => ({ ...o, day: i + 1 }))
      .filter((o) => !/ \d+$/.test(o.label));
    expect(festivalDays.map((f) => f.label)).toEqual([
      'Midwinter',
      'Greengrass',
      'Midsummer',
      'Highharvestide',
      'Feast of the Moon',
    ]);
    // Feast of the Moon closes out Uktar, so Nightal 1 follows it.
    const feastDay = festivalDays[4]!.day;
    expect(formatCalendarDate(atDay(feastDay), HARPTOS_PRESET)).toBe('Feast of the Moon, 1492 DR');
    expect(formatCalendarDate(atDay(feastDay + 1), HARPTOS_PRESET)).toBe('Nightal 1, 1492 DR');
  });

  it('rolls over to the next year after 365 days', () => {
    expect(formatCalendarDate(atDay(365), HARPTOS_PRESET)).toBe('Nightal 30, 1492 DR');
    expect(formatCalendarDate(atDay(366), HARPTOS_PRESET)).toBe('Hammer 1, 1493 DR');
    expect(formatCalendarDate(atDay(365 * 3 + 1), HARPTOS_PRESET)).toBe('Hammer 1, 1495 DR');
  });

  it('starts the campaign wherever startDayOfYear points', () => {
    // "The campaign opens on Marpenoth 12": day-of-year index 274 + 11.
    const calendar = { ...HARPTOS_PRESET, startDayOfYear: 274 + 11 };
    expect(formatCalendarDate(atDay(1), calendar)).toBe('Marpenoth 12, 1492 DR');
    expect(formatCalendarDate(atDay(2), calendar)).toBe('Marpenoth 13, 1492 DR');
    // 365 days after the year's day 285 comes New Year's Day of 1493.
    expect(formatCalendarDate(atDay(81), calendar)).toBe('Hammer 1, 1493 DR');
    expect(formatCalendarDate(atDay(82), calendar)).toBe('Hammer 2, 1493 DR');
  });

  it('keeps the time of day alongside the calendar date', () => {
    expect(formatCalendarClock(atDay(1, 18) + 40, HARPTOS_PRESET)).toBe(
      'Hammer 1, 1492 DR, 6:40 PM',
    );
  });
});

describe('custom calendars', () => {
  const simple = CalendarConfigSchema.parse({
    name: 'Twin Moons',
    monthLength: 10,
    months: ['First', 'Second'],
    startYear: 1,
  });

  it('handles a festival-free calendar', () => {
    expect(calendarYearLength(simple)).toBe(20);
    expect(formatCalendarDate(atDay(11), simple)).toBe('Second 1, 1');
    expect(formatCalendarDate(atDay(21), simple)).toBe('First 1, 2');
  });

  it('renders no year suffix when the calendar has none', () => {
    expect(formatCalendarDate(atDay(1), simple)).toBe('First 1, 1');
  });

  it('appends an out-of-range festival at year end rather than losing a day', () => {
    const odd = CalendarConfigSchema.parse({
      ...simple,
      festivals: [{ name: 'Longnight', afterMonth: 9 }],
    });
    expect(calendarYearLength(odd)).toBe(21);
    expect(formatCalendarDate(atDay(21), odd)).toBe('Longnight, 1');
    expect(formatCalendarDate(atDay(22), odd)).toBe('First 1, 2');
  });
});
