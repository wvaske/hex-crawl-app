/**
 * Sticker library for map markers (issue #67): `Marker.icon` / `Marker.scale`
 * across the schema, the wire commands, and SQLite write-through.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ClientCommandSchema,
  MarkerSchema,
  filterStateForViewer,
  seededRng,
} from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let cmdCounter = 0;

function asSeat(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat,
    hub,
    rng: seededRng(1),
  });
}

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  asSeat(dmSeat, cmd);
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Sticker Campaign', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  dm({ kind: 'map.create', name: 'Region', orientation: 'flat', hexSize: 48 } as never);
});

function activeMapId(): string {
  return runtime.campaign.activeMapId!;
}

function markers() {
  return runtime.mapState(activeMapId())!.markers;
}

/** Drop the cached runtime so the next read comes back off disk. */
function reloadFromDisk() {
  const id = runtime.campaign.id;
  store.forget(id);
  return store.getCampaign(id)!;
}

describe('marker sticker schema', () => {
  it('defaults icon to empty and scale to 1 for pre-sticker markers', () => {
    const m = MarkerSchema.parse({
      id: 'mk1',
      mapId: 'm1',
      q: 0,
      r: 0,
      glyph: '🔥',
    });
    expect(m.icon).toBe('');
    expect(m.scale).toBe(1);
  });

  it('round-trips a sticker id and scale', () => {
    const input = {
      id: 'mk1',
      mapId: 'm1',
      q: 3,
      r: -2,
      glyph: '⛺',
      icon: 'camp/tent',
      scale: 2.5,
      label: 'Base camp',
      dmOnly: true,
      playerPlaced: false,
      ownerSeatId: null,
    };
    const parsed = MarkerSchema.parse(input);
    expect(parsed).toEqual(input);
    expect(MarkerSchema.parse(parsed)).toEqual(parsed);
  });

  it('rejects out-of-range scales and over-long icon ids', () => {
    const base = { id: 'mk1', mapId: 'm1', q: 0, r: 0, glyph: '🔥' };
    expect(MarkerSchema.safeParse({ ...base, scale: 0.4 }).success).toBe(false);
    expect(MarkerSchema.safeParse({ ...base, scale: 3.1 }).success).toBe(false);
    expect(MarkerSchema.safeParse({ ...base, scale: 0.5 }).success).toBe(true);
    expect(MarkerSchema.safeParse({ ...base, scale: 3 }).success).toBe(true);
    expect(MarkerSchema.safeParse({ ...base, icon: 'x'.repeat(121) }).success).toBe(false);
  });

  it('keeps the sticker fields optional on the wire (CommandInput gotcha)', () => {
    // A client that predates the sticker library still validates.
    const legacy = ClientCommandSchema.parse({
      id: 'c1',
      kind: 'marker.place',
      marker: { mapId: 'm1', q: 0, r: 0, glyph: '🔥', label: '', dmOnly: false },
    });
    expect(legacy.kind).toBe('marker.place');
    if (legacy.kind !== 'marker.place') throw new Error('unreachable');
    expect(legacy.marker.icon).toBeUndefined();
    expect(legacy.marker.scale).toBeUndefined();

    const withSticker = ClientCommandSchema.parse({
      id: 'c2',
      kind: 'marker.place',
      marker: {
        mapId: 'm1',
        q: 0,
        r: 0,
        glyph: '⛺',
        icon: 'camp/tent',
        scale: 1.5,
        label: '',
        dmOnly: false,
      },
    });
    if (withSticker.kind !== 'marker.place') throw new Error('unreachable');
    expect(withSticker.marker.icon).toBe('camp/tent');
    expect(withSticker.marker.scale).toBe(1.5);

    // marker.update patches the same two fields.
    const patch = ClientCommandSchema.parse({
      id: 'c3',
      kind: 'marker.update',
      markerId: 'mk1',
      patch: { icon: 'places/keep', scale: 2 },
    });
    if (patch.kind !== 'marker.update') throw new Error('unreachable');
    expect(patch.patch).toEqual({ icon: 'places/keep', scale: 2 });
  });
});

