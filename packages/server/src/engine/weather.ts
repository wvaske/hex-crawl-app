import type { DiceRoll, Rng, WeatherEntry, WeatherState } from '@hexcrawl/shared';
import { DEFAULT_WEATHER_TABLE, MINUTES_PER_DAY, WEATHER_DIE, rollDice } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

/**
 * Campaign weather (issue #79).
 *
 * One roll per in-game day off `settings.weatherTable` (or the built-in
 * temperate table), stored on the campaign `time` blob so everyone — players
 * included — sees the same sky. Purely fictional for now: nothing reads the
 * weather to modify pace or encounter thresholds yet.
 */

/**
 * A long advance rolls once per crossed day (weather is a per-day thing, and a
 * DM who skips a week shouldn't get last week's storm), but only the final
 * day's result is kept and logged — the intervening days are already history.
 * The loop is capped so a `time.advance` of a year isn't 365 wasted rolls.
 */
const MAX_ROLLS_PER_ADVANCE = 30;

export function weatherTableFor(runtime: CampaignRuntime): WeatherEntry[] {
  const configured = runtime.campaign.settings.weatherTable;
  return configured && configured.length > 0 ? configured : DEFAULT_WEATHER_TABLE;
}

export interface WeatherRollResult {
  weather: WeatherState;
  roll: DiceRoll;
}

/** Roll the campaign's weather table once. Does not touch state. */
export function rollWeather(runtime: CampaignRuntime, rng: Rng): WeatherRollResult {
  const table = weatherTableFor(runtime);
  const roll = rollDice(WEATHER_DIE, rng);
  const hit = table.find((e) => roll.total >= e.min && roll.total <= e.max) ?? table[0]!;
  return {
    weather: {
      text: hit.text,
      icon: hit.icon,
      rolledAtMinutes: runtime.campaign.time.minutes,
    },
    roll,
  };
}

/** Roll and store — the shared tail of every path that sets the weather. */
export function setWeather(runtime: CampaignRuntime, rng: Rng): WeatherState {
  const { weather } = rollWeather(runtime, rng);
  runtime.updateTime({ weather });
  return weather;
}

/** Day number (0-based) for a clock reading. */
function dayNumber(minutes: number): number {
  return Math.floor(Math.max(0, minutes) / MINUTES_PER_DAY);
}

/**
 * Reroll the weather if the clock just crossed into a new day, or if the
 * campaign has no weather yet (which seeds a sky on the party's first move
 * rather than leaving the top bar blank until midnight).
 *
 * Returns the new weather to log, or null when nothing changed. Call AFTER the
 * clock has advanced, with the reading from before it moved.
 */
export function rerollWeatherForNewDay(
  runtime: CampaignRuntime,
  beforeMinutes: number,
  rng: Rng,
): WeatherState | null {
  const crossed = dayNumber(runtime.campaign.time.minutes) - dayNumber(beforeMinutes);
  const seeding = runtime.campaign.time.weather === null;
  if (crossed <= 0 && !seeding) return null;
  const rolls = Math.min(Math.max(crossed, 1), MAX_ROLLS_PER_ADVANCE);
  let weather: WeatherState | null = null;
  for (let i = 0; i < rolls; i++) weather = setWeather(runtime, rng);
  return weather;
}

/** The log line for a weather change: "The weather turns: Steady rain". */
export function weatherLogText(weather: WeatherState): string {
  return `The weather turns: ${weather.text}`;
}
