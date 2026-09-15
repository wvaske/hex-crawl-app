import { beforeEach, describe, expect, it } from 'vitest';
import { seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Splitting the party (issue #124): a character can leave the travel group
 * without leaving the campaign, a player can do it for their own character,
 * and deleting a character no longer leaves an orphan token dragging along.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `p${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `p${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Split', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function member(name: string): { charId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name,
      color: '#00aa00',
      glyph: '',
      speed: 30,
      skills: {},
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
    q: 0,
    r: 0,
    tokenKind: 'pc',
    characterId: charId,
    label: '',
    color: '#00aa00',
    glyph: '',
    playerVisible: true,
  } as never);
  const tokenId = [...runtime.requireMap(mapId).tokens.values()].find((t) => t.characterId === charId)!.id;
  dm({ kind: 'token.update', tokenId, patch: { partyId: 'party' } } as never);
  return { charId, tokenId, seat };
}

describe('splitting the party', () => {
  it('a detached character stays in the campaign but stops moving with the group', () => {
    const a = member('Ash');
    const b = member('Bramble');
    const rt = runtime.requireMap(runtime.campaign.activeMapId!);
    dm({ kind: 'token.move', tokenId: a.tokenId, q: 2, r: 0 } as never);
    expect(rt.tokens.get(b.tokenId)).toMatchObject({ q: 2, r: 0 });

    asSeat(b.seat, { kind: 'token.update', tokenId: b.tokenId, patch: { partyId: null } } as never);
    dm({ kind: 'token.move', tokenId: a.tokenId, q: 4, r: 0 } as never);
    expect(rt.tokens.get(b.tokenId)).toMatchObject({ q: 2, r: 0 });
    expect(runtime.characters.has(b.charId)).toBe(true);
    expect(runtime.seats.get(b.seat.id)!.characterId).toBe(b.charId);

    asSeat(b.seat, { kind: 'token.update', tokenId: b.tokenId, patch: { partyId: 'party' } } as never);
    dm({ kind: 'token.move', tokenId: a.tokenId, q: 5, r: 0 } as never);
    expect(rt.tokens.get(b.tokenId)).toMatchObject({ q: 3, r: 0 });
  });

  it("a player may only toggle their own character's party membership", () => {
    const a = member('Ash');
    const b = member('Bramble');
    expect(() =>
      asSeat(b.seat, { kind: 'token.update', tokenId: a.tokenId, patch: { partyId: null } } as never),
    ).toThrow(/own character/);
    expect(() =>
      asSeat(b.seat, { kind: 'token.update', tokenId: b.tokenId, patch: { label: 'X' } } as never),
    ).toThrow(/own character/);
  });

  it('deleting a character removes their token and everything keyed to them', () => {
    const a = member('Ash');
    const b = member('Bramble');
    const mapId = runtime.campaign.activeMapId!;
    const rt = runtime.requireMap(mapId);
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId,
        q: 0,
        r: 0,
        type: 'ruin',
        title: 'Cairn',
        dmNotes: '',
        glyph: '',
        clues: [{ id: null, text: 'Old stones', gate: { kind: 'auto' }, sortOrder: 0 }],
      },
    } as never);
    expect(runtime.discoveries.size).toBe(2);
    asSeat(b.seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 0, r: 0 } } as never);
    expect([...rt.searchAttempts.values()].some((s) => s.characterId === b.charId)).toBe(true);

    dm({ kind: 'character.delete', characterId: b.charId } as never);
    expect(rt.tokens.has(b.tokenId)).toBe(false);
    expect(rt.tokens.has(a.tokenId)).toBe(true);
    expect([...runtime.discoveries.values()].every((d) => d.characterId !== b.charId)).toBe(true);
    expect([...rt.searchAttempts.values()].every((s) => s.characterId !== b.charId)).toBe(true);
    expect(runtime.seats.get(b.seat.id)!.characterId).toBeNull();
    // The survivors still travel as a party of one.
    dm({ kind: 'token.move', tokenId: a.tokenId, q: 3, r: 0 } as never);
    expect(rt.tokens.get(a.tokenId)).toMatchObject({ q: 3, r: 0 });
    // Durable.
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    expect(reloaded.requireMap(mapId).tokens.has(b.tokenId)).toBe(false);
    expect([...reloaded.discoveries.values()].every((d) => d.characterId !== b.charId)).toBe(true);
  });
});
