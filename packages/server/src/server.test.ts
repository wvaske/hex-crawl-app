import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filterStateForViewer, seededRng, hexKey } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { rollEncounter } from './engine/encounters.js';
import { createApp } from './http/app.js';
import { exportCampaign, importCampaign } from './http/portability.js';

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
    expect(rt.fog.get(hexKey(3, 0))).toBe('explored'); // standing hex is walked
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

describe('seat recovery', () => {
  it('DM can release a character claim and delete a stale seat; players cannot', () => {
    const { charId, playerSeat } = setupPartyWithScout();
    // Simulate a lost cookie: a second seat joins and cannot claim the character.
    const newSeat = runtime.createSeat('player', 'Alice (new phone)');
    expect(() =>
      asSeat(newSeat, { kind: 'seat.claimCharacter', characterId: charId } as never),
    ).toThrow(/already claimed/);
    // Player seats cannot release others or delete seats.
    expect(() =>
      asSeat(newSeat, { kind: 'seat.releaseCharacter', seatId: playerSeat.id } as never),
    ).toThrow(/DM/);
    expect(() =>
      asSeat(newSeat, { kind: 'seat.delete', seatId: playerSeat.id } as never),
    ).toThrow(/DM/);
    // DM releases the old seat's claim, deletes it, and the new seat claims.
    dm({ kind: 'seat.releaseCharacter', seatId: playerSeat.id } as never);
    dm({ kind: 'seat.delete', seatId: playerSeat.id } as never);
    expect(runtime.seats.has(playerSeat.id)).toBe(false);
    asSeat(newSeat, { kind: 'seat.claimCharacter', characterId: charId } as never);
    expect(runtime.seats.get(newSeat.id)!.characterId).toBe(charId);
    // DM cannot delete their own seat.
    expect(() => dm({ kind: 'seat.delete', seatId: dmSeat.id } as never)).toThrow(/own seat/);
  });
});

describe('move approval + explored trail', () => {
  it('trail: the whole walked path, destination included, becomes explored', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    const rt = runtime.requireMap(mapId);
    expect(rt.fog.get(hexKey(0, 0))).toBe('explored'); // origin traversed
    expect(rt.fog.get(hexKey(2, 0))).toBe('explored'); // path traversed
    expect(rt.fog.get(hexKey(4, 0))).toBe('explored'); // standing here — walked too
    expect(rt.fog.get(hexKey(5, 0))).toBe('visible'); // sight ring stays visible
  });

  it('approval mode: player moves become requests the DM resolves', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    dm({ kind: 'map.update', mapId, patch: { moveApproval: true } } as never);
    // Direct move now rejected for players…
    expect(() => asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never)).toThrow(
      /approval|request/i,
    );
    // …request instead.
    asSeat(playerSeat, { kind: 'move.request', tokenId, q: 3, r: 0 } as never);
    const rt = runtime.requireMap(mapId);
    expect(rt.pendingMoves.get(tokenId)).toMatchObject({ toQ: 3, toR: 0 });
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 0, r: 0 }); // not moved yet

    // Deny: token stays, pending cleared.
    dm({ kind: 'move.resolve', tokenId, approve: false } as never);
    expect(rt.pendingMoves.has(tokenId)).toBe(false);
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 0, r: 0 });

    // Approve: move executes with trail + sight.
    asSeat(playerSeat, { kind: 'move.request', tokenId, q: 3, r: 0 } as never);
    dm({ kind: 'move.resolve', tokenId, approve: true } as never);
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 3, r: 0 });
    expect(rt.fog.get(hexKey(1, 0))).toBe('explored');
    expect(rt.fog.get(hexKey(3, 0))).toBe('explored');
    // Players cannot resolve.
    asSeat(playerSeat, { kind: 'move.request', tokenId, q: 5, r: 0 } as never);
    expect(() => asSeat(playerSeat, { kind: 'move.resolve', tokenId, approve: true } as never)).toThrow(/DM/);
    // DM's own direct moves bypass approval.
    dm({ kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 4, r: 0 });
  });
});

