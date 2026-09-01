import { describe, expect, it } from 'vitest';
import { computeRecap, computeSessions, recapHighlights } from './recap.js';
import type { LogEntry } from '../domain.js';

function entry(
  at: number,
  kind: string,
  text: string,
  data: Record<string, unknown> = {},
): LogEntry {
  return { id: `e${at}`, at, kind, text, visibility: 'all', data };
}

describe('computeRecap', () => {
  it('groups entries by kind and counts them', () => {
    const log: LogEntry[] = [
      entry(1, 'discovery', 'Found the shrine clue'),
      entry(2, 'discovery', 'Found the bandit camp clue'),
      entry(3, 'check', 'Perception DC 12: Ash: 15 ✓'),
      entry(4, 'narration', 'The fog rolls in.'),
      entry(5, 'share', 'Ash shared with the party: a bandit camp lies north'),
      entry(6, 'encounter', 'Wolves attack!', { triggered: true }),
      entry(7, 'encounter', 'Nothing stirs.', { triggered: false }),
    ];
    const recap = computeRecap(log, { fromAt: -Infinity, toAt: Infinity });

    expect(recap.entryCount).toBe(7);
    expect(recap.discoveries.count).toBe(2);
    expect(recap.discoveries.items.map((i) => i.text)).toEqual([
      'Found the shrine clue',
      'Found the bandit camp clue',
    ]);
    expect(recap.checks.count).toBe(1);
    expect(recap.narrations.count).toBe(1);
    expect(recap.shares.count).toBe(1);
    expect(recap.encounters.triggered).toHaveLength(1);
    expect(recap.encounters.triggered[0]!.text).toBe('Wolves attack!');
    expect(recap.encounters.quiet).toHaveLength(1);
    expect(recap.encounters.quiet[0]!.text).toBe('Nothing stirs.');
  });

  it('restricts to the [fromAt, toAt) window', () => {
    const log: LogEntry[] = [
      entry(1, 'narration', 'before'),
      entry(10, 'narration', 'inside'),
      entry(20, 'narration', 'boundary'), // excluded: toAt is exclusive
      entry(30, 'narration', 'after'),
    ];
    const recap = computeRecap(log, { fromAt: 10, toAt: 20 });
    expect(recap.narrations.items.map((i) => i.text)).toEqual(['inside']);
  });

  it('sums advancedBy from time entries as the logged-time fallback', () => {
    const log: LogEntry[] = [
      entry(1, 'time', 'Time advances 1 hour', { advancedBy: 60 }),
      entry(2, 'time', 'Time advances 2 hours', { advancedBy: 120 }),
      entry(3, 'time', 'Clock set to Day 2', { minutes: 1440 }), // time.set: no advancedBy
    ];
    const recap = computeRecap(log, { fromAt: -Infinity, toAt: Infinity });
    expect(recap.timeLoggedMinutes).toBe(180);
    expect(recap.clockDeltaMinutes).toBeNull();
    expect(recap.timeAdvancedMinutes).toBe(180);
  });

  it('prefers the session-mark clock delta over the logged-time sum when both marks bound the window exactly', () => {
    const log: LogEntry[] = [
      entry(0, 'session', 'Session started — Day 1, 8:00 AM', { action: 'start', atMinutes: 480 }),
      entry(1, 'time', 'Time advances 1 hour', { advancedBy: 60 }),
      // travel time silently advances the clock without a 'time' entry — the
      // logged sum (60) undercounts the true 300-minute session.
      entry(2, 'discovery', 'Found something while travelling'),
      entry(3, 'session', 'Session ended — Day 1, 1:00 PM', { action: 'end', atMinutes: 780 }),
    ];
    const recap = computeRecap(log, { fromAt: 0, toAt: 3 });
    expect(recap.timeLoggedMinutes).toBe(60);
    expect(recap.clockDeltaMinutes).toBe(300);
    expect(recap.timeAdvancedMinutes).toBe(300);
  });

  it('reports wall-clock span and null bounds for an empty window', () => {
    const log: LogEntry[] = [entry(100, 'narration', 'a'), entry(250, 'narration', 'b')];
    const recap = computeRecap(log, { fromAt: -Infinity, toAt: Infinity });
    expect(recap.wallClockStart).toBe(100);
    expect(recap.wallClockEnd).toBe(250);
    expect(recap.wallClockMs).toBe(150);

    const empty = computeRecap(log, { fromAt: 1000, toAt: 2000 });
    expect(empty.wallClockStart).toBeNull();
    expect(empty.wallClockEnd).toBeNull();
    expect(empty.wallClockMs).toBe(0);
    expect(empty.entryCount).toBe(0);
  });
});

