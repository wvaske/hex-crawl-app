import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng, hexKey } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { rollEncounter } from './engine/encounters.js';

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Test Campaign', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  dm({ kind: 'map.create', name: 'Region', orientation: 'flat', hexSize: 48 } as never);
});

function activeMapId(): string {
  return runtime.campaign.activeMapId!;
}

describe('campaign + seats', () => {
  it('creates campaign with dm seat, default map, and our test map', () => {
    expect(runtime.campaign.name).toBe('Test Campaign');
    expect(dmSeat.role).toBe('dm');
    // One default "Overland" map plus the map created in beforeEach.
    expect(runtime.maps.size).toBe(2);
    expect(runtime.campaign.activeMapId).not.toBeNull();
  });

  it('players claim characters exclusively', () => {
    dm({
      kind: 'character.create',
      character: { name: 'Ash', color: '#ff0000', glyph: '🔥', speed: 30, skills: {} },
    } as never);
    const charId = [...runtime.characters.keys()][0]!;
    const p1 = runtime.createSeat('player', 'Alice');
    const p2 = runtime.createSeat('player', 'Bob');
    asSeat(p1, { kind: 'seat.claimCharacter', characterId: charId } as never);
    expect(runtime.seats.get(p1.id)!.characterId).toBe(charId);
    expect(() =>
      asSeat(p2, { kind: 'seat.claimCharacter', characterId: charId } as never),
    ).toThrow(/already claimed/);
    expect(runtime.seats.get(p2.id)!.characterId).toBeNull();
  });
});

describe('authorization', () => {
  it('players cannot paint, fog, or move others', () => {
    const player = runtime.createSeat('player', 'Mallory');
    const mapId = activeMapId();
    expect(() =>
      asSeat(player, { kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }], terrain: 'forest' } as never),
    ).toThrow(/DM/);
    expect(() =>
      asSeat(player, { kind: 'fog.set', mapId, cells: [{ q: 0, r: 0 }], state: 'visible' } as never),
    ).toThrow(/DM/);
    dm({
      kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'npc', characterId: null,
      label: 'Ogre', color: '#aa0000', glyph: '', playerVisible: true,
    } as never);
    const tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
    expect(() => asSeat(player, { kind: 'token.move', tokenId, q: 1, r: 0 } as never)).toThrow(
      /own character/,
    );
  });
});

describe('terrain, fog, persistence', () => {
  it('paints terrain and persists across reload', () => {
    const mapId = activeMapId();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], terrain: 'swamp' } as never);
    // Simulate server restart: new store over same db.
    const db = (store as unknown as { db: unknown }).db;
    const store2 = new Store(db as never);
    const reloaded = store2.getCampaign(runtime.id)!;
    expect(reloaded.requireMap(mapId).hexes.get(hexKey(0, 0))).toBe('swamp');
    expect(reloaded.requireMap(mapId).hexes.get(hexKey(1, 0))).toBe('swamp');
  });
});

