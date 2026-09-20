import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  definePluginManifest,
  filterStateForViewer,
  resolvePluginConfig,
  seededRng,
  type ClientCommand,
} from '@hexcrawl/shared';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { Hub } from './ws/hub.js';
import { exportCampaign, importCampaign } from './http/portability.js';
import { dispatchCommand } from './ws/handlers.js';
import { resetWikiBotSessions } from './engine/wikiBot.js';
import { PluginError, actionsFor, defineServerPlugin, wikiEscape, wikiTitlePart } from './plugins/api.js';
import { setInstalledPlugins } from './plugins/registry.js';
import { createPluginTestBed, type PluginTestBed } from './plugins/testing.js';

/**
 * The plugin host (plugins/AGENTS.md): who may call an action, what a plugin
 * can store, how its settings are sanitized and hidden from players, and the
 * wiki writer plugins publish through.
 */

const manifest = definePluginManifest({
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '0.0.1',
  description: 'fixture',
  usesWiki: true,
  config: [
    { key: 'limit', label: 'Limit', type: 'number', default: 3, min: 1, max: 10 },
    { key: 'page', label: 'Page', type: 'text', default: 'Log' },
    { key: 'mode', label: 'Mode', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  ],
});

const action = actionsFor<{ limit: number; page: string; mode: string }>();

const plugin = defineServerPlugin({
  manifest,
  actions: {
    whoami: action({
      handler: (ctx) => ({ isDm: ctx.isDm, character: ctx.character?.name ?? null, config: ctx.config }),
    }),
    bump: action({
      input: z.object({ characterId: z.string(), by: z.number().int().min(1).default(1) }),
      handler: (ctx, input) => {
        const c = ctx.requireCharacterAccess(input.characterId);
        const next = (ctx.storage.get<number>(`count:${c.id}`) ?? 0) + input.by;
        if (next > ctx.config.limit) throw new PluginError('Over the limit', 409);
        ctx.storage.set(`count:${c.id}`, next);
        ctx.log(`${c.name} bumps to ${next}`, { toast: true });
        ctx.notify('counts');
        return { count: next, dice: ctx.rollDice(2, 6) };
      },
    }),
    secret: action({ dmOnly: true, handler: () => 'dm eyes only' }),
    publish: action({
      input: z.object({ text: z.string() }),
      handler: (ctx, input) => ctx.wiki.append(ctx.config.page, `\n* ${wikiEscape(input.text)}`),
    }),
    boom: action({
      handler: () => {
        throw new Error('kaboom');
      },
    }),
  },
});

let bed: PluginTestBed;

afterEach(() => {
  bed?.dispose();
  resetWikiBotSessions();
  vi.unstubAllGlobals();
});

describe('plugin actions', () => {
  beforeEach(() => {
    bed = createPluginTestBed(plugin, { config: { limit: 2 } });
  });

  it('runs an action with the viewer, their character and the resolved config', async () => {
    const ana = bed.addPlayer('Ana', 'Ser Ana');
    const asDm = await bed.call<{ isDm: boolean; character: string | null; config: unknown }>('whoami');
    expect(asDm.result).toEqual({ isDm: true, character: null, config: { limit: 2, page: 'Log', mode: 'a' } });
    const asPlayer = await bed.call<{ isDm: boolean; character: string | null }>('whoami', {}, ana.seat);
    expect(asPlayer.result).toMatchObject({ isDm: false, character: 'Ser Ana' });
  });

  it('requires a seat, a known action, and an enabled plugin', async () => {
    expect((await bed.call('whoami', {}, null)).status).toBe(401);
    expect((await bed.call('nope')).status).toBe(404);
    expect((await bed.call('constructor')).status).toBe(404);
    bed.runtime.updateCampaign({ settings: { plugins: { 'test-plugin': { enabled: false } } } });
    const off = await bed.call('whoami');
    expect(off.status).toBe(403);
    expect(off.error).toMatch(/not enabled/);
  });

  it('enforces dmOnly and character ownership', async () => {
    const ana = bed.addPlayer('Ana');
    const bo = bed.addPlayer('Bo');
    expect((await bed.call('secret', {}, ana.seat)).status).toBe(403);
    expect((await bed.call('secret')).result).toBe('dm eyes only');
    // Ana may not act for Bo's character; the DM may act for anyone.
    expect((await bed.call('bump', { characterId: bo.character.id }, ana.seat)).status).toBe(403);
    expect((await bed.call('bump', { characterId: bo.character.id })).status).toBe(200);
    expect((await bed.call('bump', { characterId: 'ghost' })).status).toBe(404);
  });

  it('validates input with the action schema and names the bad field', async () => {
    const ana = bed.addPlayer('Ana');
    const bad = await bed.call('bump', { characterId: ana.character.id, by: 0 }, ana.seat);
    expect(bad.status).toBe(400);
    expect(bad.error).toMatch(/^Invalid input — by:/);
  });

  it('turns PluginError into its status and hides unexpected errors behind a 500', async () => {
    const ana = bed.addPlayer('Ana');
    await bed.call('bump', { characterId: ana.character.id, by: 2 }, ana.seat);
    const over = await bed.call('bump', { characterId: ana.character.id }, ana.seat);
    expect(over).toMatchObject({ status: 409, error: 'Over the limit' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = await bed.call('boom');
    expect(boom.status).toBe(500);
    expect(boom.error).toBe('Test Plugin: kaboom');
    spy.mockRestore();
  });

  it('logs to the game log and notifies clients', async () => {
    const ana = bed.addPlayer('Ana');
    const res = await bed.call<{ dice: number[] }>('bump', { characterId: ana.character.id }, ana.seat);
    expect(res.result.dice).toHaveLength(2);
    for (const d of res.result.dice) expect(d).toBeGreaterThanOrEqual(1), expect(d).toBeLessThanOrEqual(6);
    const entry = bed.runtime.log.at(-1)!;
    expect(entry).toMatchObject({ kind: 'plugin', text: 'Ana bumps to 1', visibility: 'all' });
    expect(entry.data).toMatchObject({ plugin: 'test-plugin', pluginName: 'Test Plugin', toast: true });
    expect(bed.sent).toContainEqual({ type: 'event', kind: 'plugin.changed', pluginId: 'test-plugin', topic: 'counts' });
    expect(bed.sent.some((m) => m.type === 'event' && m.kind === 'log.appended')).toBe(true);
  });
});

describe('plugin storage', () => {
  it('is per plugin, hands out copies, and survives a reload from the database', () => {
    setInstalledPlugins([plugin]);
    const store = new Store(createTestDb());
    const { runtime } = store.createCampaign('Storage', 'DM');
    runtime.setPluginData('a', 'char:1', { spent: 1, rolls: [4] });
    runtime.setPluginData('a', 'char:2', { spent: 0, rolls: [] });
    runtime.setPluginData('a', 'other', 'x');
    runtime.setPluginData('b', 'char:1', 'b-owned');

    const read = runtime.getPluginData('a', 'char:1') as { rolls: number[] };
    read.rolls.push(99); // mutating what you read must not reach the cache
    expect(runtime.getPluginData('a', 'char:1')).toEqual({ spent: 1, rolls: [4] });
    expect(runtime.listPluginData('a', 'char:')).toEqual(['char:1', 'char:2']);

    runtime.setPluginData('a', 'char:2', undefined);
    store.forget(runtime.id);
    const reloaded = store.getCampaign(runtime.id)!;
    expect(reloaded.listPluginData('a')).toEqual(['char:1', 'other']);
    expect(reloaded.getPluginData('a', 'char:1')).toEqual({ spent: 1, rolls: [4] });
    expect(reloaded.getPluginData('b', 'char:1')).toBe('b-owned');
    setInstalledPlugins();
  });

  it('rides along in a backup, re-keyed to the restored characters', () => {
    bed = createPluginTestBed(plugin);
    const ana = bed.addPlayer('Ana');
    bed.runtime.setPluginData('test-plugin', `char:${ana.character.id}`, { owner: ana.character.id, spent: 2 });
    bed.runtime.setSecret('wikiBot', '{"username":"u","password":"hunter2"}');
    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'hexcrawl-plugins-'));
    const db = bed.store.db;

    const archive = exportCampaign(db, bed.runtime.id, uploads);
    expect(JSON.stringify(archive)).not.toContain('hunter2');
    const restored = bed.store.getCampaign(importCampaign(db, archive, { uploadsDir: uploads }).campaignId)!;
    const newAna = [...restored.characters.values()].find((c) => c.name === 'Ana')!;
    expect(newAna.id).not.toBe(ana.character.id);
    expect(restored.getPluginData('test-plugin', `char:${newAna.id}`)).toEqual({ owner: newAna.id, spent: 2 });
    expect(restored.campaign.settings.plugins['test-plugin']?.enabled).toBe(true);
  });

  it('keeps integration secrets readable after a reload', () => {
    const store = new Store(createTestDb());
    const { runtime } = store.createCampaign('Secrets', 'DM');
    runtime.setSecret('wikiBot', '{"username":"u","password":"p"}');
    store.forget(runtime.id);
    expect(store.getCampaign(runtime.id)!.getSecret('wikiBot')).toContain('"username":"u"');
    store.getCampaign(runtime.id)!.setSecret('wikiBot', null);
    store.forget(runtime.id);
    expect(store.getCampaign(runtime.id)!.getSecret('wikiBot')).toBeNull();
  });
});

describe('plugin settings', () => {
  it('resolves config against the manifest: defaults, clamps, unknown keys dropped', () => {
    expect(resolvePluginConfig(manifest, undefined)).toEqual({ limit: 3, page: 'Log', mode: 'a' });
    expect(
      resolvePluginConfig(manifest, { limit: 99, page: 7, mode: 'zzz', injected: 'x' }),
    ).toEqual({ limit: 10, page: 'Log', mode: 'a' });
    expect(resolvePluginConfig(manifest, { limit: 4, page: 'Deeds', mode: 'b' })).toEqual({
      limit: 4,
      page: 'Deeds',
      mode: 'b',
    });
  });

  it('sanitizes campaign.update patches, merges per plugin, and is DM only', () => {
    bed = createPluginTestBed(plugin, { enabled: false });
    const ana = bed.addPlayer('Ana');
    const ctx = { runtime: bed.runtime, hub: new Hub(), rng: seededRng(1) };
    const update = (seat: typeof bed.dmSeat, plugins: Record<string, unknown>) =>
      dispatchCommand({ id: 'c', kind: 'campaign.update', settings: { plugins } } as ClientCommand, { ...ctx, seat });

    update(bed.dmSeat, {
      'test-plugin': { enabled: true, config: { limit: 500, rogue: true } },
      'not-installed': { enabled: true },
    });
    expect(bed.runtime.campaign.settings.plugins).toEqual({
      'test-plugin': { enabled: true, config: { limit: 10, page: 'Log', mode: 'a' } },
    });
    // A config-only patch leaves `enabled` alone, and vice versa.
    update(bed.dmSeat, { 'test-plugin': { config: { page: 'Deeds' } } });
    update(bed.dmSeat, { 'test-plugin': { enabled: true } });
    expect(bed.runtime.campaign.settings.plugins['test-plugin']).toEqual({
      enabled: true,
      config: { limit: 3, page: 'Deeds', mode: 'a' },
    });
    expect(() => update(ana.seat, { 'test-plugin': { enabled: false } })).toThrow();
  });

  it('shows players which plugins are on, never their config', () => {
    bed = createPluginTestBed(plugin, { config: { page: 'DM Secret Log' } });
    const ana = bed.addPlayer('Ana');
    const full = bed.runtime.buildFullState(null);
    const dmView = filterStateForViewer(full, { seatId: bed.dmSeat.id, role: 'dm', characterId: null });
    const playerView = filterStateForViewer(full, {
      seatId: ana.seat.id,
      role: 'player',
      characterId: ana.character.id,
    });
    expect(dmView.campaign.settings.plugins['test-plugin']?.config).toMatchObject({ page: 'DM Secret Log' });
    expect(playerView.campaign.settings.plugins['test-plugin']).toEqual({ enabled: true, config: {} });
    expect(JSON.stringify(playerView)).not.toContain('DM Secret Log');
  });
});

describe('wikitext helpers', () => {
  it('neutralizes markup and nested nowiki, and cleans titles', () => {
    expect(wikiEscape('{{Delete}} [[x]]')).toBe('<nowiki>{{Delete}} [[x]]</nowiki>');
    expect(wikiEscape('a</nowiki>{{b}}')).toBe('<nowiki>a&lt;/nowiki>{{b}}</nowiki>');
    expect(wikiTitlePart('  Ser [Ana] | of_the #Vale\n')).toBe('Ser Ana of the Vale');
  });
});

// -- wiki writer --------------------------------------------------------------

/** A MediaWiki just real enough: login, csrf tokens, edits, revisions. */
function stubWiki(opts: { failFirstEditWith?: string } = {}) {
  const pages = new Map<string, string>();
  const calls: string[] = [];
  let logins = 0;
  let failNext = opts.failFirstEditWith ?? null;
  const json = (body: unknown, cookie?: string) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const p = init?.body instanceof URLSearchParams ? init.body : u.searchParams;
      const cookies = String((init?.headers as Record<string, string> | undefined)?.Cookie ?? '');
      const act = p.get('action');
      calls.push(`${act}${p.get('type') ? `:${p.get('type')}` : ''}`);
      if (act === 'query' && p.get('meta') === 'tokens') {
        return p.get('type') === 'login'
          ? json({ query: { tokens: { logintoken: 'LT' } } }, 'wiki_session=anon; Path=/; HttpOnly')
          : json({ query: { tokens: { csrftoken: `CSRF${logins}` } } });
      }
      if (act === 'login') {
        if (p.get('lgpassword') !== 'hunter2' || p.get('lgtoken') !== 'LT') {
          return json({ login: { result: 'Failed', reason: 'Incorrect username or password' } });
        }
        logins++;
        return json({ login: { result: 'Success' } }, `wiki_session=s${logins}; Path=/`);
      }
      if (act === 'edit') {
        if (!cookies.includes(`wiki_session=s${logins}`)) return json({ error: { code: 'assertuserfailed' } });
        if (failNext) {
          const code = failNext;
          failNext = null;
          return json({ error: { code, info: code } });
        }
        if (p.get('token') !== `CSRF${logins}`) return json({ error: { code: 'badtoken', info: 'Invalid token' } });
        const title = p.get('title')!;
        const before = pages.get(title) ?? '';
        pages.set(title, p.has('appendtext') ? before + p.get('appendtext') : (p.get('text') ?? ''));
        return json({ edit: { result: 'Success', title, newrevid: pages.size } });
      }
      if (act === 'query' && p.get('prop') === 'revisions') {
        const title = p.get('titles')!;
        return json({
          query: {
            pages: [pages.has(title) ? { revisions: [{ slots: { main: { content: pages.get(title) } } }] } : { missing: true }],
          },
        });
      }
      return json({ error: { code: 'unknown', info: 'unhandled' } });
    }),
  );
  return { pages, calls, logins: () => logins };
}

