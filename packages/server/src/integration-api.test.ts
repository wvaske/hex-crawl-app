import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { Hub } from './ws/hub.js';
import { createApp } from './http/app.js';
import type { CampaignRuntime } from './state/runtime.js';

let store: Store;
let runtime: CampaignRuntime;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new Store(createTestDb());
  runtime = store.createCampaign('Integration Test', 'DM').runtime;
  app = createApp(store, new Hub());
});

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
