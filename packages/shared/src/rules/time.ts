import type { CampaignTime, CustomTravelMode, TravelPace } from '../domain.js';

/**
 * Campaign clock rules: travel speed, time of day, day/night.
 *
 * The clock is a single integer — in-game minutes since campaign start — so
 * arithmetic never has to care about calendars. A day is 1440 minutes and
 * dates render as "Day N"; a fantasy calendar (issue #79) can layer month and
 * year naming on top of the same number without touching any of this.
 */

export const MINUTES_PER_DAY = 1440;

export interface TravelMode {
  id: string;
  label: string;
  /** Miles covered per hour at normal pace. */
  mph: number;
}

/** Built-in travel modes. Campaigns may add their own in settings. */
export const TRAVEL_MODES: TravelMode[] = [
  { id: 'foot', label: 'On foot', mph: 3 },
  { id: 'horse', label: 'Horseback', mph: 6 },
  { id: 'wagon', label: 'Wagon', mph: 4 },
  { id: 'ship', label: 'Ship', mph: 5 },
  { id: 'flying', label: 'Flying', mph: 9 },
];

export const TRAVEL_PACES = ['fast', 'normal', 'careful'] as const;

/** D&D-style pace multipliers applied to the mode's speed. */
export const PACE_MULTIPLIER: Record<TravelPace, number> = {
  fast: 4 / 3,
  normal: 1,
  careful: 2 / 3,
};

export const PACE_LABEL: Record<TravelPace, string> = {
  fast: 'Fast',
  normal: 'Normal',
  careful: 'Careful',
};

/** Every mode available to a campaign: the built-ins plus its custom ones. */
export function travelModes(custom: CustomTravelMode[] = []): TravelMode[] {
  return [...TRAVEL_MODES, ...custom.map((m) => ({ id: m.id, label: m.name, mph: m.mph }))];
}

/** Look up a mode by id; falls back to the first built-in (on foot). */
export function resolveTravelMode(id: string, custom: CustomTravelMode[] = []): TravelMode {
  return travelModes(custom).find((m) => m.id === id) ?? TRAVEL_MODES[0]!;
}

/**
 * In-game minutes to cross one hex. `mode` is a travel mode or a raw speed in
 * miles per hour. Returns 0 for a zero-length hex or a standstill speed.
 */
export function minutesPerHex(
  milesPerHex: number,
  mode: TravelMode | number,
  pace: TravelPace = 'normal',
): number {
  const mph = typeof mode === 'number' ? mode : mode.mph;
  const effective = mph * PACE_MULTIPLIER[pace];
  if (!(effective > 0) || !(milesPerHex > 0)) return 0;
  return (milesPerHex / effective) * 60;
}

export interface TimeOfDay {
  /** 1-based day number since campaign start. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
}

export function timeOfDay(minutes: number): TimeOfDay {
  const total = Math.max(0, Math.floor(minutes));
  const dayMinutes = total % MINUTES_PER_DAY;
  return {
    day: Math.floor(total / MINUTES_PER_DAY) + 1,
    hour: Math.floor(dayMinutes / 60),
    minute: dayMinutes % 60,
  };
}

export interface DaylightSettings {
  sunriseHour?: number;
  sunsetHour?: number;
}

/** Is the campaign clock currently after sunset / before sunrise? */
export function isNight(minutes: number, settings: DaylightSettings = {}): boolean {
  const sunrise = settings.sunriseHour ?? 6;
  const sunset = settings.sunsetHour ?? 20;
  const total = Math.max(0, Math.floor(minutes));
  const hour = (total % MINUTES_PER_DAY) / 60;
  if (sunrise <= sunset) return hour < sunrise || hour >= sunset;
  // Inverted configuration (polar night and the like): daylight wraps midnight.
  return hour >= sunset && hour < sunrise;
}

/** "Day 3" — deliberately calendar-free; #79 can rename this layer. */
export function formatDay(minutes: number): string {
  return `Day ${timeOfDay(minutes).day}`;
}

/** "6:40 PM" */
export function formatTimeOfDay(minutes: number): string {
  const { hour, minute } = timeOfDay(minutes);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "Day 3, 6:40 PM" */
export function formatClock(minutes: number): string {
  return `${formatDay(minutes)}, ${formatTimeOfDay(minutes)}`;
}

/** "8 hours", "45 minutes", "1 day 3 hours" — for time-advance log lines. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return 'no time';
  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / 60);
  const mins = total % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Minutes the party has spent on their current hex, per the campaign clock. */
export function minutesOnCurrentHex(time: CampaignTime): number {
  if (!time.partyHex) return 0;
  return Math.max(0, time.minutes - time.partyHex.arrivedMinutes);
}
