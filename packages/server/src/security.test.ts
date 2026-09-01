import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seededRng } from '@hexcrawl/shared';
import type { ClientCommand } from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { CampaignRuntime, type SeatRecord } from './state/runtime.js';
import { Hub } from './ws/hub.js';
import { dispatchCommand } from './ws/handlers.js';
import { createApp, type SecurityOptions } from './http/app.js';
import { RateLimiter, clientIp, dirSizeBytes, sniffImage } from './http/security.js';

/**
 * Public-instance hardening (issue #80): rate limits, invite-key rotation,
 * the campaign-creation gate, upload sniffing, and the per-campaign quota.
 * Kept out of server.test.ts on purpose — parallel appends there conflict.
 */

let store: Store;
let runtime: CampaignRuntime;
let dmSeat: SeatRecord;
let hub: Hub;
let uploadsDir: string;
let cmdCounter = 0;

/** Wide-open defaults so a test opts in to exactly the limit it exercises. */
const OPEN: SecurityOptions = {
  rateLimits: {
    create: { limit: 0, windowMs: 60_000 },
    import: { limit: 0, windowMs: 60_000 },
    join: { limit: 0, windowMs: 60_000 },
    export: { limit: 0, windowMs: 60_000 },
  },
};

function app(security: SecurityOptions = {}) {
  return createApp(store, hub, { uploadsDir, ...OPEN, ...security });
}

function dm(cmd: Omit<ClientCommand, 'id'>): void {
  dispatchCommand({ ...cmd, id: `c${cmdCounter++}` } as ClientCommand, {
    runtime,
    seat: dmSeat,
    hub,
    rng: seededRng(1),
  });
}

function dmCookie(): Record<string, string> {
  return { Cookie: `hc_seat_${runtime.id}=${dmSeat.token}` };
}

/** A valid PNG as far as the sniffer is concerned: real signature, junk body. */
function pngBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

async function upload(file: File, security: SecurityOptions = {}): Promise<Response> {
  const mapId = runtime.campaign.activeMapId!;
  const form = new FormData();
  form.append('file', file);
  return await app(security).request(`/api/campaigns/${runtime.id}/maps/${mapId}/images`, {
    method: 'POST',
    headers: dmCookie(),
    body: form,
  });
}

beforeEach(() => {
  store = new Store(createTestDb());
  const created = store.createCampaign('Test Campaign', 'The DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  hub = new Hub();
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-uploads-'));
});

afterEach(() => {
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

describe('rate limiter', () => {
  it('allows up to the limit, then denies until the window slides', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 3, windowMs: 60_000 }, () => now);
    expect(limiter.check('1.2.3.4').ok).toBe(true);
    expect(limiter.check('1.2.3.4').ok).toBe(true);
    expect(limiter.check('1.2.3.4').ok).toBe(true);
    const denied = limiter.check('1.2.3.4');
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSec).toBe(60);
    // A different IP has its own budget.
    expect(limiter.check('5.6.7.8').ok).toBe(true);
    // Still inside the window.
    now += 59_000;
    expect(limiter.check('1.2.3.4').ok).toBe(false);
    // Oldest hits age out.
    now += 2_000;
    expect(limiter.check('1.2.3.4').ok).toBe(true);
  });

  it('treats limit 0 as disabled', () => {
    const limiter = new RateLimiter({ limit: 0, windowMs: 1000 });
    for (let i = 0; i < 50; i++) expect(limiter.check('x').ok).toBe(true);
  });

  it('identifies clients by the first X-Forwarded-For hop, unless proxies are untrusted', () => {
    const req = new Request('http://x/', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    });
    expect(clientIp(req, '172.16.0.5', true)).toBe('9.9.9.9');
    expect(clientIp(req, '172.16.0.5', false)).toBe('172.16.0.5');
    expect(clientIp(new Request('http://x/'), null, true)).toBe('unknown');
  });
});