describe('computeSessions', () => {
  it('treats an unmarked log as one "before records began" session', () => {
    const log: LogEntry[] = [entry(1, 'narration', 'a'), entry(2, 'narration', 'b')];
    const sessions = computeSessions(log);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ index: 0, fromAt: -Infinity, toAt: Infinity });
  });

  it('splits on start/end marks, keeping pre-mark entries as Session 0', () => {
    const log: LogEntry[] = [
      entry(1, 'narration', 'before any session'),
      entry(5, 'session', 'Session started', { action: 'start', atMinutes: 480 }),
      entry(6, 'narration', 'during session 1'),
      entry(10, 'session', 'Session ended', { action: 'end', atMinutes: 600 }),
      entry(15, 'session', 'Session started', { action: 'start', atMinutes: 600 }),
      entry(16, 'narration', 'during session 2'),
    ];
    const sessions = computeSessions(log);
    expect(sessions.map((s) => s.label)).toEqual([
      'Session 0 — before records began',
      'Session 1',
      'Session 2',
    ]);

    const [s0, s1, s2] = sessions;
    expect(s0).toMatchObject({ fromAt: -Infinity, toAt: 5 });
    expect(s1).toMatchObject({ fromAt: 5, toAt: 10 });
    expect(s1!.endMark).not.toBeNull();
    expect(s2).toMatchObject({ fromAt: 15, toAt: Infinity });
    expect(s2!.endMark).toBeNull();

    const recap1 = computeRecap(log, { fromAt: s1!.fromAt, toAt: s1!.toAt });
    expect(recap1.narrations.items.map((i) => i.text)).toEqual(['during session 1']);

    const recap2 = computeRecap(log, { fromAt: s2!.fromAt, toAt: s2!.toAt });
    expect(recap2.narrations.items.map((i) => i.text)).toEqual(['during session 2']);
  });

  it('falls back to the next start mark when a session has no explicit end', () => {
    const log: LogEntry[] = [
      entry(1, 'session', 'Session started', { action: 'start', atMinutes: 0 }),
      entry(2, 'narration', 'session 1'),
      entry(3, 'session', 'Session started', { action: 'start', atMinutes: 100 }),
      entry(4, 'narration', 'session 2'),
    ];
    const sessions = computeSessions(log);
    expect(sessions).toHaveLength(3); // Session 0 (empty) + 1 + 2
    expect(sessions[1]).toMatchObject({ fromAt: 1, toAt: 3, endMark: null });
    expect(sessions[2]).toMatchObject({ fromAt: 3, toAt: Infinity, endMark: null });
  });
});

describe('recapHighlights', () => {
  it('prioritizes discoveries, then triggered encounters, shares, narrations, quiet encounters', () => {
    const log: LogEntry[] = [
      entry(1, 'narration', 'narration text'),
      entry(2, 'encounter', 'quiet encounter', { triggered: false }),
      entry(3, 'share', 'shared clue text'),
      entry(4, 'discovery', 'discovery one'),
      entry(5, 'discovery', 'discovery two'),
      entry(6, 'encounter', 'wolves attack', { triggered: true }),
    ];
    const recap = computeRecap(log, { fromAt: -Infinity, toAt: Infinity });
    const highlights = recapHighlights(recap, 3);
    expect(highlights.map((h) => h.text)).toEqual([
      'discovery one',
      'discovery two',
      'wolves attack',
    ]);
  });

  it('respects a custom limit and fills in from lower-priority sections when higher ones run out', () => {
    const log: LogEntry[] = [
      entry(1, 'discovery', 'only discovery'),
      entry(2, 'share', 'shared clue'),
      entry(3, 'narration', 'story beat'),
    ];
    const recap = computeRecap(log, { fromAt: -Infinity, toAt: Infinity });
    expect(recapHighlights(recap, 5).map((h) => h.text)).toEqual([
      'only discovery',
      'shared clue',
      'story beat',
    ]);
  });
});