describe('undo', () => {
  it('one undo reverts an entire bulk fog change (the apply-to-all disaster case)', () => {
    const mapId = activeMapId();
    // Months of hand-tuning: a mixed fog landscape.
    dm({ kind: 'fog.set', mapId, cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], state: 'visible' } as never);
    // New undo entry (outside the merge window).
    runtime.undoStack[runtime.undoStack.length - 1]!.at -= 10000;
    dm({ kind: 'fog.set', mapId, cells: [{ q: 2, r: 0 }], state: 'explored' } as never);
    runtime.undoStack[runtime.undoStack.length - 1]!.at -= 10000;
    const rt = runtime.requireMap(mapId);
    expect(rt.fog.get(hexKey(0, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(2, 0))).toBe('explored');

    // Disaster: set EVERYTHING visible in one bulk command.
    const all = [];
    for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) all.push({ q, r });
    dm({ kind: 'fog.set', mapId, cells: all, state: 'visible' } as never);
    expect(rt.fog.get(hexKey(2, 0))).toBe('visible');
    expect(rt.fog.size).toBeGreaterThan(20);

    // One undo restores the hand-tuned landscape exactly.
    dm({ kind: 'undo' } as never);
    expect(rt.fog.get(hexKey(0, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(1, 0))).toBe('visible');
    expect(rt.fog.get(hexKey(2, 0))).toBe('explored');
    expect(rt.fog.get(hexKey(3, 0))).toBeUndefined(); // back to hidden
    expect(rt.fog.size).toBe(3);
  });

  it('brush-stroke chunks merge into one undo entry; terrain restores priors', () => {
    const mapId = activeMapId();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }], terrain: 'forest' } as never);
    runtime.undoStack[runtime.undoStack.length - 1]!.at -= 10000;
    const before = runtime.undoStack.length;
    // Two chunks of the same stroke, close in time -> one entry.
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], terrain: 'swamp' } as never);
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 2, r: 0 }], terrain: 'swamp' } as never);
    expect(runtime.undoStack.length).toBe(before + 1);
    dm({ kind: 'undo' } as never);
    const rt = runtime.requireMap(mapId);
    expect(rt.hexes.get(hexKey(0, 0))).toBe('forest'); // earliest prior wins
    expect(rt.hexes.get(hexKey(1, 0))).toBeUndefined();
    expect(rt.hexes.get(hexKey(2, 0))).toBeUndefined();
  });

  it('token moves, content deletes, and empty-stack behave', () => {
    const { mapId, tokenId } = setupPartyWithScout();
    const token = runtime.findToken(tokenId)!;
    const home = { q: token.q, r: token.r };
    dm({ kind: 'token.move', tokenId, q: 3, r: -1 } as never);
    dm({ kind: 'undo' } as never);
    expect(runtime.findToken(tokenId)).toMatchObject(home);

    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 8, r: 0, type: 'ruin', title: 'Doomed Fort', dmNotes: 'x', glyph: '',
        clues: [{ id: null, text: 'rubble', gate: { kind: 'auto' }, sortOrder: 0 }],
      },
    } as never);
    const content = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Doomed Fort')!;
    dm({ kind: 'content.delete', contentId: content.id } as never);
    expect(runtime.requireMap(mapId).contents.has(content.id)).toBe(false);
    dm({ kind: 'undo' } as never);
    expect(runtime.requireMap(mapId).contents.get(content.id)?.title).toBe('Doomed Fort');

    runtime.undoStack.length = 0;
    expect(() => dm({ kind: 'undo' } as never)).toThrow(/Nothing to undo/);
    const player = runtime.createSeat('player', 'Nope');
    expect(() => asSeat(player, { kind: 'undo' } as never)).toThrow(/DM/);
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

describe('party movement', () => {
  it('moving one party member shifts the whole party by the same offset', () => {
    const mapId = activeMapId();
    dm({ kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId: null, label: 'A', color: '#e05555', glyph: '', playerVisible: true } as never);
    dm({ kind: 'token.create', mapId, q: 1, r: 0, tokenKind: 'pc', characterId: null, label: 'B', color: '#e05555', glyph: '', playerVisible: true } as never);
    dm({ kind: 'token.create', mapId, q: 5, r: 5, tokenKind: 'pc', characterId: null, label: 'Solo', color: '#e05555', glyph: '', playerVisible: true } as never);
    const tokens = [...runtime.requireMap(mapId).tokens.values()];
    const a = tokens.find((t) => t.label === 'A')!;
    const b = tokens.find((t) => t.label === 'B')!;
    const solo = tokens.find((t) => t.label === 'Solo')!;
    dm({ kind: 'token.update', tokenId: a.id, patch: { partyId: 'party' } } as never);
    dm({ kind: 'token.update', tokenId: b.id, patch: { partyId: 'party' } } as never);

    dm({ kind: 'token.move', tokenId: a.id, q: 3, r: -1, teleport: false } as never);
    const after = runtime.requireMap(mapId);
    expect([after.tokens.get(a.id)!.q, after.tokens.get(a.id)!.r]).toEqual([3, -1]);
    expect([after.tokens.get(b.id)!.q, after.tokens.get(b.id)!.r]).toEqual([4, -1]);
    expect([after.tokens.get(solo.id)!.q, after.tokens.get(solo.id)!.r]).toEqual([5, 5]);

    // Undo restores every member.
    dm({ kind: 'undo' } as never);
    expect([after.tokens.get(a.id)!.q, after.tokens.get(a.id)!.r]).toEqual([0, 0]);
    expect([after.tokens.get(b.id)!.q, after.tokens.get(b.id)!.r]).toEqual([1, 0]);
  });

  it('a player moving their own token brings the party along', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    dm({ kind: 'token.create', mapId, q: 0, r: 1, tokenKind: 'pc', characterId: null, label: 'Friend', color: '#e05555', glyph: '', playerVisible: true } as never);
    const friend = [...runtime.requireMap(mapId).tokens.values()].find((t) => t.label === 'Friend')!;
    dm({ kind: 'token.update', tokenId, patch: { partyId: 'party' } } as never);
    dm({ kind: 'token.update', tokenId: friend.id, patch: { partyId: 'party' } } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    const rt = runtime.requireMap(mapId);
    expect([rt.tokens.get(tokenId)!.q, rt.tokens.get(tokenId)!.r]).toEqual([2, 0]);
    expect([rt.tokens.get(friend.id)!.q, rt.tokens.get(friend.id)!.r]).toEqual([2, 1]);
  });
});

describe('move undo restores fog', () => {
  it('undoing a movement reverts the explored trail and auto-revealed cells', () => {
    const { mapId, tokenId } = setupPartyWithScout();
    const rt = runtime.requireMap(mapId);
    const before = new Map(rt.fog);

    dm({ kind: 'token.move', tokenId, q: 4, r: 0, teleport: false } as never);
    expect(rt.fog.get(hexKey(2, 0))).toBe('explored');
    expect(rt.fog.get(hexKey(4, 0))).toBe('explored');

    dm({ kind: 'undo' } as never);
    expect(rt.tokens.get(tokenId)!.q).toBe(0);
    expect(Object.fromEntries(rt.fog)).toEqual(Object.fromEntries(before));
  });
});