describe('rate limited endpoints', () => {
  it('429s repeated join attempts from one IP and recovers after the window', async () => {
    let now = 5_000_000;
    const limited = app({
      rateLimits: { join: { limit: 2, windowMs: 60_000 } },
      now: () => now,
    });
    const attempt = (key: string) =>
      limited.request(`/api/campaigns/${runtime.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
        body: JSON.stringify({ key, name: 'Mallory' }),
      });

    expect((await attempt('guess-1')).status).toBe(403);
    expect((await attempt('guess-2')).status).toBe(403);
    const blocked = await attempt('guess-3');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Too many requests/);

    // A different client is unaffected.
    const other = await limited.request(`/api/campaigns/${runtime.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.4' },
      body: JSON.stringify({ key: runtime.playerSecret, name: 'Alice' }),
    });
    expect(other.status).toBe(200);

    now += 61_000;
    expect((await attempt('guess-4')).status).toBe(403);
  });

  it('429s campaign creation, import, and export past their limits', async () => {
    const limited = app({
      rateLimits: {
        create: { limit: 1, windowMs: 60_000 },
        import: { limit: 1, windowMs: 60_000 },
        export: { limit: 1, windowMs: 60_000 },
      },
    });
    const create = () =>
      limited.request('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Spam', dmName: 'DM' }),
      });
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(429);

    const importOnce = () =>
      limited.request('/api/campaigns/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
    expect((await importOnce()).status).toBe(400);
    expect((await importOnce()).status).toBe(429);

    const exportUrl = `/api/campaigns/${runtime.id}/export?key=${runtime.dmSecret}`;
    expect((await limited.request(exportUrl)).status).toBe(200);
    expect((await limited.request(exportUrl)).status).toBe(429);
  });
});