describe('wiki write access', () => {
  const WIKI = 'https://wiki.example/index.php/';

  const storeLogin = (b: PluginTestBed, password: string) =>
    b.request(`/api/campaigns/${b.runtime.id}/integrations/wiki/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'DM@hexcrawl', password }),
    });

  it('verifies a bot login before keeping it, and never echoes the password', async () => {
    stubWiki();
    bed = createPluginTestBed(plugin, { wikiBaseUrl: WIKI });
    const bad = await storeLogin(bed, 'wrong');
    expect(bad.status).toBe(502);
    expect(bed.runtime.getSecret('wikiBot')).toBeNull();
    const ana = bed.addPlayer('Ana');
    const asPlayer = await bed.request(
      `/api/campaigns/${bed.runtime.id}/integrations/wiki/secret`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"u","password":"p"}' },
      ana.seat,
    );
    expect(asPlayer.status).toBe(403);

    const ok = await storeLogin(bed, 'hunter2');
    expect(ok.status).toBe(200);
    const body = await ok.text();
    expect(JSON.parse(body)).toEqual({ hasWiki: true, canWrite: true, username: 'DM@hexcrawl' });
    expect(body).not.toContain('hunter2');
    // Not in the snapshot or the DM's state either.
    expect(JSON.stringify(bed.runtime.buildFullState(null))).not.toContain('hunter2');
  });

  it('appends through one login, and escapes what players typed', async () => {
    const wiki = stubWiki();
    bed = createPluginTestBed(plugin, { wikiBaseUrl: WIKI, config: { page: 'Deeds' } });
    bed.runtime.setSecret('wikiBot', JSON.stringify({ username: 'DM@hexcrawl', password: 'hunter2' }));
    const ana = bed.addPlayer('Ana');

    const first = await bed.call<{ url: string }>('publish', { text: 'one {{Delete}}' }, ana.seat);
    expect(first.status).toBe(200);
    expect(first.result.url).toBe('https://wiki.example/index.php/Deeds');
    await bed.call('publish', { text: 'two' }, ana.seat);
    expect(wiki.pages.get('Deeds')).toBe('\n* <nowiki>one {{Delete}}</nowiki>\n* <nowiki>two</nowiki>');
    expect(wiki.logins()).toBe(1);
  });

  it('logs in again when the wiki forgets the session', async () => {
    const wiki = stubWiki({ failFirstEditWith: 'assertuserfailed' });
    bed = createPluginTestBed(plugin, { wikiBaseUrl: WIKI });
    bed.runtime.setSecret('wikiBot', JSON.stringify({ username: 'DM@hexcrawl', password: 'hunter2' }));
    const res = await bed.call('publish', { text: 'still lands' });
    expect(res.status).toBe(200);
    expect(wiki.logins()).toBe(2);
    expect(wiki.pages.get('Log')).toContain('still lands');
  });

  it('answers with a readable 400 when no bot login is stored', async () => {
    stubWiki();
    bed = createPluginTestBed(plugin, { wikiBaseUrl: WIKI });
    const res = await bed.call('publish', { text: 'x' });
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/No wiki bot login/);
  });
});