describe('directional clues', () => {
  it('stores the sensed bearing on discovery and appends it to the player view', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 4, r: -2, type: 'camp', title: 'Bandit Camp', dmNotes: '', glyph: '',
        clues: [
          {
            id: null,
            text: 'You smell woodsmoke',
            gate: { kind: 'skill', skill: 'survival', dc: 10, maxDistance: 6, mode: 'passive' },
            sortOrder: 0,
            indicatesDirection: true,
          },
        ],
      },
    } as never);
    // Scout starts at (0,0); survival passive 12 >= 10 within 6 → immediate discovery.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 0, r: 0 } as never);
    const disc = [...runtime.discoveries.values()][0]!;
    expect(disc.direction).toBe('east');

    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    // Sensed from afar: the pin is NOT revealed — the clue lives in senses.
    expect(view.mapState!.contents.find((c) => c.title === 'Bandit Camp')).toBeUndefined();
    const sense = view.senses.find((s) => s.text === 'You smell woodsmoke')!;
    expect(sense.direction).toBe('east');
    expect(sense.inRange).toBe(true);
    expect(sense.located).toBe(false);
    expect(sense.contentTitle).toBeNull();
    // Triangulation cells: only hexes the character has actually walked
    // (explored trail + current hex) — never merely-visible cells.
    const walked = new Set(
      view.mapState!.fog.filter((f) => f.state === 'explored').map((f) => `${f.q},${f.r}`),
    );
    walked.add('0,0'); // where the character currently stands
    expect(sense.observableFrom.length).toBeGreaterThan(0);
    for (const c of sense.observableFrom) expect(walked.has(`${c.q},${c.r}`)).toBe(true);
    // The sight-radius 'visible' ring around the token must NOT be included.
    expect(sense.observableFrom.some((c) => c.q === 1 && c.r === 0)).toBe(false);

    // Walking onto the hex locates the source and reveals the pin.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 4, r: -2 } as never);
    const after = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(after.mapState!.contents.find((c) => c.title === 'Bandit Camp')).toBeDefined();
    expect(after.senses.find((s) => s.text === 'You smell woodsmoke')!.located).toBe(true);
  });

  it('leaves direction null when the flag is off', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 4, r: -2, type: 'camp', title: 'Quiet Camp', dmNotes: '', glyph: '',
        clues: [
          {
            id: null,
            text: 'Something is near',
            gate: { kind: 'skill', skill: 'survival', dc: 10, maxDistance: 6, mode: 'passive' },
            sortOrder: 0,
          },
        ],
      },
    } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 0, r: 0 } as never);
    const disc = [...runtime.discoveries.values()][0]!;
    expect(disc.direction).toBeNull();
  });
});

describe('settlement clue generation', () => {
  it('adds scaled sensory clues to settlements, idempotently', () => {
    const mapId = activeMapId();
    dm({
      kind: 'content.upsert',
      content: { id: null, mapId, q: 3, r: 0, type: 'settlement', title: 'Bigtown', dmNotes: '', glyph: '', scaleVisibility: 2, clues: [] },
    } as never);
    dm({
      kind: 'content.upsert',
      content: { id: null, mapId, q: 9, r: 0, type: 'settlement', title: 'Smallville', dmNotes: '', glyph: '', scaleVisibility: 0, clues: [] },
    } as never);
    dm({
      kind: 'content.upsert',
      content: { id: null, mapId, q: 6, r: 6, type: 'ruin', title: 'Old Fort', dmNotes: '', glyph: '', clues: [] },
    } as never);

    dm({ kind: 'clues.generateSettlements', mapId } as never);
    const rt = runtime.requireMap(mapId);
    const byTitle = (t: string) => [...rt.contents.values()].find((c) => c.title === t)!;
    expect(byTitle('Bigtown').clues).toHaveLength(3);
    expect(byTitle('Smallville').clues).toHaveLength(3);
    expect(byTitle('Old Fort').clues).toHaveLength(0);
    // City clues reach farther than village clues.
    const cityMax = Math.max(...byTitle('Bigtown').clues.map((c) => (c.gate.kind === 'skill' ? c.gate.maxDistance : 0)));
    const villageMax = Math.max(...byTitle('Smallville').clues.map((c) => (c.gate.kind === 'skill' ? c.gate.maxDistance : 0)));
    expect(cityMax).toBeGreaterThan(villageMax);
    expect(byTitle('Bigtown').clues.every((c) => c.indicatesDirection)).toBe(true);

    // Re-running adds nothing.
    dm({ kind: 'clues.generateSettlements', mapId } as never);
    expect(byTitle('Bigtown').clues).toHaveLength(3);

    // Undo strips the generated clues.
    dm({ kind: 'undo' } as never);
    // (second run touched nothing, so this undoes the log entry-less no-op? — the
    // no-op run pushes no undo entry; this pops the first generation)
    expect(byTitle('Bigtown').clues).toHaveLength(0);
    expect(byTitle('Smallville').clues).toHaveLength(0);
  });
});

describe('hex-targeted skill checks', () => {
  it('a player search rolls against clue gates and reveals matching clues', () => {
    const { mapId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 1, r: 0, type: 'cache', title: 'Hidden Cache', dmNotes: '', glyph: '',
        clues: [
          { id: null, text: 'Fresh-turned earth under a flat stone', gate: { kind: 'skill', skill: 'survival', dc: 2, maxDistance: 1, mode: 'active' }, sortOrder: 0 },
          { id: null, text: 'Impossible to notice', gate: { kind: 'skill', skill: 'survival', dc: 39, maxDistance: 1, mode: 'active' }, sortOrder: 1 },
          { id: null, text: 'Wrong sense entirely', gate: { kind: 'skill', skill: 'perception', dc: 2, maxDistance: 1, mode: 'active' }, sortOrder: 2 },
        ],
      },
    } as never);
    // Active gates never open passively.
    expect(runtime.discoveries.size).toBe(0);

    asSeat(playerSeat, { kind: 'check.roll', skill: 'survival', dc: null, characterIds: [], mapId, hex: { q: 1, r: 0 } } as never);
    expect(runtime.discoveries.size).toBe(1);
    const disc = [...runtime.discoveries.values()][0]!;
    expect(disc.how.kind).toBe('roll');
    expect(disc.locates).toBe(false); // searched from one hex away

    // Re-rolling doesn't duplicate the discovery.
    asSeat(playerSeat, { kind: 'check.roll', skill: 'survival', dc: null, characterIds: [], mapId, hex: { q: 1, r: 0 } } as never);
    expect(runtime.discoveries.size).toBe(1);
  });
});