function setupPartyWithScout(): { mapId: string; charId: string; tokenId: string; playerSeat: SeatRecord } {
  const mapId = activeMapId();
  dm({
    kind: 'character.create',
    character: { name: 'Scout', color: '#00aa00', glyph: '🏹', speed: 30, skills: { perception: 4, survival: 2 } },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const playerSeat = runtime.createSeat('player', 'Alice');
  asSeat(playerSeat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  playerSeat.characterId = runtime.seats.get(playerSeat.id)!.characterId;
  dm({
    kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId: charId,
    label: '', color: '#00aa00', glyph: '', playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
  return { mapId, charId, tokenId, playerSeat };
}

describe('fog auto-reveal', () => {
  it('reveals sight radius around pc tokens and decays when configured', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    const rt = runtime.requireMap(mapId);
    // default sightRadius 1: center + 6 neighbors visible
    expect(rt.fog.get(hexKey(0, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(1, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(2, 0))).toBeUndefined();

    dm({ kind: 'map.update', mapId, patch: { fogDecay: true } } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(rt.fog.get(hexKey(3, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(0, 0))).toBe('explored');

    // player snapshot: explored hexes visible but npc-free; hidden hexes absent
    const state = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: playerSeat.characterId,
    });
    expect(state.mapState!.fog.every((f) => f.state !== 'hidden')).toBe(true);
  });
});

describe('knowledge engine', () => {
  it('passive skill gates open by distance and dc; discoveries persist and dedupe', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 5, r: 0, type: 'lair', title: 'Dragon Lair', dmNotes: 'big', glyph: '',
        clues: [
          { id: null, text: 'Dead vegetation spreads', gate: { kind: 'skill', skill: 'survival', dc: 12, maxDistance: 3, mode: 'passive' }, sortOrder: 0 },
          { id: null, text: 'Acid-scarred bones', gate: { kind: 'skill', skill: 'perception', dc: 16, maxDistance: 1, mode: 'passive' }, sortOrder: 1 },
          { id: null, text: 'The lair itself', gate: { kind: 'auto' }, sortOrder: 2 },
        ],
      },
    } as never);
    // At distance 5: nothing (survival gate needs <=3)
    expect(runtime.discoveries.size).toBe(0);
    // Move to distance 3: survival passive 12 >= 12 → discovery
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    const disc = [...runtime.discoveries.values()][0]!;
    expect(disc.characterId).toBe(charId);
    expect(disc.how.kind).toBe('passive');
    // Move adjacent: perception gate needs passive 16, scout has 14 → no new
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    // Enter the hex: auto clue fires; still no perception clue
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 5, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(2);
    // Re-entering doesn't duplicate
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 5, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(2);

    // Player view: content shows only discovered clues, no dmNotes
    const state = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    const view = state.mapState!.contents[0] as { discoveredClues: unknown[]; title: string };
    expect(view.title).toBe('Dragon Lair');
    expect(view.discoveredClues).toHaveLength(2);
  });

  it('manual clue reveal creates discoveries for all characters', () => {
    const { mapId, charId } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 9, r: 0, type: 'lore', title: 'Old Song', dmNotes: '', glyph: '',
        clues: [{ id: null, text: 'A verse about the fallen king', gate: { kind: 'manual' }, sortOrder: 0 }],
      },
    } as never);
    const content = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Old Song')!;
    dm({ kind: 'clue.reveal', clueId: content.clues[0]!.id, characterIds: [] } as never);
    expect(runtime.hasDiscovery(content.clues[0]!.id, charId)).toBe(true);
  });
});

describe('checks and encounters', () => {
  it('check.roll logs dm-only results', () => {
    setupPartyWithScout();
    dm({ kind: 'check.roll', skill: 'perception', dc: 15, characterIds: [] } as never);
    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.kind).toBe('check');
    expect(entry.visibility).toBe('dm');
    const results = entry.data.results as Array<{ total: number; roll: number }>;
    expect(results).toHaveLength(1);
    expect(results[0]!.total).toBe(results[0]!.roll + 4);
  });

  it('encounter engine selects table by terrain and resolves entries', () => {
    const { mapId } = setupPartyWithScout();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }], terrain: 'forest' } as never);
    dm({
      kind: 'encounterTable.upsert',
      table: {
        id: null, name: 'Forest encounters', terrains: ['forest'], die: '1d6',
        entries: [
          { min: 1, max: 3, text: 'Wolves', quantity: '2d4' },
          { min: 4, max: 6, text: 'Bandits', quantity: '' },
        ],
      },
    } as never);
    const rng = seededRng(99);
    const result = rollEncounter(
      runtime,
      { mapId, q: 0, r: 0, tableId: null, skipCheck: true },
      rng,
    );
    expect(result.triggered).toBe(true);
    expect(result.terrain).toBe('forest');
    expect(result.table!.name).toBe('Forest encounters');
    expect(['Wolves', 'Bandits']).toContain(result.entryText);
    if (result.entryText === 'Wolves') expect(result.quantityRoll).not.toBeNull();

    // trigger die respected
    const low = rollEncounter(runtime, { mapId, q: 0, r: 0, tableId: null, skipCheck: false }, () => 0);
    expect(low.triggered).toBe(false);
  });
});

describe('narration', () => {
  it('narrate to all is visible to players; dm log entries are not', () => {
    const { playerSeat } = setupPartyWithScout();
    dm({ kind: 'narrate', text: 'A cold wind rises.', seatIds: [] } as never);
    const state = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: playerSeat.characterId,
    });
    const texts = state.log.map((l) => l.text);
    expect(texts).toContain('A cold wind rises.');
    expect(state.log.every((l) => l.visibility !== 'dm')).toBe(true);
  });
});
