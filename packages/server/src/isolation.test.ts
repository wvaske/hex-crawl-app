import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CharacterSchema, type ImageLayer } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { createApp, seatCookieName } from './http/app.js';
import { Store } from './state/store.js';
import type { SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';

let store: Store;
let campaign: ReturnType<Store['createCampaign']>;
let other: ReturnType<Store['createCampaign']>;
let player: SeatRecord;
let uploadsDir: string;
let app: ReturnType<typeof createApp>;
let layer: ImageLayer;
const bytes = Buffer.from('test image bytes');

function headers(seat: SeatRecord, campaignId = campaign.runtime.id) {
  return { Cookie: `${seatCookieName(campaignId)}=${seat.token}` };
}

beforeEach(() => {
  store = new Store(createTestDb());
  campaign = store.createCampaign('A', 'DM A');
  other = store.createCampaign('B', 'DM B');
  player = campaign.runtime.createSeat('player', 'Player A');
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-isolation-'));
  fs.mkdirSync(path.join(uploadsDir, campaign.runtime.id));
  fs.writeFileSync(path.join(uploadsDir, campaign.runtime.id, 'map.png'), bytes);
  layer = {
    id: 'layer', mapId: campaign.runtime.campaign.activeMapId!,
    path: `/uploads/${campaign.runtime.id}/map.png`, name: 'Map',
    x: 0, y: 0, scale: 1, opacity: 1, z: 0, dmOnly: false, visible: true,
  };
  campaign.runtime.addImageLayer(layer);
  app = createApp(store, new Hub(), { uploadsDir });
});

afterEach(() => {
  store.db.close();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

describe('campaign upload isolation (#164)', () => {
  it('rejects anonymous, forged, cross-campaign and invite-key requests', async () => {
    const attempts: Record<string, string>[] = [
      {}, headers(other.dmSeat, other.runtime.id), headers(other.dmSeat),
      { Authorization: `Bearer ${campaign.runtime.dmSecret}` },
    ];
    for (const requestHeaders of attempts) {
      const res = await app.request(layer.path, { headers: requestHeaders });
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(res.headers.get('ETag')).toBeNull();
    }
    expect((await app.request(`${layer.path}?key=${campaign.runtime.dmSecret}`)).status).toBe(401);
  });

  it('serves images to members with private revalidation, including HEAD', async () => {
    for (const seat of [campaign.dmSeat, player]) {
      const res = await app.request(layer.path, { headers: headers(seat) });
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
      expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
      expect(res.headers.get('Vary')).toBe('Cookie');
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const etag = res.headers.get('ETag')!;
      expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
      const cached = await app.request(layer.path, {
        headers: { ...headers(seat), 'If-None-Match': `"old", W/${etag}` },
      });
      expect(cached.status).toBe(304);
      expect(cached.headers.get('Cache-Control')).toBe('private, no-cache');
    }
    expect((await app.request(layer.path, { method: 'HEAD' })).status).toBe(401);
    const head = await app.request(layer.path, { method: 'HEAD', headers: headers(player) });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('rechecks authorization before a cached response after permissions change', async () => {
    const res = await app.request(layer.path, { headers: headers(player) });
    const cachedHeaders = { ...headers(player), 'If-None-Match': res.headers.get('ETag')! };
    campaign.runtime.updateImageLayer(layer.id, { dmOnly: true });
    expect((await app.request(layer.path, { headers: cachedHeaders })).status).toBe(403);
    expect((await app.request(layer.path, { headers: { 'If-None-Match': '*' } })).status).toBe(401);
    expect((await app.request(layer.path, { headers: headers(campaign.dmSeat) })).status).toBe(200);
    campaign.runtime.updateImageLayer(layer.id, { dmOnly: false, visible: false });
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(403);
    campaign.runtime.deleteImageLayer(layer.id);
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(403);
  });

  it('denies duplicate public references to a DM-only file and honors DM preview', async () => {
    campaign.runtime.addImageLayer({ ...layer, id: 'secret-layer', dmOnly: true });
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(403);
    campaign.runtime.upsertCharacter(CharacterSchema.parse({
      id: 'ranger', name: 'Ranger', color: '#00ff00', glyph: 'R', skills: {},
    }));
    campaign.runtime.setViewAs(campaign.dmSeat.id, 'ranger');
    expect((await app.request(layer.path, { headers: headers(campaign.dmSeat) })).status).toBe(403);
  });

  it('preserves the frozen player baseline and denies newly revealed prep images', async () => {
    campaign.runtime.capturePlayerFreeze();
    campaign.runtime.updateCampaign({ settings: { pausePlayerMapSync: true } });
    campaign.runtime.updateImageLayer(layer.id, { visible: false });
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(200);
    fs.writeFileSync(path.join(uploadsDir, campaign.runtime.id, 'new.png'), bytes);
    const next = { ...layer, id: 'new', path: `/uploads/${campaign.runtime.id}/new.png` };
    campaign.runtime.addImageLayer(next);
    expect((await app.request(next.path, { headers: headers(player) })).status).toBe(403);
    campaign.runtime.updateImageLayer(layer.id, { dmOnly: true });
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(403);
    campaign.runtime.updateCampaign({ settings: { pausePlayerMapSync: false } });
    expect((await app.request(next.path, { headers: headers(player) })).status).toBe(200);
  });

  it('revokes file access when a seat is removed, without leaking file existence', async () => {
    campaign.runtime.seats.delete(player.id);
    expect((await app.request(layer.path, { headers: headers(player) })).status).toBe(401);
    expect((await app.request(`/uploads/${campaign.runtime.id}/missing.png`)).status).toBe(401);
    expect((await app.request('/uploads/missing/map.png')).status).toBe(401);
    expect((await app.request(`/uploads/${campaign.runtime.id}/missing.png`, {
      headers: headers(campaign.dmSeat),
    })).status).toBe(404);
  });
});
