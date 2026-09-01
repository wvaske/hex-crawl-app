import type { LogEntry } from '../domain.js';

/**
 * Session boundaries + recap computation (issue #78).
 *
 * Pure functions only — this runs identically on the server (full log, for
 * wiki export) and in the client (a viewer's already-filtered log, so the
 * security boundary in `filter.ts` applies automatically: a player's recap
 * is built only from entries they were allowed to see).
 */

export interface RecapItem {
  id: string;
  at: number;
  text: string;
}

export interface RecapSection {
  count: number;
  items: RecapItem[];
}

export interface EncounterRecapSection {
  triggered: RecapItem[];
  quiet: RecapItem[];
}

export interface Recap {
  fromAt: number;
  toAt: number;
  /** Total log entries in range (including kinds not broken out below). */
  entryCount: number;
  /** Timestamp of the first/last entry actually in range, or null if empty. */
  wallClockStart: number | null;
  wallClockEnd: number | null;
  /** Real-world span the session covered, in ms (0 when fewer than 2 entries). */
  wallClockMs: number;
  discoveries: RecapSection;
  encounters: EncounterRecapSection;
  checks: RecapSection;
  narrations: RecapSection;
  shares: RecapSection;
  /** Minutes advanced via explicit `time.advance` log entries in range. Undercounts
   * travel time, which moves the clock without logging a 'time' entry. */
  timeLoggedMinutes: number;
  /** Minutes advanced per the campaign clock, from this session's start/end marks
   * (when both carry `atMinutes`) — the accurate figure, travel included. */
  clockDeltaMinutes: number | null;
  /** Best available estimate: clockDeltaMinutes when known, else timeLoggedMinutes. */
  timeAdvancedMinutes: number;
}

export interface RecapRange {
  /** Inclusive lower bound on entry.at. Use -Infinity for "since the start of the log". */
  fromAt: number;
  /** Exclusive upper bound on entry.at. Use Infinity for "still ongoing". */
  toAt: number;
}

function toItem(e: LogEntry): RecapItem {
  return { id: e.id, at: e.at, text: e.text };
}

/** Grouped, readable summary of everything that happened in a log window. */
export function computeRecap(log: LogEntry[], range: RecapRange): Recap {
  const { fromAt, toAt } = range;
  const inRange = log.filter((e) => e.at >= fromAt && e.at < toAt).sort((a, b) => a.at - b.at);

  const discoveries = inRange.filter((e) => e.kind === 'discovery');
  const encounters = inRange.filter((e) => e.kind === 'encounter');
  const checks = inRange.filter((e) => e.kind === 'check');
  const narrations = inRange.filter((e) => e.kind === 'narration');
  const shares = inRange.filter((e) => e.kind === 'share');
  const timeEntries = inRange.filter((e) => e.kind === 'time');

  const triggered: RecapItem[] = [];
  const quiet: RecapItem[] = [];
  for (const e of encounters) {
    const item = toItem(e);
    if ((e.data as { triggered?: unknown } | undefined)?.triggered) triggered.push(item);
    else quiet.push(item);
  }

  const timeLoggedMinutes = timeEntries.reduce((sum, e) => {
    const advancedBy = (e.data as { advancedBy?: unknown } | undefined)?.advancedBy;
    return sum + (typeof advancedBy === 'number' ? advancedBy : 0);
  }, 0);

  // Session marks that bound this exact window carry the campaign clock
  // reading at the moment they were made — a more accurate "time advanced"
  // than summing 'time' entries, since travel advances the clock silently.
  const startMark = log.find((e) => e.kind === 'session' && e.at === fromAt);
  const endMark = log.find((e) => e.kind === 'session' && e.at === toAt);
  const startMinutes = (startMark?.data as { atMinutes?: unknown } | undefined)?.atMinutes;
  const endMinutes = (endMark?.data as { atMinutes?: unknown } | undefined)?.atMinutes;
  const clockDeltaMinutes =
    typeof startMinutes === 'number' && typeof endMinutes === 'number'
      ? endMinutes - startMinutes
      : null;

  const wallClockStart = inRange.length ? inRange[0]!.at : null;
  const wallClockEnd = inRange.length ? inRange[inRange.length - 1]!.at : null;

  return {
    fromAt,
    toAt,
    entryCount: inRange.length,
    wallClockStart,
    wallClockEnd,
    wallClockMs:
      wallClockStart !== null && wallClockEnd !== null ? wallClockEnd - wallClockStart : 0,
    discoveries: { count: discoveries.length, items: discoveries.map(toItem) },
    encounters: { triggered, quiet },
    checks: { count: checks.length, items: checks.map(toItem) },
    narrations: { count: narrations.length, items: narrations.map(toItem) },
    shares: { count: shares.length, items: shares.map(toItem) },
    timeLoggedMinutes,
    clockDeltaMinutes,
    timeAdvancedMinutes: clockDeltaMinutes ?? timeLoggedMinutes,
  };
}

export interface SessionBoundary {
  /** 0 = "before records began"; 1, 2, ... follow log order of 'start' marks. */
  index: number;
  label: string;
  fromAt: number;
  toAt: number;
  startMark: LogEntry | null;
  endMark: LogEntry | null;
}

/**
 * Split a log into sessions using its 'session' kind entries. Everything
 * before the first 'start' mark is "Session 0". Each session runs from a
 * 'start' mark to the next 'end' mark (if the DM remembered to click it),
 * else to the next 'start' mark, else it's still ongoing (`toAt: Infinity`).
 */
export function computeSessions(log: LogEntry[]): SessionBoundary[] {
  const marks = log
    .filter((e) => e.kind === 'session')
    .map((e) => ({
      entry: e,
      action: (e.data as { action?: unknown } | undefined)?.action,
    }))
    .filter(
      (m): m is { entry: LogEntry; action: 'start' | 'end' } =>
        m.action === 'start' || m.action === 'end',
    )
    .sort((a, b) => a.entry.at - b.entry.at);

  const starts = marks.filter((m) => m.action === 'start');
  const firstStartAt = starts[0]?.entry.at ?? Infinity;

  const boundaries: SessionBoundary[] = [
    {
      index: 0,
      label: 'Session 0 — before records began',
      fromAt: -Infinity,
      toAt: firstStartAt,
      startMark: null,
      endMark: null,
    },
  ];

  starts.forEach((start, i) => {
    const nextStartAt = starts[i + 1]?.entry.at ?? Infinity;
    const end = marks.find(
      (m) => m.action === 'end' && m.entry.at > start.entry.at && m.entry.at <= nextStartAt,
    );
    boundaries.push({
      index: i + 1,
      label: `Session ${i + 1}`,
      fromAt: start.entry.at,
      toAt: end ? end.entry.at : nextStartAt,
      startMark: start.entry,
      endMark: end ? end.entry : null,
    });
  });

  return boundaries;
}

/**
 * The handful of items worth surfacing in a "previously on…" teaser:
 * discoveries and triggered encounters read as the most narratively
 * interesting, then shared clues and narration, then quiet encounter checks.
 */
export function recapHighlights(recap: Recap, limit = 3): RecapItem[] {
  return [
    ...recap.discoveries.items,
    ...recap.encounters.triggered,
    ...recap.shares.items,
    ...recap.narrations.items,
    ...recap.encounters.quiet,
  ].slice(0, limit);
}