describe('marker.place with stickers', () => {
  it('stores icon and scale and reloads them from SQLite', () => {
    dm({
      kind: 'marker.place',
      marker: {
        mapId: activeMapId(),
        q: 1,
        r: 2,
        glyph: '⛺',
        icon: 'camp/tent',
        scale: 2,
        label: 'Camp',
        dmOnly: false,
      },
    } as never);
    const placed = markers();
    expect(placed).toHaveLength(1);
    expect(placed[0]!.icon).toBe('camp/tent');
    expect(placed[0]!.scale).toBe(2);

    // Reload the whole campaign from the database: the columns persisted.
    const reloaded = reloadFromDisk();
    const reloadedMarkers = reloaded.mapState(reloaded.campaign.activeMapId)!.markers;
    expect(reloadedMarkers[0]!.icon).toBe('camp/tent');
    expect(reloadedMarkers[0]!.scale).toBe(2);
  });

  it('fills sticker defaults when the client omits them', () => {
    dm({
      kind: 'marker.place',
      marker: { mapId: activeMapId(), q: 0, r: 0, glyph: '🔥', label: '', dmOnly: false },
    } as never);
    expect(markers()[0]!.icon).toBe('');
    expect(markers()[0]!.scale).toBe(1);
  });

  it('updates icon and scale on an existing marker', () => {
    dm({
      kind: 'marker.place',
      marker: { mapId: activeMapId(), q: 0, r: 0, glyph: '🔥', label: '', dmOnly: false },
    } as never);
    const id = markers()[0]!.id;
    dm({ kind: 'marker.update', markerId: id, patch: { icon: 'places/keep', scale: 1.5 } } as never);
    expect(markers()[0]!.icon).toBe('places/keep');
    expect(markers()[0]!.scale).toBe(1.5);
    // Untouched fields survive the patch.
    expect(markers()[0]!.glyph).toBe('🔥');

    const reloaded = reloadFromDisk();
    const m = reloaded.mapState(reloaded.campaign.activeMapId)!.markers[0]!;
    expect(m.icon).toBe('places/keep');
    expect(m.scale).toBe(1.5);
  });
});

describe('player notes keep their sticker guarantees (issue #74)', () => {
  it('forces a player-placed sticker note to be party-visible', () => {
    const player = runtime.createSeat('player', 'Alice');
    asSeat(player, {
      kind: 'marker.place',
      marker: {
        mapId: activeMapId(),
        q: 4,
        r: 4,
        glyph: '📌',
        icon: 'story/note',
        scale: 1.5,
        label: 'We camped here',
        // A malicious client asking for a hidden note is overruled.
        dmOnly: true,
      },
    } as never);
    const note = markers()[0]!;
    expect(note.dmOnly).toBe(false);
    expect(note.playerPlaced).toBe(true);
    expect(note.ownerSeatId).toBe(player.id);
    expect(note.icon).toBe('story/note');
    expect(note.scale).toBe(1.5);
  });

  it('cannot hide its own note behind a marker.update', () => {
    const player = runtime.createSeat('player', 'Alice');
    asSeat(player, {
      kind: 'marker.place',
      marker: {
        mapId: activeMapId(),
        q: 0,
        r: 0,
        glyph: '📌',
        icon: 'story/note',
        scale: 1,
        label: 'note',
        dmOnly: false,
      },
    } as never);
    const id = markers()[0]!.id;
    asSeat(player, {
      kind: 'marker.update',
      markerId: id,
      patch: { icon: 'story/danger', scale: 2, dmOnly: true },
    } as never);
    const note = markers()[0]!;
    expect(note.dmOnly).toBe(false);
    expect(note.icon).toBe('story/danger');
    expect(note.scale).toBe(2);
  });

  it('sends sticker fields through to the player snapshot', () => {
    dm({
      kind: 'marker.place',
      marker: {
        mapId: activeMapId(),
        q: 0,
        r: 0,
        glyph: '⛺',
        icon: 'camp/tent',
        scale: 2,
        label: 'Camp',
        dmOnly: false,
      },
    } as never);
    // The hex must be visible to the player for the marker to survive filtering.
    dm({ kind: 'fog.set', mapId: activeMapId(), cells: [{ q: 0, r: 0 }], state: 'visible' } as never);
    const player = runtime.createSeat('player', 'Alice');
    const full = runtime.buildFullState(activeMapId());
    const view = filterStateForViewer(full, {
      seatId: player.id,
      role: 'player',
      characterId: player.characterId,
    });
    const seen = view.mapState!.markers;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.icon).toBe('camp/tent');
    expect(seen[0]!.scale).toBe(2);
  });
});
