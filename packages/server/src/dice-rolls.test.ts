import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Dice with trimmings (issue #129): extra dice and flat bonuses, advantage,
 * "proficient only" group rolls, re-rolls that never count for clues, secret
 * rolls, table-wide roll visibility, and every roll tagged with the hex the
 * character stood on.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `d${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(11),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `d${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(11),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Dice', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function member(name: string, proficiencies: string[], q = 0): { charId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name,
      color: '#00aa00',
      glyph: '',
      speed: 30,
      skills: { perception: 3, survival: 1 },
      proficiencies,
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.values()].find((c) => c.name === name)!.id;
  const seat = runtime.createSeat('player', `${name}'s player`);
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = charId;
  dm({
    kind: 'token.create',
    mapId,
    q,
    r: 0,
    tokenKind: 'pc',
    characterId: charId,
    label: '',
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  return { charId, seat };
}

function lastCheck() {
  return [...runtime.log].reverse().find((e) => e.kind === 'check')!;
}

function view(seat: SeatRecord) {
  return filterStateForViewer(runtime.buildFullState(), {
    seatId: seat.id,
    role: 'player',
    characterId: seat.characterId,
  });
}

describe('extras, advantage, proficiency', () => {
  it('adds extra dice and flat penalties to the total and writes the arithmetic down', () => {
    const { seat } = member('Ash', ['perception']);
    asSeat(seat, {
      kind: 'check.roll',
      skill: 'perception',
      dc: null,
      characterIds: [],
      mapId: null,
      hex: null,
      extras: [
        { sides: 4, amount: 1, sign: 1, label: 'Guidance' },
        { sides: 0, amount: 2, sign: -1, label: 'Bane' },
      ],
      advantage: 'advantage',
    } as never);
    const entry = lastCheck();
    const r = (entry.data.results as { total: number; roll: number; modifier: number; detail: { rolls: number[]; extras: { total: number }[] } }[])[0]!;
    expect(r.detail.rolls).toHaveLength(2);
    expect(r.roll).toBe(Math.max(...r.detail.rolls));
    expect(r.total).toBe(r.roll + r.modifier + r.detail.extras[0]!.total - 2);
    expect(entry.text).toMatch(/\[advantage, \+1d4 Guidance, −2 Bane\]/);
    expect(entry.text).toMatch(/Guidance −2 Bane/);
  });

  it("'proficient only' rolls for the trained characters and refuses an empty roster", () => {
    member('Ash', ['perception']);
    member('Bramble', [], 1);
    dm({ kind: 'check.roll', skill: 'perception', dc: 10, characterIds: [], mapId: null, hex: null, proficientOnly: true } as never);
    const results = lastCheck().data.results as { name: string }[];
    expect(results.map((r) => r.name)).toEqual(['Ash']);
    expect(() =>
      dm({ kind: 'check.roll', skill: 'arcana', dc: 10, characterIds: [], mapId: null, hex: null, proficientOnly: true } as never),
    ).toThrow(/proficient/);
  });

  it('a D&D Beyond-style proficiency list survives the database', () => {
    const { charId } = member('Ash', ['perception', 'sleight of hand']);
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    expect(reloaded.characters.get(charId)!.proficiencies).toEqual(['perception', 'sleight of hand']);
  });
});

describe('re-rolls and hex history', () => {
  it('a second search roll is dice only: no attempt, no pending reveal, marked as a re-roll', () => {
    const mapId = runtime.campaign.activeMapId!;
    const { seat, charId } = member('Ash', []);
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 0, r: 0, type: 'ruin', title: 'Cairn', dmNotes: '', glyph: '',
        clues: [{ id: null, text: 'Hidden niche', gate: { kind: 'skill', skill: 'perception', dc: 1, maxDistance: 0, mode: 'active' }, sortOrder: 0 }],
      },
    } as never);
    asSeat(seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 0, r: 0 } } as never);
    expect(runtime.pendingReveals.size).toBe(1);
    const rt = runtime.requireMap(mapId);
    const first = [...rt.searchAttempts.values()][0]!;
    expect(first.detail).not.toBeNull();
    // Withhold, then roll again: the second roll must not re-queue the clue.
    dm({ kind: 'search.resolve', pendingIds: [...runtime.pendingReveals.keys()], approve: false } as never);
    asSeat(seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 0, r: 0 } } as never);
    expect(runtime.pendingReveals.size).toBe(0);
    expect(rt.searchAttempts.size).toBe(1);
    expect([...rt.searchAttempts.values()][0]!.id).toBe(first.id);
    const entry = lastCheck();
    expect(entry.text).toMatch(/re-roll/);
    expect((entry.data.results as { counts: boolean }[])[0]!.counts).toBe(false);
    // The DM clearing the attempt makes the next roll count again.
    dm({ kind: 'search.clearAttempt', attemptId: first.id } as never);
    asSeat(seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 0, r: 0 } } as never);
    expect(runtime.pendingReveals.size).toBe(1);
    expect([...runtime.pendingReveals.values()][0]!.characterId).toBe(charId);
  });

  it('a sheet roll is tagged with the hex the character stands on', () => {
    const mapId = runtime.campaign.activeMapId!;
    const { seat } = member('Ash', [], 3);
    asSeat(seat, { kind: 'check.roll', skill: 'survival', dc: null, characterIds: [], mapId: null, hex: null } as never);
    const entry = lastCheck();
    expect(entry.data).toMatchObject({ hex: { q: 3, r: 0 }, mapId, search: false });
  });
});

describe('who sees a roll', () => {
  it("'own' keeps rolls private to the roller; 'all' shows the table; secret rolls stay with the DM", () => {
    const ash = member('Ash', []);
    const bramble = member('Bramble', [], 1);
    asSeat(ash.seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId: null, hex: null } as never);
    expect(view(ash.seat).log.filter((e) => e.kind === 'check')).toHaveLength(1);
    expect(view(bramble.seat).log.filter((e) => e.kind === 'check')).toHaveLength(0);

    dm({ kind: 'campaign.update', settings: { rollVisibility: 'all' } } as never);
    expect(view(bramble.seat).log.filter((e) => e.kind === 'check')).toHaveLength(1);

    asSeat(ash.seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId: null, hex: null, secret: true } as never);
    expect(lastCheck().visibility).toBe(ash.seat.id);
    expect(view(ash.seat).log.filter((e) => e.kind === 'check')).toHaveLength(2);
    expect(view(bramble.seat).log.filter((e) => e.kind === 'check')).toHaveLength(1);
  });
});