describe('encounter table enable/disable', () => {
  it('terrain matching skips disabled tables; explicit tableId still rolls', () => {
    const mapId = activeMapId();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }], terrain: 'hills' } as never);
    dm({
      kind: 'encounterTable.upsert',
      table: { id: 'tblA', name: 'Hills A', terrains: ['hills'], die: '1d4', entries: [{ min: 1, max: 4, text: 'wolves', quantity: '' }], enabled: true },
    } as never);
    const pick = () => rollEncounter(runtime, { mapId, q: 0, r: 0, tableId: null, skipCheck: true }, seededRng(3));
    expect(pick().table?.id).toBe('tblA');

    dm({
      kind: 'encounterTable.upsert',
      table: { id: 'tblA', name: 'Hills A', terrains: ['hills'], die: '1d4', entries: [{ min: 1, max: 4, text: 'wolves', quantity: '' }], enabled: false },
    } as never);
    expect(pick().table).toBeNull();
    // Explicit choice overrides the disable.
    const forced = rollEncounter(runtime, { mapId, q: 0, r: 0, tableId: 'tblA', skipCheck: true }, seededRng(3));
    expect(forced.table?.id).toBe('tblA');
  });
});

describe('trails', () => {
  it('walking a trail cell reveals its push-directions; players get signs only', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'trail.upsert',
      trail: {
        id: null, mapId, name: "Varram's footsteps", glyph: '👣', dmNotes: '',
        gate: { kind: 'auto' },
        cells: [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: -1 }, { q: 5, r: -1 }],
      },
    } as never);
    expect(runtime.trailDiscoveries.size).toBe(0);

    // Step onto the second cell.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.trailDiscoveries.size).toBe(1);
    const td = [...runtime.trailDiscoveries.values()][0]!;
    expect(td.characterId).toBe(charId);
    expect(td.cellIndex).toBe(1);

    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    // Trail definitions never reach players.
    expect(view.mapState!.trails).toEqual([]);
    expect(view.mapState!.trailSigns).toHaveLength(1);
    const sign = view.mapState!.trailSigns[0]!;
    expect([sign.q, sign.r]).toEqual([3, 0]);
    expect(sign.forward).toBeTruthy();  // toward (4,-1)
    expect(sign.backward).toBeTruthy(); // toward (2,0)
    expect(sign.forwardAngle).not.toBeNull();

    // Re-entering doesn't duplicate; walking the next cell adds one sign.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 4, r: -1 } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(runtime.trailDiscoveries.size).toBe(2);

    // DM keeps full trails and no signs (engine derives its own).
    const dmView = filterStateForViewer(runtime.buildFullState(), {
      seatId: 'dm', role: 'dm', characterId: null,
    });
    expect(dmView.mapState!.trails).toHaveLength(1);
  });

  it('an end cell has a backward direction but no forward', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'trail.upsert',
      trail: {
        id: null, mapId, name: 'Short path', glyph: '👣', dmNotes: '',
        gate: { kind: 'auto' },
        cells: [{ q: 1, r: 0 }, { q: 2, r: 0 }],
      },
    } as never);
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    const sign = view.mapState!.trailSigns.find((s) => s.q === 2)!;
    expect(sign.forward).toBeNull();
    expect(sign.backward).toBe('north-west');
  });
});

describe('skill-gated items (issue #41)', () => {
  it('a content with no auto clue stays hidden until a check on its hex reveals it', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 3, r: 0, type: 'dungeon', title: 'Goblin Cave', dmNotes: '', glyph: '',
        clues: [
          { id: null, text: 'Goblin tracks crisscross the area', gate: { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 2, mode: 'passive' }, sortOrder: 0, indicatesDirection: true, revealsLocation: false },
          { id: null, text: 'A brush-hidden cave mouth in the rocks', gate: { kind: 'skill', skill: 'survival', dc: 2, maxDistance: 0, mode: 'active' }, sortOrder: 1 },
        ],
      },
    } as never);

    const playerView = () => filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });

    // Approach within perception range: tracks sensed, but no pin.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(playerView().senses.some((s) => s.text.includes('Goblin tracks'))).toBe(true);
    expect(playerView().mapState!.contents.find((c) => c.title === 'Goblin Cave')).toBeUndefined();

    // Standing ON the hex still reveals nothing — the cave gate is an active check.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    expect(playerView().mapState!.contents.find((c) => c.title === 'Goblin Cave')).toBeUndefined();

    // A Survival search on the hex finds the cave and reveals the item.
    asSeat(playerSeat, { kind: 'check.roll', skill: 'survival', dc: null, characterIds: [], mapId, hex: { q: 3, r: 0 } } as never);
    const cave = playerView().mapState!.contents.find((c) => c.title === 'Goblin Cave');
    expect(cave).toBeDefined();
  });
});

