import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { CharacterSchema, definePluginManifest, seededRng, type ClientCommand, type ServerMessage } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub, type Conn } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { actionsFor, defineServerPlugin } from './plugins/api.js';
import { createPluginTestBed, type PluginTestBed } from './plugins/testing.js';

/**
 * DM "view as player" (seat.viewAs): the DM's own seat is rebuilt as a player
 * seat holding one character everywhere a view is produced — the WebSocket
 * snapshot and the plugin action route — while commands keep DM authority.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let n = 0;
function as(seat: SeatRecord, cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${n++}` } as ClientCommand, { runtime, seat, hub, rng: seededRng(1) });
}
function fakeConn(seat: SeatRecord): { conn: Conn; sent: ServerMessage[] } {
  const sent: ServerMessage[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (s: string) => sent.push(JSON.parse(s) as ServerMessage) };
  return { conn: { ws: ws as never, runtime, seat }, sent };
}
function createCharacter(name: string): { id: string } {
  const character = CharacterSchema.parse({ id: nanoid(12), name, color: '#c9a227', glyph: '★', skills: {} });
  runtime.upsertCharacter(character);
  return character;
}
const lastSnapshot = (sent: ServerMessage[]) =>
  sent.filter((m) => m.type === 'snapshot').at(-1) as Extract<ServerMessage, { type: 'snapshot' }>;

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('View As', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
});

describe('seat.viewAs', () => {
  it('is DM only and needs a real character; null returns to the DM view', () => {
    const player = runtime.createSeat('player', 'Ana');
    const { id: charId } = createCharacter('Ser Ana');
    expect(() => as(player, { kind: 'seat.viewAs', characterId: charId } as never)).toThrow(/Only the DM/);
    expect(() => as(dmSeat, { kind: 'seat.viewAs', characterId: 'nope' } as never)).toThrow(/Character not found/);

    as(dmSeat, { kind: 'seat.viewAs', characterId: charId } as never);
    expect(runtime.effectiveSeat(dmSeat)).toMatchObject({ id: dmSeat.id, role: 'player', characterId: charId });
    expect(runtime.viewingAsFor(dmSeat)).toEqual({ characterId: charId, name: 'Ser Ana' });
    // Player seats are always themselves.
    expect(runtime.effectiveSeat(player)).toBe(player);

    as(dmSeat, { kind: 'seat.viewAs', characterId: null } as never);
    expect(runtime.effectiveSeat(dmSeat)).toBe(dmSeat);
    expect(runtime.viewingAsFor(dmSeat)).toBeNull();
  });

  it('is cleared when the viewed character is deleted', () => {
    const { id: charId } = createCharacter('Ser Ana');
    as(dmSeat, { kind: 'seat.viewAs', characterId: charId } as never);
    runtime.deleteCharacter(charId);
    expect(runtime.effectiveSeat(dmSeat)).toBe(dmSeat);
  });

  it('rebuilds the DM snapshot through the player pipeline, with viewingAs set', () => {
    const { id: charId } = createCharacter('Ser Ana');
    const mapId = runtime.campaign.activeMapId!;
    // A painted hex under hidden fog: the DM sees its terrain, a player never does.
    as(dmSeat, { kind: 'terrain.paint', mapId, cells: [{ q: 5, r: 5 }], terrain: 'forest' } as never);
    const hidden = (snap: Extract<ServerMessage, { type: 'snapshot' }>) =>
      snap.state.mapState!.hexes.some((h) => h.q === 5 && h.r === 5);

    const { conn, sent } = fakeConn(dmSeat);
    hub.sendSnapshot(conn);
    let snap = lastSnapshot(sent);
    expect(snap.role).toBe('dm');
    expect(snap.viewingAs ?? null).toBeNull();
    expect(hidden(snap)).toBe(true);

    as(dmSeat, { kind: 'seat.viewAs', characterId: charId } as never);
    hub.sendSnapshot(conn);
    snap = lastSnapshot(sent);
    expect(snap.seatId).toBe(dmSeat.id);
    expect(snap.role).toBe('player');
    expect(snap.viewingAs).toEqual({ characterId: charId, name: 'Ser Ana' });
    expect(hidden(snap)).toBe(false);

    as(dmSeat, { kind: 'seat.viewAs', characterId: null } as never);
    hub.sendSnapshot(conn);
    expect(lastSnapshot(sent).role).toBe('dm');
  });
});

describe('plugins while viewing as a player', () => {
  const action = actionsFor<Record<string, never>>();
  const plugin = defineServerPlugin({
    manifest: definePluginManifest({ id: 'who-plugin', name: 'Who', version: '0.0.1', description: 'fixture' }),
    actions: {
      who: action({
        handler: (ctx) => ({ isDm: ctx.isDm, role: ctx.seat.role, character: ctx.character?.id ?? null }),
      }),
      secret: action({ dmOnly: true, input: z.object({}), handler: () => ({ ok: true }) }),
    },
  });
  let bed: PluginTestBed;
  beforeEach(() => {
    bed = createPluginTestBed(plugin);
  });
  afterEach(() => bed.dispose());

  it('gives the DM the player context and refuses DM-only actions until they return', async () => {
    const ana = bed.addPlayer('Ana', 'Ser Ana');
    let r = await bed.call<{ isDm: boolean; role: string; character: string | null }>('who', {});
    expect(r.result).toEqual({ isDm: true, role: 'dm', character: null });
    expect((await bed.call('secret', {})).status).toBe(200);

    bed.runtime.setViewAs(bed.dmSeat.id, ana.character.id);
    r = await bed.call('who', {});
    expect(r.result).toEqual({ isDm: false, role: 'player', character: ana.character.id });
    expect((await bed.call('secret', {})).status).toBe(403);

    bed.runtime.setViewAs(bed.dmSeat.id, null);
    r = await bed.call('who', {});
    expect(r.result.isDm).toBe(true);
  });
});
