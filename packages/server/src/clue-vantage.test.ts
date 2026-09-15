import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

/**
 * Clue vantage hexes (issue #123): a clue (or a whole content's clues) can be
 * perceived only from chosen hexes, ignoring the gate's distance. This has to
 * hold in every place the geometry is read — the passive knowledge engine,
 * the search roll, and the senses a player gets back.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `v${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(7),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `v${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(7),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Vantage', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

function party(): { mapId: string; charId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout',
      color: '#00aa00',
      glyph: '',
      speed: 30,
      // Passive perception 24: any DC opens as soon as the geometry allows.
      skills: { perception: 14 },
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const seat = runtime.createSeat('player', 'Alice');
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
  const tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
  return { mapId, charId, tokenId, seat };
}

const RIDGE = [{ q: 4, r: 0 }, { q: 4, r: 1 }];

/** A tower at (2,0) with a clue visible only from the ridge at (4,0)/(4,1). */
function tower(mapId: string, opts: { contentSet?: boolean; clueSet?: boolean; mode?: 'passive' | 'active' } = {}) {
  dm({
    kind: 'content.upsert',
    content: {
      id: null,
      mapId,
      q: 2,
      r: 0,
      type: 'landmark',
      title: 'Watchtower',
      dmNotes: '',
      glyph: '',
      observeFrom: opts.contentSet ? RIDGE : [],
      clues: [
        {
          id: null,
          text: 'A tower rises above the trees',
          gate: { kind: 'skill', skill: 'perception', dc: 10, maxDistance: 3, mode: opts.mode ?? 'passive' },
          sortOrder: 0,
          observeFrom: opts.clueSet ? RIDGE : [],
        },
      ],
    },
  } as never);
  return [...runtime.requireMap(mapId).contents.values()][0]!;
}

describe('passive gates with vantage hexes', () => {
  it('open from the vantage hexes only, never by distance', () => {
    const { mapId, tokenId } = party();
    const content = tower(mapId, { clueSet: true });
    // (0,0) is within 3 hexes — would open by distance, but is not a vantage.
    expect(runtime.discoveries.size).toBe(0);
    dm({ kind: 'token.move', tokenId, q: 2, r: 0 } as never); // standing on it
    expect(runtime.discoveries.size).toBe(0);
    dm({ kind: 'token.move', tokenId, q: 4, r: 1 } as never); // the ridge
    expect(runtime.discoveries.size).toBe(1);
    expect([...runtime.discoveries.values()][0]!.clueId).toBe(content.clues[0]!.id);
  });

  it('a content-level set covers every clue; a clue set overrides it', () => {
    const { mapId, tokenId } = party();
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId,
        q: 2,
        r: 0,
        type: 'landmark',
        title: 'Shrine',
        dmNotes: '',
        glyph: '',
        observeFrom: RIDGE,
        clues: [
          { id: null, text: 'Seen from the ridge', gate: { kind: 'auto' }, sortOrder: 0 },
          {
            id: null,
            text: 'Seen from the gate',
            gate: { kind: 'auto' },
            sortOrder: 1,
            observeFrom: [{ q: 1, r: 0 }],
          },
        ],
      },
    } as never);
    dm({ kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    let texts = [...runtime.discoveries.values()].map((d) => runtime.findContentByClue(d.clueId)!.clues.find((c) => c.id === d.clueId)!.text);
    expect(texts).toEqual(['Seen from the ridge']);
    dm({ kind: 'token.move', tokenId, q: 1, r: 0 } as never);
    texts = [...runtime.discoveries.values()].map((d) => runtime.findContentByClue(d.clueId)!.clues.find((c) => c.id === d.clueId)!.text);
    expect(texts.sort()).toEqual(['Seen from the gate', 'Seen from the ridge']);
  });

  it('round-trips through the database and an omitted set keeps what is stored', () => {
    const { mapId } = party();
    const content = tower(mapId, { contentSet: true, clueSet: true });
    const reloaded = new Store(store.db).getCampaign(runtime.id)!;
    const again = reloaded.requireMap(mapId).contents.get(content.id)!;
    expect(again.observeFrom).toEqual(RIDGE);
    expect(again.clues[0]!.observeFrom).toEqual(RIDGE);
    // A sender that predates vantage sets (no `observeFrom` key at all)
    // must not wipe the content's set.
    dm({
      kind: 'content.upsert',
      content: { ...content, id: content.id, observeFrom: undefined, clues: content.clues.map((c) => ({ ...c, observeFrom: undefined })) },
    } as never);
    expect(runtime.requireMap(mapId).contents.get(content.id)!.observeFrom).toEqual(RIDGE);
  });
});

describe('searches and senses with vantage hexes', () => {
  it('an active clue is found by searching the vantage hex you stand on, not the tower', () => {
    const { mapId, tokenId, seat } = party();
    const content = tower(mapId, { clueSet: true, mode: 'active' });
    dm({ kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    // Searching the tower's hex from the ridge: the tower is not covered by a
    // vantage, and the clue is not "on" (4,0) either way — so search HERE.
    asSeat(seat, { kind: 'check.roll', skill: 'perception', dc: null, characterIds: [], mapId, hex: { q: 4, r: 0 } } as never);
    expect(runtime.pendingReveals.size).toBe(1);
    expect([...runtime.pendingReveals.values()][0]!.clueId).toBe(content.clues[0]!.id);
  });

  it('senses report the vantage hexes (visited ones) as where it can be observed from', () => {
    const { mapId, tokenId, seat } = party();
    tower(mapId, { clueSet: true });
    dm({ kind: 'token.move', tokenId, q: 4, r: 1 } as never);
    dm({ kind: 'token.move', tokenId, q: 4, r: 0 } as never);
    const view = filterStateForViewer(runtime.buildFullState(), {
      seatId: seat.id,
      role: 'player',
      characterId: seat.characterId,
    });
    const sense = view.senses[0]!;
    expect(sense.inRange).toBe(true);
    expect(sense.observableFrom.map((c) => `${c.q},${c.r}`).sort()).toEqual(['4,0', '4,1']);
    dm({ kind: 'token.move', tokenId, q: 2, r: 0 } as never);
    const later = filterStateForViewer(runtime.buildFullState(), {
      seatId: seat.id,
      role: 'player',
      characterId: seat.characterId,
    });
    expect(later.senses[0]!.inRange).toBe(false);
  });
});