describe('content enable/disable + quests (issue #42)', () => {
  it('disabled content produces no discoveries and no player pin; enabling wakes it', () => {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 1, r: 0, type: 'ruin', title: 'Future Ruin', dmNotes: '', glyph: '',
        enabled: false, quest: 'act2',
        clues: [{ id: null, text: 'Old stones', gate: { kind: 'auto' }, sortOrder: 0 }],
      },
    } as never);
    const ruin = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Future Ruin')!;

    // Walk onto it: nothing fires, nothing shows.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(0);
    const view1 = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(view1.mapState!.contents).toHaveLength(0);

    // Enable while the character stands there: the auto clue fires immediately.
    dm({ kind: 'content.setEnabled', contentIds: [ruin.id], enabled: true } as never);
    expect(runtime.discoveries.size).toBe(1);
    const view2 = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(view2.mapState!.contents.find((c) => c.title === 'Future Ruin')).toBeDefined();

    // Disable again: pin vanishes for players (discovery kept for later).
    dm({ kind: 'content.setEnabled', contentIds: [ruin.id], enabled: false } as never);
    const view3 = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(view3.mapState!.contents).toHaveLength(0);
    expect(runtime.discoveries.size).toBe(1);

    // Undo restores the previous enabled state.
    dm({ kind: 'undo' } as never);
    expect(runtime.requireMap(mapId).contents.get(ruin.id)!.enabled).toBe(true);

    // Quest tagging.
    dm({ kind: 'content.setQuest', contentIds: [ruin.id], quest: 'act3' } as never);
    expect(runtime.requireMap(mapId).contents.get(ruin.id)!.quest).toBe('act3');
  });
});

describe('known-location content', () => {
  it('players see the pin with no clues; clues still gate normally', () => {
    const { mapId, charId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 6, r: 0, type: 'landmark', title: 'Famous Bridge', dmNotes: '', glyph: '',
        knownLocation: true,
        clues: [
          { id: null, text: 'A secret smugglers cache under the third arch', gate: { kind: 'manual' }, sortOrder: 0 },
        ],
      },
    } as never);

    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    const bridge = view.mapState!.contents.find((c) => c.title === 'Famous Bridge')!;
    expect(bridge).toBeDefined();
    expect((bridge as { discoveredClues: unknown[] }).discoveredClues).toHaveLength(0);

    // Revealing the clue adds its text to the already-visible pin.
    const clueId = [...runtime.requireMap(mapId).contents.values()]
      .find((c) => c.title === 'Famous Bridge')!.clues[0]!.id;
    dm({ kind: 'clue.reveal', clueId, characterIds: [charId] } as never);
    const after = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    const bridgeAfter = after.mapState!.contents.find((c) => c.title === 'Famous Bridge')!;
    expect((bridgeAfter as { discoveredClues: { text: string }[] }).discoveredClues[0]!.text).toContain('smugglers');
  });
});

describe('clue sharing', () => {
  function setupSharedClue() {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({
      kind: 'character.create',
      character: { name: 'Bard', color: '#0000aa', glyph: '🎻', speed: 30, skills: {} },
    } as never);
    const bardId = [...runtime.characters.keys()].find((id) => id !== charId)!;
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 3, r: 0, type: 'ruin', title: 'Old Ruin', dmNotes: '', glyph: '',
        clues: [{ id: null, text: 'Crumbled stones whisper', gate: { kind: 'auto' }, sortOrder: 0 }],
      },
    } as never);
    // Walking onto the hex opens the auto gate for the scout only.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 3, r: 0 } as never);
    const clueId = [...runtime.requireMap(mapId).contents.values()][0]!.clues[0]!.id;
    return { charId, bardId, clueId, playerSeat };
  }

  it('a player shares a discovered clue with every other character', () => {
    const { charId, bardId, clueId, playerSeat } = setupSharedClue();
    expect(runtime.hasDiscovery(clueId, charId)).toBe(true);
    expect(runtime.hasDiscovery(clueId, bardId)).toBe(false);

    asSeat(playerSeat, { kind: 'clue.share', clueId } as never);
    expect(runtime.hasDiscovery(clueId, bardId)).toBe(true);
    const bardDisc = [...runtime.discoveries.values()].find((d) => d.characterId === bardId)!;
    expect(bardDisc.how).toEqual({ kind: 'shared', fromCharacterId: charId });
    expect(bardDisc.locates).toBe(true); // sharer had located it

    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.kind).toBe('share');
    expect(entry.visibility).toBe('all');
    expect(entry.text).toContain('Scout shared with the party');
  });

  it('cannot share a clue the character has not discovered', () => {
    const { mapId } = setupPartyWithScout();
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 9, r: 9, type: 'ruin', title: 'Far Ruin', dmNotes: '', glyph: '',
        clues: [{ id: null, text: 'Unknown secret', gate: { kind: 'manual' }, sortOrder: 0 }],
      },
    } as never);
    const clueId = [...runtime.requireMap(mapId).contents.values()][0]!.clues[0]!.id;
    const playerSeat = [...runtime.seats.values()].find((s) => s.role === 'player')!;
    expect(() => asSeat(playerSeat, { kind: 'clue.share', clueId } as never)).toThrow(/discovered/);
  });
});

describe('per-character log filtering', () => {
  it("a player's roll entries reach only seats owning a rolling character", () => {
    const { mapId, charId, playerSeat } = setupPartyWithScout();
    // Second player with their own character.
    dm({
      kind: 'character.create',
      character: { name: 'Bard', color: '#0000aa', glyph: '🎻', speed: 30, skills: {} },
    } as never);
    const bardId = [...runtime.characters.keys()].find((id) => id !== charId)!;
    const bardSeat = runtime.createSeat('player', 'Bob');
    asSeat(bardSeat, { kind: 'seat.claimCharacter', characterId: bardId } as never);
    bardSeat.characterId = bardId;

    asSeat(playerSeat, {
      kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 0, r: 0 },
    } as never);
    const entry = runtime.log[runtime.log.length - 1]!;
    expect(entry.kind).toBe('check');
    expect(entry.visibility).toBe('all');

    const scoutView = filterStateForViewer(runtime.buildFullState(), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(scoutView.log.some((e) => e.id === entry.id)).toBe(true);

    const bardView = filterStateForViewer(runtime.buildFullState(), {
      seatId: bardSeat.id, role: 'player', characterId: bardId,
    });
    expect(bardView.log.some((e) => e.id === entry.id)).toBe(false);

    // Narration to all still reaches everyone.
    dm({ kind: 'narrate', text: 'The wind howls.', seatIds: [] } as never);
    const narration = runtime.log[runtime.log.length - 1]!;
    const bardView2 = filterStateForViewer(runtime.buildFullState(), {
      seatId: bardSeat.id, role: 'player', characterId: bardId,
    });
    expect(bardView2.log.some((e) => e.id === narration.id)).toBe(true);
  });
});

