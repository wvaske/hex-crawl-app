import { describe, expect, it } from 'vitest';
import { formatCheck, rollCheck, seededRng } from './dice.js';
import { filterStateForViewer, logEntryVisibleToPlayer } from './filter.js';
import type { LogEntry } from '../domain.js';

/** An rng that hands out a fixed sequence of faces (1-based) for a d20/dN. */
function faces(seq: number[], sides = 20) {
  let i = 0;
  return () => {
    const f = seq[i++ % seq.length]!;
    return (f - 1) / sides + 1e-9;
  };
}

describe('rollCheck (issue #129)', () => {
  it('is a plain d20 + modifier by default', () => {
    const r = rollCheck({ modifier: 3 }, faces([14]));
    expect(r).toMatchObject({ roll: 14, modifier: 3, total: 17 });
    expect(r.detail).toEqual({ rolls: [14], advantage: 'none', extras: [] });
    expect(formatCheck(r)).toBe('d20 14+3');
  });

  it('advantage keeps the high die, disadvantage the low', () => {
    const adv = rollCheck({ modifier: 0, advantage: 'advantage' }, faces([4, 17]));
    expect(adv.roll).toBe(17);
    expect(adv.detail.rolls).toEqual([4, 17]);
    expect(formatCheck(adv)).toBe('d20 17 (adv, dropped 4)+0');
    const dis = rollCheck({ modifier: 0, advantage: 'disadvantage' }, faces([4, 17]));
    expect(dis.roll).toBe(4);
    expect(formatCheck(dis)).toBe('d20 4 (dis, dropped 17)+0');
  });

  it('adds extra dice and flat bonuses with their signs', () => {
    // d20 → 10; then the d4 rolls... the rng is shared, so seed a sequence of
    // "fractions": 10/20, then for the d4 the same fraction 0.45 → face 2.
    const rng = faces([10]);
    const r = rollCheck(
      {
        modifier: 2,
        extras: [
          { sides: 4, amount: 1, sign: 1, label: 'Guidance' },
          { sides: 0, amount: 2, sign: -1, label: 'Bane' },
        ],
      },
      rng,
    );
    // face 10 on a d20 is fraction 0.45 → on a d4 that is face 2.
    expect(r.detail.extras[0]).toMatchObject({ rolls: [2], total: 2 });
    expect(r.detail.extras[1]).toMatchObject({ rolls: [], total: -2 });
    expect(r.total).toBe(10 + 2 + 2 - 2);
    expect(formatCheck(r)).toBe('d20 10+2 +1d4[2] Guidance −2 Bane');
  });

  it('is deterministic under the seeded rng', () => {
    const a = rollCheck({ modifier: 1, advantage: 'advantage', extras: [{ sides: 6, amount: 2, sign: 1, label: '' }] }, seededRng(3));
    const b = rollCheck({ modifier: 1, advantage: 'advantage', extras: [{ sides: 6, amount: 2, sign: 1, label: '' }] }, seededRng(3));
    expect(a).toEqual(b);
    expect(a.detail.extras[0]!.rolls).toHaveLength(2);
  });
});

describe('roll visibility (issue #129)', () => {
  const entry = (visibility: string): LogEntry => ({
    id: 'e',
    at: 1,
    kind: 'check',
    text: 'Perception: Bob 17',
    visibility,
    data: { results: [{ characterId: 'bob' }] },
  });
  const alice = { seatId: 'sa', role: 'player' as const, characterId: 'alice' };
  const bob = { seatId: 'sb', role: 'player' as const, characterId: 'bob' };

  it("'own' shows a table roll only to the character who rolled", () => {
    expect(logEntryVisibleToPlayer(entry('all'), bob, 'own')).toBe(true);
    expect(logEntryVisibleToPlayer(entry('all'), alice, 'own')).toBe(false);
  });

  it("'all' shows every table roll to everyone; a secret roll stays with its seat", () => {
    expect(logEntryVisibleToPlayer(entry('all'), alice, 'all')).toBe(true);
    expect(logEntryVisibleToPlayer(entry('sb'), alice, 'all')).toBe(false);
    expect(logEntryVisibleToPlayer(entry('sb'), bob, 'all')).toBe(true);
  });

  it('the state filter reads the setting off the campaign', () => {
    const base = {
      campaign: {
        id: 'c',
        name: 'c',
        activeMapId: null,
        settings: { rollVisibility: 'all' as const },
        time: {},
      },
      seats: [],
      characters: [],
      maps: [],
      mapState: null,
      discoveries: [],
      trailDiscoveries: [],
      senses: [],
      pendingReveals: [],
      encounterTables: [],
      log: [entry('all')],
      undoHistory: [],
    };
    // Structural: only the fields the filter touches matter here.
    const view = filterStateForViewer(base as never, alice);
    expect(view.log).toHaveLength(1);
    const own = filterStateForViewer(
      { ...base, campaign: { ...base.campaign, settings: { rollVisibility: 'own' } } } as never,
      alice,
    );
    expect(own.log).toHaveLength(0);
  });
});
