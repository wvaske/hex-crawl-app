import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClientCommandSchema, ContentSchema, filterStateForViewer, seededRng, withDirection, withDistance } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import type { CampaignRuntime, SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { evaluateKnowledge } from './engine/knowledge.js';
import { deliverDiscoveries } from './engine/deliver.js';
import { exportCampaign, importCampaign } from './http/portability.js';
import { createApp } from './http/app.js';

let store: Store;
let runtime: CampaignRuntime;
let dm: SeatRecord;
let player: SeatRecord;
let mapId: string;
let characterId: string;
let tokenId: string;
let sequence = 0;
let hub: Hub;
let uploadsDir: string;

function dispatch(seat: SeatRecord, command: Record<string, unknown>) {
  dispatchCommand(ClientCommandSchema.parse({ ...command, id: `distance-${sequence++}` }), {
    runtime, seat, hub, rng: seededRng(1),
  });
}

function content(indicatesDistance = true, mode: 'passive' | 'active' = 'passive') {
  const value = ContentSchema.parse({
    id: 'source', mapId, q: 4, r: 0, area: [{ q: 2, r: 0 }], type: 'landmark', title: 'Secret source',
    clues: [{ id: 'clue', contentId: 'source', text: 'Smoke rises', indicatesDistance, revealsLocation: false,
      gate: { kind: 'skill', skill: 'perception', dc: 1, maxDistance: 5, mode },
      observeFrom: mode === 'active' ? [{ q: 0, r: 0 }] : [],
    }],
  });
  runtime.upsertContent(value);
  return value;
}

function view() {
  return filterStateForViewer(runtime.buildFullState(mapId), { seatId: player.id, role: 'player', characterId });
}

beforeEach(() => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-distance-'));
  store = new Store(createTestDb());
  const created = store.createCampaign('Distance', 'DM');
  runtime = created.runtime;
  dm = created.dmSeat;
  mapId = runtime.campaign.activeMapId!;
  hub = new Hub();
  dispatch(dm, { kind: 'character.create', character: { name: 'Scout', color: '#00aa00', glyph: 'S', skills: {} } });
  characterId = [...runtime.characters.keys()][0]!;
  player = runtime.createSeat('player', 'Player');
  runtime.claimCharacter(player.id, characterId);
  dispatch(dm, { kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId });
  tokenId = [...runtime.requireMap(mapId).tokens.keys()][0]!;
});