describe('invite key rotation', () => {
  it('DM rotation invalidates the old player link but keeps existing seats', async () => {
    const player = runtime.createSeat('player', 'Alice');
    const oldKey = runtime.playerSecret;

    dm({ kind: 'campaign.rotateKey', which: 'player' } as never);
    const newKey = runtime.playerSecret;
    expect(newKey).not.toBe(oldKey);
    // DM key untouched by a player rotation.
    expect(runtime.dmSecret).toBe(store.getCampaign(runtime.id)!.dmSecret);

    const join = (key: string) =>
      app().request(`/api/campaigns/${runtime.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name: 'Bob' }),
      });
    expect((await join(oldKey)).status).toBe(403);
    expect((await join(newKey)).status).toBe(200);

    // The already-seated player keeps their cookie.
    const me = await app().request(`/api/campaigns/${runtime.id}/me`, {
      headers: { Cookie: `hc_seat_${runtime.id}=${player.token}` },
    });
    expect(me.status).toBe(200);
  });

  it('rotating the DM key invalidates integration Bearer tokens and ?key= export', async () => {
    const oldKey = runtime.dmSecret;
    const maps = (key: string) =>
      app().request(`/api/integration/campaigns/${runtime.id}/maps`, {
        headers: { Authorization: `Bearer ${key}` },
      });
    expect((await maps(oldKey)).status).toBe(200);

    dm({ kind: 'campaign.rotateKey', which: 'dm' } as never);
    const newKey = runtime.dmSecret;
    expect(newKey).not.toBe(oldKey);
    expect((await maps(oldKey)).status).toBe(401);
    expect((await maps(newKey)).status).toBe(200);

    expect(
      (await app().request(`/api/campaigns/${runtime.id}/export?key=${oldKey}`)).status,
    ).toBe(403);
    expect(
      (await app().request(`/api/campaigns/${runtime.id}/export?key=${newKey}`)).status,
    ).toBe(200);
    // The DM's own seat cookie still authorizes the download button.
    expect(
      (await app().request(`/api/campaigns/${runtime.id}/export`, { headers: dmCookie() })).status,
    ).toBe(200);
  });

  it('persists the new secret and refuses non-DM callers', () => {
    dm({ kind: 'campaign.rotateKey', which: 'dm' } as never);
    const reloaded = new Store((store as unknown as { db: never }).db).getCampaign(runtime.id)!;
    expect(reloaded.dmSecret).toBe(runtime.dmSecret);

    const player = runtime.createSeat('player', 'Mallory');
    expect(() =>
      dispatchCommand({ id: 'x', kind: 'campaign.rotateKey', which: 'dm' } as ClientCommand, {
        runtime,
        seat: player,
        hub,
        rng: seededRng(1),
      }),
    ).toThrow(/DM/);
  });
});

describe('campaign creation gate', () => {
  const create = (body: Record<string, unknown>, security: SecurityOptions = {}) =>
    app(security).request('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('is open when CREATE_PASSWORD is unset', async () => {
    const info = await app({ createPassword: '' }).request('/api/instance');
    expect((await info.json()) as { createGated: boolean }).toEqual({ createGated: false });
    expect((await create({ name: 'Open', dmName: 'DM' }, { createPassword: '' })).status).toBe(200);
  });

  it('requires the password when set', async () => {
    const security = { createPassword: 'let-me-in' };
    const info = await app(security).request('/api/instance');
    expect((await info.json()) as { createGated: boolean }).toEqual({ createGated: true });

    expect((await create({ name: 'Nope', dmName: 'DM' }, security)).status).toBe(403);
    expect(
      (await create({ name: 'Nope', dmName: 'DM', createPassword: 'wrong' }, security)).status,
    ).toBe(403);
    const ok = await create({ name: 'Yes', dmName: 'DM', createPassword: 'let-me-in' }, security);
    expect(ok.status).toBe(200);
  });

  it('gates restore-from-backup too (JSON and multipart)', async () => {
    const security = { createPassword: 'let-me-in' };
    const exported = await (
      await app().request(`/api/campaigns/${runtime.id}/export?key=${runtime.dmSecret}`)
    ).text();

    const noPassword = await app(security).request('/api/campaigns/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: exported,
    });
    expect(noPassword.status).toBe(403);

    const withPassword = await app(security).request('/api/campaigns/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JSON.parse(exported), createPassword: 'let-me-in' }),
    });
    expect(withPassword.status).toBe(200);

    const form = new FormData();
    form.append('file', new File([exported], 'backup.json', { type: 'application/json' }));
    const multipart = await app(security).request('/api/campaigns/import', {
      method: 'POST',
      body: form,
    });
    expect(multipart.status).toBe(403);

    const goodForm = new FormData();
    goodForm.append('file', new File([exported], 'backup.json', { type: 'application/json' }));
    goodForm.append('createPassword', 'let-me-in');
    const allowed = await app(security).request('/api/campaigns/import', {
      method: 'POST',
      body: goodForm,
    });
    expect(allowed.status).toBe(200);
  });
});

describe('upload hardening', () => {
  it('sniffs magic bytes', () => {
    expect(sniffImage(pngBytes())).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('rejects a fake PNG whose bytes are not an image', async () => {
    const fake = new File([new TextEncoder().encode('<script>alert(1)</script>')], 'map.png', {
      type: 'image/png',
    });
    const res = await upload(fake);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/PNG, JPEG, or WebP/);
    expect(fs.existsSync(path.join(uploadsDir, runtime.id))).toBe(false);
  });

  it('accepts a real PNG and names it by the sniffed type, not the client\'s', async () => {
    // Client lies about the type and extension; the bytes are a genuine PNG.
    const real = new File([pngBytes(128)], 'map.webp', { type: 'application/octet-stream' });
    const res = await upload(real);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layer: { path: string } };
    expect(body.layer.path).toMatch(/\.png$/);
    expect(dirSizeBytes(path.join(uploadsDir, runtime.id))).toBe(128);
  });

  it('enforces the per-campaign upload quota', async () => {
    const security = { uploadQuotaBytes: 300 };
    expect((await upload(new File([pngBytes(200)], 'a.png', { type: 'image/png' }), security)).status).toBe(200);
    const over = await upload(new File([pngBytes(200)], 'b.png', { type: 'image/png' }), security);
    expect(over.status).toBe(413);
    expect(((await over.json()) as { error: string }).error).toMatch(/quota/i);
    // The rejected upload wrote nothing.
    expect(dirSizeBytes(path.join(uploadsDir, runtime.id))).toBe(200);
    // Quota 0 disables the check.
    expect(
      (await upload(new File([pngBytes(200)], 'c.png', { type: 'image/png' }), { uploadQuotaBytes: 0 })).status,
    ).toBe(200);
  });
});
