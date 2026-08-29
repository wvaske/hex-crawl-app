import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { ImageLayer } from '@hexcrawl/shared';
import { MAX_UPLOAD_BYTES, UPLOADS_DIR } from '../config.js';
import type { Store } from '../state/store.js';
import type { CampaignRuntime, SeatRecord } from '../state/runtime.js';
import type { Hub } from '../ws/hub.js';

export function seatCookieName(campaignId: string): string {
  return `hc_seat_${campaignId}`;
}

const IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export function createApp(store: Store, hub: Hub): Hono {
  const app = new Hono();

  const getSeat = (c: { req: { raw: Request } }, runtime: CampaignRuntime): SeatRecord | null => {
    const token = getCookie(c as never, seatCookieName(runtime.id)) ?? null;
    return store.findSeatByToken(runtime, token);
  };

  const setSeatCookie = (c: never, runtime: CampaignRuntime, seat: SeatRecord): void => {
    setCookie(c, seatCookieName(runtime.id), seat.token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  };

  // -- campaign lifecycle ----------------------------------------------------

  app.post('/api/campaigns', async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(120), dmName: z.string().min(1).max(60).default('DM') })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Campaign name required' }, 400);
    const { runtime, dmSeat } = store.createCampaign(body.data.name, body.data.dmName);
    setSeatCookie(c as never, runtime, dmSeat);
    return c.json({
      campaignId: runtime.id,
      dmKey: runtime.dmSecret,
      playerKey: runtime.playerSecret,
    });
  });

  app.get('/api/campaigns/:id', (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const key = c.req.query('key') ?? null;
    const keyRole =
      key === runtime.dmSecret ? 'dm' : key === runtime.playerSecret ? 'player' : null;
    const seat = getSeat(c, runtime);
    return c.json({
      campaignId: runtime.id,
      name: runtime.campaign.name,
      description: runtime.campaign.settings.description,
      keyRole,
      seat: seat
        ? { id: seat.id, role: seat.role, name: seat.name, characterId: seat.characterId }
        : null,
      characters: [...runtime.characters.values()].map((ch) => ({
        id: ch.id,
        name: ch.name,
        color: ch.color,
        glyph: ch.glyph,
        claimedBy:
          [...runtime.seats.values()].find((s) => s.characterId === ch.id)?.name ?? null,
      })),
    });
  });

  app.post('/api/campaigns/:id/join', async (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const body = z
      .object({ key: z.string(), name: z.string().min(1).max(60) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Name required' }, 400);
    const role =
      body.data.key === runtime.dmSecret
        ? 'dm'
        : body.data.key === runtime.playerSecret
          ? 'player'
          : null;
    if (!role) return c.json({ error: 'Invalid invite link' }, 403);
    // Reuse an existing seat if this browser already has one.
    const existing = getSeat(c, runtime);
    if (existing && (existing.role === role || existing.role === 'dm')) {
      return c.json({ seatId: existing.id, role: existing.role });
    }
    const seat = runtime.createSeat(role, body.data.name);
    setSeatCookie(c as never, runtime, seat);
    hub.scheduleSync(runtime);
    return c.json({ seatId: seat.id, role: seat.role });
  });

  /** DM key holders can retrieve the player invite key. */
  app.get('/api/campaigns/:id/keys', (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const key = c.req.query('key');
    const seat = getSeat(c, runtime);
    if (key !== runtime.dmSecret && seat?.role !== 'dm') {
      return c.json({ error: 'DM only' }, 403);
    }
    return c.json({ dmKey: runtime.dmSecret, playerKey: runtime.playerSecret });
  });

  app.get('/api/campaigns/:id/me', (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const seat = getSeat(c, runtime);
    if (!seat) return c.json({ error: 'No seat' }, 401);
    return c.json({ seatId: seat.id, role: seat.role, name: seat.name, characterId: seat.characterId });
  });

  // -- image upload ----------------------------------------------------------

  app.post('/api/campaigns/:id/maps/:mapId/images', async (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const seat = getSeat(c, runtime);
    if (!seat || seat.role !== 'dm') return c.json({ error: 'DM only' }, 403);
    const mapId = c.req.param('mapId');
    if (!runtime.maps.has(mapId)) return c.json({ error: 'Map not found' }, 404);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file' }, 400);
    const ext = IMAGE_TYPES[file.type];
    if (!ext) return c.json({ error: 'Only PNG, JPEG, or WebP images' }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `Image too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` }, 400);
    }

    const dir = path.join(UPLOADS_DIR, runtime.id);
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${nanoid(12)}${ext}`;
    fs.writeFileSync(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));

    const existing = runtime.imageLayersFor(mapId);
    const layer: ImageLayer = {
      id: nanoid(10),
      mapId,
      path: `/uploads/${runtime.id}/${fileName}`,
      name: file.name || 'Map image',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      z: existing.length,
      dmOnly: false,
    };
    runtime.addImageLayer(layer);
    hub.scheduleSync(runtime);
    return c.json({ layer });
  });

  // -- uploaded files (images are not secret; ids are unguessable) -----------

  app.get('/uploads/:campaignId/:file', (c) => {
    const campaignId = c.req.param('campaignId');
    const file = c.req.param('file');
    if (!/^[\w-]+$/.test(campaignId) || !/^[\w-]+\.\w+$/.test(file)) {
      return c.text('Bad path', 400);
    }
    const filePath = path.join(UPLOADS_DIR, campaignId, file);
    if (!fs.existsSync(filePath)) return c.text('Not found', 404);
    const ext = path.extname(filePath);
    const mime =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return c.body(fs.readFileSync(filePath), 200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  return app;
}