describe('auto encounter checks (every N hexes)', () => {
  it('rolls once per N hexes travelled, carries the counter, skips teleports', () => {
    const { mapId, tokenId, playerSeat } = setupPartyWithScout();
    dm({ kind: 'map.update', mapId, patch: { encounterCheck: { autoEvery: 2 } } } as never);

    const countEncounters = () => runtime.log.filter((e) => e.kind === 'encounter').length;
    expect(countEncounters()).toBe(0);

    // 5 hexes of travel with autoEvery=2 → checks at steps 2 and 4, counter 1.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 5, r: 0 } as never);
    expect(countEncounters()).toBe(2);
    expect(runtime.maps.get(mapId)!.encounterCheck.hexesSinceCheck).toBe(1);

    // One more hex completes the next window.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 6, r: 0 } as never);
    expect(countEncounters()).toBe(3);
    expect(runtime.maps.get(mapId)!.encounterCheck.hexesSinceCheck).toBe(0);

    // DM teleport does not count as travel.
    dm({ kind: 'token.move', tokenId, q: 20, r: 0, teleport: true } as never);
    expect(countEncounters()).toBe(3);

    // All auto entries are DM-only.
    expect(runtime.log.filter((e) => e.kind === 'encounter').every((e) => e.visibility === 'dm')).toBe(true);
  });

  it('does nothing when autoEvery is 0', () => {
    const { tokenId, playerSeat } = setupPartyWithScout();
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 8, r: 0 } as never);
    expect(runtime.log.filter((e) => e.kind === 'encounter')).toHaveLength(0);
  });
});

describe('prep mode (pause player map sync)', () => {
  it('freezes editable layers for players until the pause is lifted', () => {
    const { mapId, charId, playerSeat } = setupPartyWithScout();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }], terrain: 'forest' } as never);

    dm({ kind: 'campaign.update', settings: { pausePlayerMapSync: true } } as never);
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 1, r: 0 }], terrain: 'swamp' } as never);
    dm({
      kind: 'marker.place',
      marker: { mapId, q: 0, r: 0, glyph: '⭐', label: 'New', dmOnly: false },
    } as never);

    const playerFull = runtime.applyPlayerFreeze(runtime.buildFullState());
    const playerView = filterStateForViewer(playerFull, {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    // Pre-pause terrain visible; paused-in edits are not.
    expect(playerView.mapState!.hexes.some((h) => h.q === 0 && h.terrain === 'forest')).toBe(true);
    expect(playerView.mapState!.hexes.some((h) => h.q === 1 && h.terrain === 'swamp')).toBe(false);
    expect(playerView.mapState!.markers).toHaveLength(0);

    // The DM keeps seeing live state.
    const dmView = filterStateForViewer(runtime.buildFullState(), {
      seatId: dmSeat.id, role: 'dm', characterId: null,
    });
    expect(dmView.mapState!.hexes.some((h) => h.q === 1 && h.terrain === 'swamp')).toBe(true);

    // Tokens stay live during the pause.
    const rtTokens = [...runtime.requireMap(mapId).tokens.values()];
    expect(playerFull.mapState!.tokens).toHaveLength(rtTokens.length);

    dm({ kind: 'campaign.update', settings: { pausePlayerMapSync: false } } as never);
    const resumed = filterStateForViewer(runtime.applyPlayerFreeze(runtime.buildFullState()), {
      seatId: playerSeat.id, role: 'player', characterId: charId,
    });
    expect(resumed.mapState!.hexes.some((h) => h.q === 1 && h.terrain === 'swamp')).toBe(true);
    expect(resumed.mapState!.markers).toHaveLength(1);
  });
});

