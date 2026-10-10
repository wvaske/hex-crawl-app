import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientCommandSchema, seededRng } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import type { CampaignRuntime, SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';

let store: Store;
let runtime: CampaignRuntime;
let dm: SeatRecord;
let player: SeatRecord;
let tokenId: string;
let mapId: string;
let sequence = 0;
const hub = new Hub();

function dispatch(seat: SeatRecord, command: Record<string, unknown>) {
  dispatchCommand(ClientCommandSchema.parse({ ...command, id: `request-${sequence++}` }), {
    runtime, seat, hub, rng: seededRng(1),
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Movement requests', 'DM');
  runtime = created.runtime;
  dm = created.dmSeat;
  mapId = runtime.campaign.activeMapId!;
  dispatch(dm, { kind: 'character.create', character: { name: 'Scout', color: '#00aa00', glyph: 'S', skills: {} } });
  const characterId = [...runtime.characters.keys()][0]!;
  player = runtime.createSeat('player', 'Player');
  runtime.claimCharacter(player.id, characterId);
  dispatch(dm, { kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId });
  tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
});

afterEach(() => store.db.close());

describe('selected-hex player requests (#155)', () => {
  it('queues both modes on a free-movement map without moving or advancing time', () => {
    const minutes = runtime.campaign.time.minutes;
    expect(runtime.maps.get(mapId)!.moveApproval).toBe(false);
    for (const teleport of [false, true]) {
      dispatch(player, { kind: 'move.request', tokenId, q: 3, r: 0, teleport });
      expect(runtime.requireMap(mapId).pendingMoves.get(tokenId)).toMatchObject({ toQ: 3, toR: 0, teleport });
      expect(runtime.findToken(tokenId)).toMatchObject({ q: 0, r: 0 });
      expect(runtime.campaign.time.minutes).toBe(minutes);
    }
  });

  it('allows asking to teleport over an impassable edge but still requires a DM', () => {
    dispatch(dm, { kind: 'edge.set', mapId, edges: [{ q: 0, r: 0, dir: 0, difficulty: 'impassable' }] });
    expect(() => dispatch(player, { kind: 'move.request', tokenId, q: 1, r: 0 })).toThrow(/impassable/);
    dispatch(player, { kind: 'move.request', tokenId, q: 1, r: 0, teleport: true });
    expect(() => dispatch(player, { kind: 'move.resolve', tokenId, approve: true, teleport: true })).toThrow(/DM/);
    const minutes = runtime.campaign.time.minutes;
    dispatch(dm, { kind: 'move.resolve', tokenId, approve: true, teleport: true });
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 1, r: 0 });
    expect(runtime.campaign.time.minutes).toBe(minutes);
    expect(runtime.requireMap(mapId).pendingMoves.size).toBe(0);
  });

  it('lets the DM deny or approve travel instead of the requested teleport', () => {
    dispatch(player, { kind: 'move.request', tokenId, q: 1, r: 0, teleport: true });
    dispatch(dm, { kind: 'move.resolve', tokenId, approve: false });
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 0, r: 0 });
    expect(runtime.requireMap(mapId).pendingMoves.size).toBe(0);
    dispatch(player, { kind: 'move.request', tokenId, q: 1, r: 0, teleport: true });
    const minutes = runtime.campaign.time.minutes;
    dispatch(dm, { kind: 'move.resolve', tokenId, approve: true, teleport: false });
    expect(runtime.findToken(tokenId)).toMatchObject({ q: 1, r: 0 });
    expect(runtime.campaign.time.minutes).toBeGreaterThan(minutes);
  });

  it('keeps legacy requests as walking and refuses another player’s token', () => {
    dispatch(player, { kind: 'move.request', tokenId, q: 1, r: 0 });
    expect(runtime.requireMap(mapId).pendingMoves.get(tokenId)?.teleport).toBe(false);
    const stranger = runtime.createSeat('player', 'Other player');
    expect(() => dispatch(stranger, { kind: 'move.request', tokenId, q: 3, r: 0, teleport: true }))
      .toThrow(/own character/);
    expect(runtime.requireMap(mapId).pendingMoves.get(tokenId)).toMatchObject({ toQ: 1, teleport: false });
  });
});