afterEach(() => {
  store.db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

describe('optional clue distance (#154)', () => {
  it('formats zero, singular, plural and combined direction without requiring a direction', () => {
    expect(withDistance('Smoke', null)).toBe('Smoke');
    expect(withDistance('Smoke', undefined)).toBe('Smoke');
    expect(withDistance('Smoke', 0)).toBe('Smoke — 0 hexes away');
    expect(withDistance('Smoke', 1)).toBe('Smoke — 1 hex away');
    expect(withDistance(withDirection('Smoke', 'south-west'), 2)).toBe('Smoke — to the south-west — 2 hexes away');
  });

  it('uses the nearest region hex, delivers it to the owner, but does not reveal the source', () => {
    content();
    const send = vi.spyOn(hub, 'sendTo');
    const discoveries = evaluateKnowledge(runtime, mapId);
    deliverDiscoveries(runtime, hub, discoveries);
    expect(discoveries[0]?.discovery).toMatchObject({ distance: 2, direction: null, locates: false });
    expect(send.mock.calls[0]?.[1]).toMatchObject({ kind: 'discovery.new', discovery: { distance: 2 } });
    expect(view().senses[0]).toMatchObject({ distance: 2, contentTitle: null, located: false });
    expect(view().mapState?.contents).toEqual([]);
    expect(view().log.some((l) => l.text.includes('Smoke rises — 2 hexes away'))).toBe(true);
    runtime.updateToken(mapId, tokenId, { q: 1 });
    expect(view().senses[0]?.distance).toBe(1);
    runtime.updateToken(mapId, tokenId, { q: 2 });
    expect(view().senses[0]?.distance).toBe(0);
    runtime.updateToken(mapId, tokenId, { q: 20 });
    expect(view().senses[0]).toMatchObject({ inRange: false, distance: 2 });
  });

  it('does not disclose distance unless opted in, and unlearned clues stay hidden', () => {
    content(false);
    expect(view().senses).toEqual([]);
    expect(evaluateKnowledge(runtime, mapId)[0]?.discovery.distance).toBeNull();
    expect(view().senses[0]?.distance).toBeNull();
    const defaults = ContentSchema.parse({ ...content(), clues: [{ id: 'default', contentId: 'source', text: 'Secret', gate: { kind: 'auto' } }] });
    expect(defaults.clues[0]?.indicatesDistance).toBe(false);
  });

  it('freezes approved search distance at roll time, through reload and campaign export/import', () => {
    content(true, 'active');
    dispatch(player, { kind: 'check.roll', mapId, skill: 'perception', characterIds: [characterId], hex: { q: 0, r: 0 } });
    const pending = [...runtime.pendingReveals.values()][0]!;
    expect(pending.distance).toBe(2);
    expect(view().pendingReveals).toEqual([]);
    expect(view().senses).toEqual([]);
    runtime.updateToken(mapId, tokenId, { q: 20 });
    runtime = new Store(store.db).getCampaign(runtime.id)!;
    expect(runtime.pendingReveals.get(pending.id)?.distance).toBe(2);
    dispatch(dm, { kind: 'search.resolve', pendingIds: [pending.id], approve: true });
    expect(view().senses[0]).toMatchObject({ distance: 2, inRange: false });
    const archive = exportCampaign(store.db, runtime.id, uploadsDir)!;
    const imported = importCampaign(store.db, archive, { uploadsDir });
    const restored = new Store(store.db).getCampaign(imported.campaignId)!;
    expect([...restored.discoveries.values()][0]?.distance).toBe(2);
    expect([...restored.mapStates.values()][0]?.contents.values().next().value?.clues[0]?.indicatesDistance).toBe(true);
  });

  it('keeps distance on shared clues and computes it for manual reveals', () => {
    content();
    dispatch(dm, { kind: 'clue.reveal', clueId: 'clue', characterIds: [characterId] });
    expect([...runtime.discoveries.values()][0]?.distance).toBe(2);
    dispatch(dm, { kind: 'character.create', character: { name: 'Friend', color: '#0000aa', glyph: 'F', skills: {} } });
    dispatch(player, { kind: 'clue.share', clueId: 'clue' });
    expect([...runtime.discoveries.values()].map((d) => d.distance)).toEqual([2, 2]);
    runtime = new Store(store.db).getCampaign(runtime.id)!;
    expect([...runtime.discoveries.values()].map((d) => d.distance)).toEqual([2, 2]);
  });

  it('delivers distance and a source bearing immediately for a DM search on a vantage hex', () => {
    const source = content(true, 'active');
    source.clues[0]!.indicatesDirection = true;
    runtime.upsertContent(source);
    dispatch(dm, { kind: 'check.roll', mapId, skill: 'perception', characterIds: [characterId], hex: { q: 0, r: 0 } });
    const discovery = [...runtime.discoveries.values()][0]!;
    expect(discovery.distance).toBe(2);
    expect(discovery.direction).toBeTruthy();
    expect(runtime.pendingReveals.size).toBe(0);
    expect(view().log.some((l) => l.text.includes(' — to the ') && l.text.endsWith(' — 2 hexes away'))).toBe(true);
  });

  it('preserves the distance toggle on legacy edits and accepts an explicit false', () => {
    const source = content();
    const { indicatesDistance: _ignored, ...legacy } = source.clues[0]!;
    dispatch(dm, { kind: 'content.upsert', content: { ...source, clues: [legacy] } });
    expect(runtime.findContentByClue('clue')?.clues[0]?.indicatesDistance).toBe(true);
    dispatch(dm, { kind: 'content.upsert', content: { ...source, clues: [{ ...legacy, indicatesDistance: false }] } });
    expect(runtime.findContentByClue('clue')?.clues[0]?.indicatesDistance).toBe(false);
  });

  it('accepts the option via the integration API', async () => {
    const app = createApp(store, hub);
    const res = await app.request(`/api/integration/campaigns/${runtime.id}/content`, {
      method: 'POST', headers: { Authorization: `Bearer ${runtime.dmSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, title: 'Imported source', q: 4, r: 0,
        clues: [{ text: 'A light', gate: { kind: 'manual' }, indicatesDistance: true }] }),
    });
    expect(res.status).toBe(200);
    const { contentId } = await res.json() as { contentId: string };
    expect(runtime.requireMap(mapId).contents.get(contentId)?.clues[0]?.indicatesDistance).toBe(true);
  });
});