describe('campaign export / import (issue #76)', () => {
  /**
   * Canonical form for deep comparison: ids replaced by a placeholder, null /
   * absent treated alike, and every array sorted — a reload rebuilds the
   * in-memory Maps in SQL row order, which is not the original insert order.
   */
  const ID_KEYS = /^(id|.*Id)$/;
  function scrubIds(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value
        .map(scrubIds)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null || v === undefined) continue;
        out[k] = ID_KEYS.test(k) && typeof v === 'string' ? '<id>' : scrubIds(v);
      }
      return out;
    }
    return value;
  }

  /** Full state for every map, keyed by map name, with ids scrubbed. */
  function stateByMapName(rt: CampaignRuntime): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const map of rt.maps.values()) {
      const full = rt.buildFullState(map.id);
      // Seats are deliberately not restored (fresh DM seat, fresh token), and
      // entries whispered to one seat come back DM-only (asserted separately).
      const { seats: _seats, ...rest } = full;
      out[map.name] = scrubIds({
        ...rest,
        // Same-millisecond log ties reorder on any reload (the load query
        // breaks ties by id), so compare the log as a sorted list.
        log: [...rest.log]
          .map((e) => ({ ...e, visibility: e.visibility === 'all' ? 'all' : '<private>' }))
          .sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text)),
      });
    }
    return out;
  }

  function seedRichCampaign(): { mapId: string; charId: string } {
    const { mapId, charId, tokenId, playerSeat } = setupPartyWithScout();
    dm({ kind: 'terrain.paint', mapId, cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }], terrain: 'forest' } as never);
    dm({
      kind: 'marker.place',
      marker: { mapId, q: 2, r: 2, glyph: '⭐', label: 'Camp', dmOnly: true },
    } as never);
    dm({
      kind: 'content.upsert',
      content: {
        id: null, mapId, q: 3, r: 0, type: 'lair', title: 'Wyrm Hollow', dmNotes: 'secret', glyph: '🐉',
        clues: [
          { id: null, text: 'Scorched trees', gate: { kind: 'auto' }, sortOrder: 0 },
          { id: null, text: 'A hoard glitters', gate: { kind: 'manual' }, sortOrder: 1 },
        ],
      },
    } as never);
    const content = [...runtime.requireMap(mapId).contents.values()].find(
      (c) => c.title === 'Wyrm Hollow',
    )!;
    dm({ kind: 'clue.reveal', clueId: content.clues[1]!.id, characterIds: [] } as never);
    dm({
      kind: 'trail.upsert',
      trail: {
        id: null, mapId, name: 'Scaled tracks', glyph: '👣', dmNotes: 'wyrm',
        gate: { kind: 'auto' },
        cells: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
      },
    } as never);
    dm({
      kind: 'encounterTable.upsert',
      table: {
        id: null, name: 'Forest', terrains: ['forest'], die: '1d12',
        entries: [{ min: 1, max: 12, text: 'Wolves' }], enabled: true,
      },
    } as never);
    // Travel: fog reveal, auto clue discovery, trail discovery, log entries.
    asSeat(playerSeat, { kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    dm({ kind: 'narrate', text: 'Ash drifts on the wind.', seatIds: [] } as never);
    return { mapId, charId };
  }

  function tmpUploads(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-portability-'));
  }

  it('exports every table for the campaign and no secrets', () => {
    seedRichCampaign();
    const uploads = tmpUploads();
    const exported = exportCampaign(store.db, runtime.id, uploads);

    expect(exported.formatVersion).toBe(1);
    expect(exported.secrets).toBe(false);
    expect(exported.campaign.dm_secret).toBeUndefined();
    expect(exported.campaign.player_secret).toBeUndefined();
    expect(exported.seats.length).toBeGreaterThan(0);
    expect(exported.seats.every((s) => s.token === undefined)).toBe(true);
    // Nothing anywhere in the archive leaks an invite key or a seat token.
    const blob = JSON.stringify(exported);
    expect(blob.includes(runtime.dmSecret)).toBe(false);
    expect(blob.includes(runtime.playerSecret)).toBe(false);
    expect(blob.includes(dmSeat.token)).toBe(false);

    expect(exported.maps).toHaveLength(runtime.maps.size);
    expect(exported.contents).toHaveLength(1);
    expect(exported.clues).toHaveLength(2);
    expect(exported.trails).toHaveLength(1);
    expect(exported.discoveries.length).toBeGreaterThan(0);
    expect(exported.trailDiscoveries.length).toBeGreaterThan(0);
    expect(exported.encTables).toHaveLength(1);
    expect(exported.log.length).toBeGreaterThan(0);
    expect(exported.hexes).toHaveLength(2);
    expect(exported.fog.length).toBeGreaterThan(0);
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  it('imports as a new campaign whose runtime state deep-matches the original', () => {
    seedRichCampaign();
    const uploads = tmpUploads();
    const exported = exportCampaign(store.db, runtime.id, uploads);
    const before = stateByMapName(runtime);

    const result = importCampaign(store.db, exported, { uploadsDir: uploads });
    expect(result.campaignId).not.toBe(runtime.id);
    expect(result.dmSecret).not.toBe(runtime.dmSecret);
    expect(result.playerSecret).not.toBe(runtime.playerSecret);

    // Loads cleanly through the Store / CampaignRuntime path.
    const restored = store.getCampaign(result.campaignId)!;
    expect(restored.id).toBe(result.campaignId);
    expect(stateByMapName(restored)).toEqual(before);

    // Ids really were remapped, not reused.
    const oldContentId = [...runtime.requireMap(runtime.campaign.activeMapId!).contents.keys()][0]!;
    expect([...restored.maps.keys()].some((id) => runtime.maps.has(id))).toBe(false);
    for (const rt of restored.mapStates.values()) {
      expect(rt.contents.has(oldContentId)).toBe(false);
    }
    // Cross-table references still resolve inside the new campaign.
    for (const disc of restored.discoveries.values()) {
      expect(restored.findContentByClue(disc.clueId)).not.toBeNull();
      expect(restored.characters.has(disc.characterId)).toBe(true);
    }
    for (const td of restored.trailDiscoveries.values()) {
      expect(restored.findTrail(td.trailId)).not.toBeNull();
      expect(restored.characters.has(td.characterId)).toBe(true);
    }
    // Ordered collections keep their order (the deep compare sorts arrays).
    const oldTrail = [...runtime.requireMap(runtime.campaign.activeMapId!).trails.values()][0];
    const newTrail = [...restored.mapStates.values()].flatMap((rt) => [...rt.trails.values()])[0]!;
    expect(newTrail.cells).toEqual(oldTrail?.cells);
    const newContent = [...restored.mapStates.values()].flatMap((rt) => [...rt.contents.values()])[0]!;
    expect(newContent.clues.map((cl) => cl.text)).toEqual(['Scorched trees', 'A hoard glitters']);

    // Seat-scoped log visibility has no audience after import: it lands DM-only.
    expect(runtime.log.some((e) => e.visibility !== 'dm' && e.visibility !== 'all')).toBe(true);
    expect(restored.log.every((e) => e.visibility === 'dm' || e.visibility === 'all')).toBe(true);
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  it('round-trips uploaded image files into the new campaign uploads dir', () => {
    const mapId = activeMapId();
    const uploads = tmpUploads();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    fs.mkdirSync(path.join(uploads, runtime.id), { recursive: true });
    fs.writeFileSync(path.join(uploads, runtime.id, 'abc123.png'), bytes);
    runtime.addImageLayer({
      id: 'img1', mapId, path: `/uploads/${runtime.id}/abc123.png`, name: 'Region.png',
      x: 5, y: 6, scale: 2, opacity: 0.5, z: 0, dmOnly: true, visible: true,
    });

    const exported = exportCampaign(store.db, runtime.id, uploads);
    expect(exported.images).toHaveLength(1);
    expect(exported.images[0]!.dataBase64).toBe(bytes.toString('base64'));

    const result = importCampaign(store.db, exported, { uploadsDir: uploads });
    const restored = store.getCampaign(result.campaignId)!;
    const mapName = runtime.maps.get(mapId)!.name;
    const newMapId = [...restored.maps.values()].find((m) => m.name === mapName)!.id;
    const layers = restored.imageLayersFor(newMapId);
    expect(layers).toHaveLength(1);
    const layer = layers[0]!;
    expect(layer.name).toBe('Region.png');
    expect(layer.dmOnly).toBe(true);
    expect(layer.scale).toBe(2);
    expect(layer.path).toMatch(new RegExp(`^/uploads/${result.campaignId}/[\\w-]+\\.png$`));
    expect(layer.path).not.toBe(`/uploads/${runtime.id}/abc123.png`);
    const onDisk = path.join(uploads, ...layer.path.replace('/uploads/', '').split('/'));
    expect(fs.readFileSync(onDisk).equals(bytes)).toBe(true);
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  it('rejects junk and unsupported format versions', () => {
    const uploads = tmpUploads();
    expect(() => importCampaign(store.db, { nope: true }, { uploadsDir: uploads })).toThrow(
      /Not a HexCrawl backup/,
    );
    const exported = exportCampaign(store.db, runtime.id, uploads);
    expect(() =>
      importCampaign(store.db, { ...exported, formatVersion: 99 }, { uploadsDir: uploads }),
    ).toThrow(/Unsupported backup format/);
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  describe('HTTP routes', () => {
    it('GET /export requires the DM seat or the dm key', async () => {
      const app = createApp(store, hub);
      expect((await app.request(`/api/campaigns/${runtime.id}/export`)).status).toBe(403);
      expect(
        (await app.request(`/api/campaigns/${runtime.id}/export?key=${runtime.playerSecret}`)).status,
      ).toBe(403);
      expect((await app.request('/api/campaigns/nope/export')).status).toBe(404);

      const withKey = await app.request(`/api/campaigns/${runtime.id}/export?key=${runtime.dmSecret}`);
      expect(withKey.status).toBe(200);
      expect(withKey.headers.get('Content-Disposition')).toContain(`hexcrawl-${runtime.id}-`);
      const body = JSON.parse(await withKey.text()) as {
        formatVersion: number;
        campaign: { name: string };
      };
      expect(body.formatVersion).toBe(1);
      expect(body.campaign.name).toBe('Test Campaign');

      const withCookie = await app.request(`/api/campaigns/${runtime.id}/export`, {
        headers: { Cookie: `hc_seat_${runtime.id}=${dmSeat.token}` },
      });
      expect(withCookie.status).toBe(200);
    });

    it('POST /api/campaigns/import restores a JSON body and seats the caller as DM', async () => {
      seedRichCampaign();
      const app = createApp(store, hub);
      const exported = await (
        await app.request(`/api/campaigns/${runtime.id}/export?key=${runtime.dmSecret}`)
      ).text();

      const res = await app.request('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: exported,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { campaignId: string; dmKey: string; playerKey: string };
      expect(body.campaignId).not.toBe(runtime.id);
      expect(body.dmKey).not.toBe(runtime.dmSecret);
      expect(res.headers.get('Set-Cookie')).toContain(`hc_seat_${body.campaignId}=`);

      const restored = store.getCampaign(body.campaignId)!;
      expect(restored.campaign.name).toBe('Test Campaign');
      expect([...restored.seats.values()].filter((s) => s.role === 'dm')).toHaveLength(1);
      // The seat cookie the response set really authenticates.
      const token = [...restored.seats.values()][0]!.token;
      const me = await app.request(`/api/campaigns/${body.campaignId}/me`, {
        headers: { Cookie: `hc_seat_${body.campaignId}=${token}` },
      });
      expect(((await me.json()) as { role: string }).role).toBe('dm');
    });

    it('accepts a multipart upload and rejects non-JSON', async () => {
      const app = createApp(store, hub);
      const exported = await (
        await app.request(`/api/campaigns/${runtime.id}/export?key=${runtime.dmSecret}`)
      ).text();
      const form = new FormData();
      form.append('file', new File([exported], 'backup.json', { type: 'application/json' }));
      form.append('dmName', 'Restorer');
      const res = await app.request('/api/campaigns/import', { method: 'POST', body: form });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { campaignId: string };
      const restored = store.getCampaign(body.campaignId)!;
      expect([...restored.seats.values()][0]!.name).toBe('Restorer');

      const bad = await app.request('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });
      expect(bad.status).toBe(400);
      const wrongShape = await app.request('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      });
      expect(wrongShape.status).toBe(400);
    });

    it('never lets an API path fall through to the SPA index.html', async () => {
      const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-dist-'));
      fs.writeFileSync(path.join(dist, 'index.html'), '<html>spa</html>');
      const prev = process.env.CLIENT_DIST;
      process.env.CLIENT_DIST = dist;
      try {
        const app = createApp(store, hub);
        // Deep links still serve the SPA…
        const spa = await app.request(`/c/${runtime.id}`);
        expect(spa.status).toBe(200);
        expect(await spa.text()).toContain('spa');
        // …but a wrong method or a typo'd API path 404s as JSON.
        for (const url of [
          '/api/campaigns/import', // GET on a POST-only route
          '/api/campaigns/typo/exprot',
          '/api/does-not-exist',
        ]) {
          const res = await app.request(url);
          expect(res.status).toBe(404);
          expect(res.headers.get('Content-Type')).toContain('application/json');
        }
      } finally {
        if (prev === undefined) delete process.env.CLIENT_DIST;
        else process.env.CLIENT_DIST = prev;
        fs.rmSync(dist, { recursive: true, force: true });
      }
    });
  });
});
