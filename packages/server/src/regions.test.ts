import { beforeEach, describe, expect, it } from 'vitest';
import { filterStateForViewer, seededRng } from '@hexcrawl/shared';
import type { ClientCommand, Content, ContentPlayerView } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { createApp } from './http/app.js';

/**
 * Multi-hex region footprints (issue #69). A region carries `area`: the
 * member hexes beside its anchor. Everything distance-shaped — auto gates,
 * passive gates, the locates upgrade, hex searches — measures to the NEAREST
 * member, so reaching any hex of the footprint counts as reaching the place.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `r${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `r${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Regions', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  cmdCounter = 0;
});

/** Scout with perception +4 / survival +2 on a PC token at the origin. */
function party(): { mapId: string; charId: string; tokenId: string; seat: SeatRecord } {
  const mapId = runtime.campaign.activeMapId!;
  dm({
    kind: 'character.create',
    character: {
      name: 'Scout',
      color: '#00aa00',
      glyph: '🏹',
      speed: 30,
      skills: { perception: 4, survival: 2 },
      extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' },
    },
  } as never);
  const charId = [...runtime.characters.keys()][0]!;
  const seat = runtime.createSeat('player', 'Alice');
  asSeat(seat, { kind: 'seat.claimCharacter', characterId: charId } as never);
  seat.characterId = runtime.seats.get(seat.id)!.characterId;
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

/**
 * A region anchored at (5,0) whose footprint runs east to (7,0). The anchor
 * is an implicit member, so `area` carries only the other two hexes.
 */
function region(
  mapId: string,
  title: string,
  clues: unknown[],
  area = [
    { q: 6, r: 0 },
    { q: 7, r: 0 },
  ],
): Content {
  dm({
    kind: 'content.upsert',
    content: {
      id: null,
      mapId,
      q: 5,
      r: 0,
      area,
      type: 'region',
      title,
      dmNotes: '',
      glyph: '',
      clues,
    },
  } as never);
  return [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === title)!;
}

describe('region footprints: storage', () => {
  it('persists the area and reloads it from SQLite', () => {
    const { mapId } = party();
    const content = region(mapId, 'Forest of Wyrms', [
      { id: null, text: 'Wyrm-scarred trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    expect(content.area).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);

    // Drop the cached runtime so the next read comes back out of SQLite.
    store.forget(runtime.id);
    const reloaded = store.getCampaign(runtime.id)!;
    const same = [...reloaded.requireMap(mapId).contents.values()].find(
      (c) => c.title === 'Forest of Wyrms',
    )!;
    expect(same.area).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);
  });

  it('an upsert that omits the area keeps the painted footprint', () => {
    const { mapId } = party();
    const content = region(mapId, 'Serpent Hills', []);
    // The pin popup's quick toggles resend content without an area.
    dm({
      kind: 'content.upsert',
      content: {
        id: content.id,
        mapId,
        q: content.q,
        r: content.r,
        type: content.type,
        title: content.title,
        dmNotes: content.dmNotes,
        glyph: content.glyph,
        knownLocation: true,
        clues: [],
      },
    } as never);
    const after = runtime.requireMap(mapId).contents.get(content.id)!;
    expect(after.knownLocation).toBe(true);
    expect(after.area).toHaveLength(2);

    // An explicit empty list still clears it.
    dm({
      kind: 'content.upsert',
      content: {
        id: content.id,
        mapId,
        q: content.q,
        r: content.r,
        area: [],
        type: content.type,
        title: content.title,
        dmNotes: content.dmNotes,
        glyph: content.glyph,
        clues: [],
      },
    } as never);
    expect(runtime.requireMap(mapId).contents.get(content.id)!.area).toEqual([]);
  });
});

describe('region footprints: knowledge', () => {
  it('an auto gate fires on entering any member hex, not just the anchor', () => {
    const { mapId, tokenId, seat } = party();
    region(mapId, 'Forest of Wyrms', [
      { id: null, text: 'You are among the wyrm-trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    // One hex short of the footprint: still nothing.
    asSeat(seat, { kind: 'token.move', tokenId, q: 8, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(0);
    // The far end of the footprint — three hexes from the anchor.
    asSeat(seat, { kind: 'token.move', tokenId, q: 7, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    expect([...runtime.discoveries.values()][0]!.locates).toBe(true);
  });

  it('a passive gate measures from the nearest member hex', () => {
    const { mapId, tokenId, seat } = party();
    region(mapId, 'Hill of Lost Souls', [
      {
        id: null,
        text: 'A cold wind off the hills',
        gate: { kind: 'skill', skill: 'survival', dc: 12, maxDistance: 1, mode: 'passive' },
        sortOrder: 0,
      },
    ]);
    // (9,0): two hexes from the nearest member (7,0) — out of range.
    asSeat(seat, { kind: 'token.move', tokenId, q: 9, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(0);
    // (8,0): one hex from (7,0), but four from the anchor (5,0). Without
    // footprint distance this gate would never open here.
    asSeat(seat, { kind: 'token.move', tokenId, q: 8, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(1);
    // Sensed from outside: the place is known about, not located.
    expect([...runtime.discoveries.values()][0]!.locates).toBe(false);
  });

  it('reaching any member hex upgrades an at-a-distance discovery to located', () => {
    const { mapId, tokenId, seat, charId } = party();
    region(mapId, 'Hill of Lost Souls', [
      {
        id: null,
        text: 'A cold wind off the hills',
        gate: { kind: 'skill', skill: 'survival', dc: 12, maxDistance: 1, mode: 'passive' },
        sortOrder: 0,
      },
    ]);
    asSeat(seat, { kind: 'token.move', tokenId, q: 8, r: 0 } as never);
    const discoveryId = [...runtime.discoveries.keys()][0]!;
    expect(runtime.discoveries.get(discoveryId)!.locates).toBe(false);

    // Step into the footprint's far end; the anchor is still 2 hexes away.
    asSeat(seat, { kind: 'token.move', tokenId, q: 7, r: 0 } as never);
    expect(runtime.discoveries.get(discoveryId)!.locates).toBe(true);
    expect(runtime.discoveries.size).toBe(1); // upgraded, not duplicated

    const view = playerContents(charId).find((c) => c.title === 'Hill of Lost Souls')!;
    expect(view.area).toHaveLength(2);
  });

  it('a hex search on a member hex searches the whole region', () => {
    const { mapId, tokenId, seat, charId } = party();
    const content = region(mapId, 'Forest of Wyrms', [
      {
        id: null,
        // Active gates never open passively — only a deliberate search finds it.
        text: 'A wyrm den under the roots',
        gate: { kind: 'skill', skill: 'perception', dc: 5, maxDistance: 2, mode: 'active' },
        sortOrder: 0,
      },
    ]);
    asSeat(seat, { kind: 'token.move', tokenId, q: 7, r: 0 } as never);
    expect(runtime.discoveries.size).toBe(0);

    // Search a member hex that is NOT the anchor: the region matches, and the
    // character is inside the footprint, so the find pins the location.
    asSeat(seat, {
      kind: 'check.roll',
      skill: 'perception',
      dc: null,
      characterIds: [],
      mapId,
      hex: { q: 6, r: 0 },
    } as never);
    expect(runtime.discoveries.size).toBe(1);
    const discovery = [...runtime.discoveries.values()][0]!;
    expect(discovery.clueId).toBe(content.clues[0]!.id);
    expect(discovery.how.kind).toBe('roll');
    expect(discovery.locates).toBe(true);
    expect(playerContents(charId).map((c) => c.title)).toContain('Forest of Wyrms');
  });
});

describe('region footprints: player view', () => {
  it('withholds the footprint until the region is located, then hands it over whole', () => {
    const { mapId, tokenId, seat, charId } = party();
    region(mapId, 'Forest of Wyrms', [
      { id: null, text: 'Wyrm-scarred trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    // Undiscovered: the player gets no view at all, so no footprint either.
    expect(playerContents(charId)).toHaveLength(0);

    asSeat(seat, { kind: 'token.move', tokenId, q: 6, r: 0 } as never);
    const views = playerContents(charId);
    expect(views).toHaveLength(1);
    expect(views[0]!.area).toEqual([
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ]);
    expect('dmNotes' in views[0]!).toBe(false);
  });

  it('common-knowledge regions ship their footprint with no discoveries', () => {
    const { mapId, charId } = party();
    dm({
      kind: 'content.upsert',
      content: {
        id: null,
        mapId,
        q: 5,
        r: 0,
        area: [{ q: 6, r: 0 }],
        type: 'region',
        title: 'The Sword Coast',
        dmNotes: '',
        glyph: '',
        knownLocation: true,
        clues: [],
      },
    } as never);
    const views = playerContents(charId);
    expect(views).toHaveLength(1);
    expect(views[0]!.area).toEqual([{ q: 6, r: 0 }]);
    expect(views[0]!.discoveredClues).toEqual([]);
  });

  it('a disabled region reaches nobody, footprint included', () => {
    const { mapId, tokenId, seat, charId } = party();
    const content = region(mapId, 'Forest of Wyrms', [
      { id: null, text: 'Wyrm-scarred trees', gate: { kind: 'auto' }, sortOrder: 0 },
    ]);
    asSeat(seat, { kind: 'token.move', tokenId, q: 6, r: 0 } as never);
    expect(playerContents(charId)).toHaveLength(1);
    dm({ kind: 'content.setEnabled', contentIds: [content.id], enabled: false } as never);
    expect(playerContents(charId)).toHaveLength(0);
  });
});

describe('region footprints: integration API', () => {
  async function post(path: string, body: unknown): Promise<Response> {
    const app = createApp(store, hub);
    return await app.request(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtime.dmSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('accepts an area on create and merges omitted areas on update', async () => {
    const mapId = runtime.campaign.activeMapId!;
    const created = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Serpent Hills',
      q: 1,
      r: 1,
      type: 'region',
      area: [
        { q: 2, r: 1 },
        { q: 3, r: 1 },
      ],
    });
    expect(created.status).toBe(200);
    const find = () =>
      [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Serpent Hills')!;
    expect(find().area).toHaveLength(2);

    // A notes-only sync must not erase the footprint.
    const updated = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Serpent Hills',
      q: 1,
      r: 1,
      dmNotes: 'Yuan-ti country.',
    });
    expect(updated.status).toBe(200);
    expect(find().area).toHaveLength(2);
    expect(find().dmNotes).toBe('Yuan-ti country.');

    // An explicit area replaces it wholesale.
    await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Serpent Hills',
      q: 1,
      r: 1,
      area: [{ q: 2, r: 1 }],
    });
    expect(find().area).toEqual([{ q: 2, r: 1 }]);
  });

  it('defaults to a single hex when no area is given', async () => {
    const mapId = runtime.campaign.activeMapId!;
    await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Boareskyr Bridge',
      q: 0,
      r: 2,
    });
    const content = [...runtime.requireMap(mapId).contents.values()].find(
      (c) => c.title === 'Boareskyr Bridge',
    )!;
    expect(content.area).toEqual([]);
  });
});

/** What one character's player seat actually receives for map content. */
function playerContents(characterId: string): ContentPlayerView[] {
  const state = filterStateForViewer(runtime.buildFullState(), {
    seatId: 'seat-under-test',
    role: 'player',
    characterId,
  });
  return (state.mapState?.contents ?? []) as ContentPlayerView[];
}
