import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { Hub } from './ws/hub.js';
import { createApp } from './http/app.js';
import type { CampaignRuntime } from './state/runtime.js';
import { dispatchCommand } from './ws/handlers.js';
import { seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';

let store: Store;
let runtime: CampaignRuntime;
let app: ReturnType<typeof createApp>;
let hub: Hub;
let dmSeat: ReturnType<Store['createCampaign']>['dmSeat'];

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Integration Test', 'DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  app = createApp(store, hub);
});

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${Math.random()}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${runtime.dmSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('integration content upsert merge semantics (issue #72 finding)', () => {
  it('an update omitting a field keeps the existing value instead of resetting it', async () => {
    const mapId = runtime.campaign.activeMapId!;
    const created = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Boareskyr Bridge',
      q: 2,
      r: -1,
      type: 'settlement',
      enabled: false,
      knownLocation: true,
      showLabel: true,
      scaleVisibility: 2,
    });
    expect(created.status).toBe(200);

    // A dmNotes-only sync must not clobber the curated fields.
    const updated = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Boareskyr Bridge',
      q: 2,
      r: -1,
      dmNotes: 'Bhaal and Cyric fought here.',
    });
    expect(updated.status).toBe(200);

    const content = [...runtime.requireMap(mapId).contents.values()].find(
      (ct) => ct.title === 'Boareskyr Bridge',
    )!;
    expect(content.type).toBe('settlement');
    expect(content.enabled).toBe(false);
    expect(content.knownLocation).toBe(true);
    expect(content.showLabel).toBe(true);
    expect(content.scaleVisibility).toBe(2);
    expect(content.dmNotes).toBe('Bhaal and Cyric fought here.');
  });

  it('creates still get sane defaults when fields are omitted', async () => {
    const mapId = runtime.campaign.activeMapId!;
    const res = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Fresh Pin',
      q: 0,
      r: 0,
    });
    expect(res.status).toBe(200);
    const content = [...runtime.requireMap(mapId).contents.values()].find(
      (ct) => ct.title === 'Fresh Pin',
    )!;
    expect(content.type).toBe('landmark');
    expect(content.enabled).toBe(true);
    expect(content.knownLocation).toBe(false);
    expect(content.scaleVisibility).toBe(1);
  });
});

describe('integration content upsert delivers discoveries', () => {
  it('a passive clue opened by an AI-added location reaches the journal, not just the table', async () => {
    const mapId = runtime.campaign.activeMapId!;
    dm({
      kind: 'character.create',
      character: { name: 'Scout', color: '#00aa00', glyph: '🏹', speed: 30, skills: { perception: 4 }, extra: { bio: '', appearance: '', goals: '', inventory: '', notes: '' } },
    } as never);
    const charId = [...runtime.characters.keys()][0]!;
    const playerSeat = runtime.createSeat('player', 'Alice');
    runtime.claimCharacter(playerSeat.id, charId);
    dm({
      kind: 'token.create', mapId, q: 0, r: 0, tokenKind: 'pc', characterId: charId,
      label: '', color: '#00aa00', glyph: '', playerVisible: true,
    } as never);

    // Same shape the dm-companion MCP sends: a settlement with passive clues,
    // dropped one hex from where the party stands.
    const res = await post(`/api/integration/campaigns/${runtime.id}/content`, {
      mapId,
      title: 'Adderstand',
      q: 1,
      r: 0,
      type: 'settlement',
      clues: [
        { text: 'Threads of chimney smoke rise above the treeline', gate: { kind: 'skill', skill: 'perception', dc: 10, maxDistance: 4, mode: 'passive' }, indicatesDirection: true },
      ],
    });
    expect(res.status).toBe(200);

    const clueId = [...runtime.requireMap(mapId).contents.values()].find((c) => c.title === 'Adderstand')!.clues[0]!.id;
    expect(runtime.hasDiscovery(clueId, charId)).toBe(true);
    // The DM feed names the clue; the owning player's journal gets its own line.
    const dmLine = runtime.log.find((e) => e.kind === 'discovery' && e.visibility === 'dm' && e.data.clueId === clueId);
    expect(dmLine?.text).toContain('Adderstand');
    const ownerSeats = [...runtime.seats.values()].filter((s) => s.characterId === charId).map((s) => s.id);
    expect(ownerSeats.length).toBeGreaterThan(0);
    const playerLine = runtime.log.find((e) => e.kind === 'discovery' && ownerSeats.includes(e.visibility));
    expect(playerLine?.text).toContain('chimney smoke');
  });
});
