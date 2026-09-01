import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { Content, ImageLayer } from '@hexcrawl/shared';
import { ContentTypeSchema, GateSchema, pixelToHex } from '@hexcrawl/shared';
import { evaluateKnowledge } from '../engine/knowledge.js';
import { evaluateTrails } from '../engine/trails.js';
import { fetchDdbCharacter, parseDdbId } from '../engine/ddb.js';
import { generateSettlementClues } from '../engine/settlements.js';
import { MAX_UPLOAD_BYTES, UPLOADS_DIR } from '../config.js';
import {
  MAX_IMPORT_BYTES,
  exportCampaignChunks,
  exportFileName,
  importCampaign,
} from './portability.js';
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

  // -- portability: export / import -----------------------------------------
  // Registered before the SPA fallback below; `/api/*` also gets an explicit
  // 404 so a wrong method or typo can never fall through to index.html.

  /**
   * Full campaign archive (rows + base64 images) as one JSON attachment.
   * Auth: DM seat cookie, or `?key=<dmSecret>` so cron/curl can pull it.
   */
  app.get('/api/campaigns/:id/export', (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const key = c.req.query('key');
    const seat = getSeat(c, runtime);
    if (key !== runtime.dmSecret && seat?.role !== 'dm') return c.json({ error: 'DM only' }, 403);
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${exportFileName(runtime.id)}"`);
    c.header('Cache-Control', 'no-store');
    return stream(c, async (s) => {
      for (const chunk of exportCampaignChunks(store.db, runtime.id, UPLOADS_DIR)) {
        await s.write(chunk);
      }
    });
  });

  /**
   * Restore an archive as a NEW campaign (fresh ids and invite keys) and seat
   * the caller as its DM. Accepts multipart (`file` field, from the Landing
   * page picker) or a raw JSON body (from curl).
   */
  app.post(
    '/api/campaigns/import',
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES,
      onError: (c) =>
        c.json({ error: `Backup too large (max ${MAX_IMPORT_BYTES / 1024 / 1024}MB)` }, 413),
    }),
    async (c) => {
      const contentType = c.req.header('Content-Type') ?? '';
      let raw: unknown;
      let dmName = 'DM';
      try {
        if (contentType.includes('multipart/form-data')) {
          const body = await c.req.parseBody();
          const file = body.file;
          if (!(file instanceof File)) return c.json({ error: 'No backup file' }, 400);
          if (typeof body.dmName === 'string' && body.dmName.trim()) {
            dmName = body.dmName.trim().slice(0, 60);
          }
          raw = JSON.parse(await file.text());
        } else {
          raw = await c.req.json();
        }
      } catch {
        return c.json({ error: 'Backup file is not valid JSON' }, 400);
      }

      let result;
      try {
        result = importCampaign(store.db, raw, { uploadsDir: UPLOADS_DIR });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 400);
      }
      store.forget(result.campaignId);
      const runtime = store.getCampaign(result.campaignId);
      if (!runtime) return c.json({ error: 'Import failed to load' }, 500);
      const dmSeat = runtime.createSeat('dm', dmName);
      setSeatCookie(c as never, runtime, dmSeat);
      return c.json({
        campaignId: runtime.id,
        dmKey: runtime.dmSecret,
        playerKey: runtime.playerSecret,
        imported: result.counts,
      });
    },
  );

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

  /**
   * Sync a character's skills from their PUBLIC D&D Beyond sheet.
   * DM or the seat that claimed the character.
   */
  app.post('/api/campaigns/:id/characters/:charId/sync-ddb', async (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const seat = getSeat(c, runtime);
    const charId = c.req.param('charId');
    const character = runtime.characters.get(charId);
    if (!character) return c.json({ error: 'Character not found' }, 404);
    if (!seat || (seat.role !== 'dm' && seat.characterId !== charId)) {
      return c.json({ error: 'Only the DM or the claiming player can sync' }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { ddbId?: string };
    const ddbId = body.ddbId ? parseDdbId(body.ddbId) : character.ddbId;
    if (!ddbId) return c.json({ error: 'No D&D Beyond character id or URL given' }, 400);
    try {
      const sync = await fetchDdbCharacter(ddbId);
      runtime.upsertCharacter({ ...character, skills: sync.skills, ddbId });
      hub.scheduleSync(runtime);
      return c.json({ name: sync.name, classes: sync.classes, level: sync.level, skills: sync.skills });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Sync failed' }, 502);
    }
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
      visible: true,
    };
    runtime.addImageLayer(layer);
    hub.scheduleSync(runtime);
    return c.json({ layer });
  });

  /**
   * DM only: one summary row per map for the map manager's thumbnails.
   * Snapshots only carry the viewed map's layers, so this fills the gap for
   * every other map without bloating (or leaking) the state sync.
   */
  app.get('/api/campaigns/:id/map-thumbs', (c) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return c.json({ error: 'Campaign not found' }, 404);
    const seat = getSeat(c, runtime);
    if (!seat || seat.role !== 'dm') return c.json({ error: 'DM only' }, 403);
    const maps = [...runtime.maps.values()].map((m) => ({
      mapId: m.id,
      image: runtime.imageLayersFor(m.id).find((l) => l.visible)?.path ?? null,
      hexCount: runtime.mapStates.get(m.id)?.hexes.size ?? 0,
    }));
    return c.json({ maps });
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

  // -- integration API (for dm-companion and friends) ------------------------
  // Auth: Authorization: Bearer <campaign dm key>. Campaign-scoped.

  const integrationAuth = (c: { req: { raw: Request; header(n: string): string | undefined; param(n: string): string } }) => {
    const runtime = store.getCampaign(c.req.param('id'));
    if (!runtime) return null;
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    return token === runtime.dmSecret ? runtime : null;
  };

  app.get('/api/integration/campaigns/:id/maps', (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    return c.json({
      maps: [...runtime.maps.values()].map((m) => ({
        id: m.id,
        name: m.name,
        milesPerHex: m.milesPerHex,
        hexSize: m.hexSize,
        orientation: m.orientation,
        originX: m.originX,
        originY: m.originY,
      })),
    });
  });

  app.get('/api/integration/campaigns/:id/maps/:mapId/content', (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    const rt = runtime.mapStates.get(c.req.param('mapId'));
    if (!rt) return c.json({ error: 'Map not found' }, 404);
    return c.json({ content: [...rt.contents.values()] });
  });

  const IntegrationContentSchema = z.object({
    mapId: z.string(),
    title: z.string().min(1).max(120),
    /** Pixel coordinates on the map image (wiki DataMap frame) — preferred. */
    x: z.number().optional(),
    y: z.number().optional(),
    /** Or explicit hex coordinates. */
    q: z.number().int().optional(),
    r: z.number().int().optional(),
    // Optional (no zod defaults): an omitted field must MERGE with the
    // existing content on update rather than reset to a default — defaults
    // here made `?? existing` dead code (issue #72 audit finding).
    type: ContentTypeSchema.optional(),
    glyph: z.string().max(8).default(''),
    dmNotes: z.string().max(10000).default(''),
    wikiPage: z.string().max(300).default(''),
    showLabel: z.boolean().optional(),
    scaleVisibility: z.number().int().min(0).max(2).optional(),
    enabled: z.boolean().optional(),
    knownLocation: z.boolean().optional(),
    quest: z.string().max(120).default(''),
    clues: z
      .array(
        z.object({
          text: z.string().min(1).max(2000),
          gate: GateSchema.default({ kind: 'auto' }),
          indicatesDirection: z.boolean().default(false),
          revealsLocation: z.boolean().default(true),
        }),
      )
      .default([]),
  });

  /** Upsert content by (mapId, title). Repeated syncs update in place. */
  app.post('/api/integration/campaigns/:id/content', async (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    const body = IntegrationContentSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid body' }, 400);
    const input = body.data;
    const map = runtime.maps.get(input.mapId);
    const rt = runtime.mapStates.get(input.mapId);
    if (!map || !rt) return c.json({ error: 'Map not found' }, 404);

    let q = input.q;
    let r = input.r;
    if ((q === undefined || r === undefined) && input.x !== undefined && input.y !== undefined) {
      const hex = pixelToHex(
        { orientation: map.orientation, size: map.hexSize, origin: { x: map.originX, y: map.originY } },
        { x: input.x, y: input.y },
      );
      q = hex.q;
      r = hex.r;
    }
    if (q === undefined || r === undefined) {
      return c.json({ error: 'Provide x/y pixel coordinates or q/r hex coordinates' }, 400);
    }

    const existing = [...rt.contents.values()].find(
      (ct) => ct.title.toLowerCase() === input.title.toLowerCase(),
    );
    const id = existing?.id ?? nanoid(10);
    const content: Content = {
      id,
      mapId: input.mapId,
      q,
      r,
      type: input.type ?? existing?.type ?? 'landmark',
      title: input.title,
      dmNotes: input.dmNotes || existing?.dmNotes || '',
      glyph: input.glyph || existing?.glyph || '',
      showLabel: input.showLabel ?? existing?.showLabel ?? false,
      scaleVisibility: input.scaleVisibility ?? existing?.scaleVisibility ?? 1,
      wikiPage: input.wikiPage || existing?.wikiPage || '',
      enabled: input.enabled ?? existing?.enabled ?? true,
      knownLocation: input.knownLocation ?? existing?.knownLocation ?? false,
      quest: input.quest || existing?.quest || '',
      clues: input.clues.length
        ? input.clues.map((cl, i) => ({
            id: nanoid(10),
            contentId: id,
            text: cl.text,
            gate: cl.gate,
            sortOrder: i,
            indicatesDirection: cl.indicatesDirection,
            revealsLocation: cl.revealsLocation,
          }))
        : (existing?.clues ?? []),
    };
    runtime.upsertContent(content);
    evaluateKnowledge(runtime, input.mapId);
    hub.scheduleSync(runtime);
    return c.json({ contentId: id, q, r, updated: Boolean(existing) });
  });

  /** Upsert a trail by (mapId, name): an ordered path of push-direction cells. */
  app.post('/api/integration/campaigns/:id/trails', async (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    const schema = z.object({
      mapId: z.string(),
      name: z.string().min(1).max(120),
      glyph: z.string().max(8).default('👣'),
      dmNotes: z.string().max(10000).default(''),
      gate: GateSchema.default({ kind: 'auto' }),
      cells: z.array(z.object({ q: z.number().int(), r: z.number().int() })).min(2),
    });
    const body = schema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'Invalid body' }, 400);
    const input = body.data;
    const rt = runtime.mapStates.get(input.mapId);
    if (!rt) return c.json({ error: 'Map not found' }, 404);
    const existing = [...rt.trails.values()].find(
      (t) => t.name.toLowerCase() === input.name.toLowerCase(),
    );
    const id = existing?.id ?? nanoid(10);
    runtime.upsertTrail({ ...input, id });
    evaluateTrails(runtime, input.mapId);
    hub.scheduleSync(runtime);
    return c.json({ trailId: id, cells: input.cells.length, updated: Boolean(existing) });
  });

  /** Generate the standard sensory clues for every settlement on a map. */
  app.post('/api/integration/campaigns/:id/generate-settlement-clues', async (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { mapId?: string };
    const mapId = body.mapId;
    if (!mapId || !runtime.maps.has(mapId)) return c.json({ error: 'Map not found' }, 404);
    const touched = generateSettlementClues(runtime, mapId);
    evaluateKnowledge(runtime, mapId);
    hub.scheduleSync(runtime);
    return c.json({ settlements: touched.length, titles: touched.map((t) => t.content.title) });
  });

  app.delete('/api/integration/campaigns/:id/content/:contentId', (c) => {
    const runtime = integrationAuth(c);
    if (!runtime) return c.json({ error: 'Unauthorized' }, 401);
    const removed = runtime.deleteContent(c.req.param('contentId'));
    if (!removed) return c.json({ error: 'Not found' }, 404);
    hub.scheduleSync(runtime);
    return c.json({ deleted: true });
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Unmatched API paths must 404 as JSON. Without this the SPA fallback below
  // answers any unknown GET with index.html — a typo'd or wrong-method API call
  // would silently look like a 200.
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  // -- production: serve the built client ------------------------------------
  // CLIENT_DIST points at packages/client/dist; any non-API GET falls back to
  // index.html so /c/:id deep links work.
  const clientDist = process.env.CLIENT_DIST ?? '';
  if (clientDist && fs.existsSync(path.join(clientDist, 'index.html'))) {
    const indexHtml = fs.readFileSync(path.join(clientDist, 'index.html'));
    app.get('*', (c) => {
      const url = new URL(c.req.url);
      const rel = url.pathname.replace(/^\/+/, '');
      const filePath = path.join(clientDist, rel);
      if (
        rel &&
        !rel.includes('..') &&
        filePath.startsWith(clientDist) &&
        fs.existsSync(filePath) &&
        fs.statSync(filePath).isFile()
      ) {
        return c.body(fs.readFileSync(filePath), 200, {
          'Content-Type': mimeFor(path.extname(filePath)),
          'Cache-Control': rel.startsWith('assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        });
      }
      return c.body(indexHtml, 200, { 'Content-Type': 'text/html; charset=utf-8' });
    });
  }

  return app;
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript';
    case '.css': return 'text/css';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.woff2': return 'font/woff2';
    case '.json': return 'application/json';
    default: return 'application/octet-stream';
  }
}
