import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from './db/index.js';
import { Store } from './state/store.js';
import { Hub } from './ws/hub.js';
import { createApp, seatCookieName } from './http/app.js';
import { clearWikiCache, sanitizeWikiHtml, wikiApiEndpoint } from './http/wiki.js';
import type { CampaignRuntime, SeatRecord } from './state/runtime.js';

/**
 * The read-only wiki proxy behind the location detail dialog (#66):
 * endpoint derivation, caching, sanitization, and who is allowed to ask.
 */

let store: Store;
let runtime: CampaignRuntime;
let app: ReturnType<typeof createApp>;
let dmSeat: SeatRecord;

/** Minimal MediaWiki `action=parse&formatversion=2` payload. */
function parseResponse(title: string, html: string): Response {
  return new Response(JSON.stringify({ parse: { title, text: html } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearWikiCache();
  store = new Store(createTestDb());
  const created = store.createCampaign('Wiki Test', 'DM');
  runtime = created.runtime;
  dmSeat = created.dmSeat;
  app = createApp(store, new Hub());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setWiki(baseUrl: string): void {
  runtime.updateCampaign({ settings: { wikiBaseUrl: baseUrl } });
}

async function get(path: string, seat: SeatRecord | null = dmSeat): Promise<Response> {
  return await app.request(path, {
    headers: seat ? { Cookie: `${seatCookieName(runtime.id)}=${seat.token}` } : {},
  });
}

describe('wikiApiEndpoint', () => {
  it('derives api.php from the shapes a wikiBaseUrl actually takes', () => {
    expect(wikiApiEndpoint('https://wiki.example/index.php/')).toBe('https://wiki.example/api.php');
    expect(wikiApiEndpoint('https://wiki.example/index.php')).toBe('https://wiki.example/api.php');
    expect(wikiApiEndpoint('https://wiki.example/wiki/')).toBe('https://wiki.example/api.php');
    expect(wikiApiEndpoint('https://wiki.example/w/index.php/')).toBe(
      'https://wiki.example/w/api.php',
    );
    expect(wikiApiEndpoint('https://wiki.example/')).toBe('https://wiki.example/api.php');
    expect(wikiApiEndpoint('http://localhost:8080/wiki/')).toBe('http://localhost:8080/api.php');
    // Already an endpoint: left alone.
    expect(wikiApiEndpoint('https://wiki.example/w/api.php')).toBe('https://wiki.example/w/api.php');
  });

  it('returns null for empty, unparseable, or non-http base URLs', () => {
    expect(wikiApiEndpoint('')).toBeNull();
    expect(wikiApiEndpoint('   ')).toBeNull();
    expect(wikiApiEndpoint('not a url')).toBeNull();
    expect(wikiApiEndpoint('javascript:alert(1)')).toBeNull();
  });
});

describe('sanitizeWikiHtml', () => {
  it('strips scripts, styles, and inline handlers', () => {
    const dirty = `
      <p>Safe</p>
      <script>steal()</script>
      <style>body{display:none}</style>
      <div onclick="alert(1)" onmouseover='boom()'>Click</div>
      <img src="/img/a.png" onerror=bad()>
      <iframe src="https://evil.example"></iframe>
    `;
    const clean = sanitizeWikiHtml(dirty, 'https://wiki.example/api.php');
    expect(clean).toContain('Safe');
    expect(clean).not.toContain('steal()');
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<style/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/onmouseover/i);
    expect(clean).not.toMatch(/onerror/i);
  });

  it('defuses javascript: URLs and rebases wiki-relative links', () => {
    const clean = sanitizeWikiHtml(
      '<a href="javascript:alert(1)">x</a><a href="/index.php/Elturel">Elturel</a>',
      'https://wiki.example/api.php',
    );
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toContain('href="https://wiki.example/index.php/Elturel"');
  });
});

describe('GET /api/campaigns/:id/wiki-page', () => {
  it('proxies a page as sanitized HTML and caches the fetch', async () => {
    setWiki('https://wiki.example/index.php/');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        parseResponse('Elturel', '<p>The city of Elturel.</p><script>bad()</script>'),
      );
    vi.stubGlobal('fetch', fetchMock);

    const res = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; html: string };
    expect(body.title).toBe('Elturel');
    expect(body.html).toContain('The city of Elturel.');
    expect(body.html).not.toContain('bad()');

    // The request went to the derived endpoint with the parse query.
    const called = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(called.origin + called.pathname).toBe('https://wiki.example/api.php');
    expect(called.searchParams.get('action')).toBe('parse');
    expect(called.searchParams.get('page')).toBe('Elturel');
    expect(called.searchParams.get('redirects')).toBe('1');

    // Second read of the same page is served from the 5-minute cache.
    const again = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`);
    expect(again.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different page is a different cache key.
    await get(`/api/campaigns/${runtime.id}/wiki-page?title=Baldur%27s%20Gate`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads older installs that nest the HTML under text["*"]', async () => {
    setWiki('https://wiki.example/index.php/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ parse: { title: 'Old', text: { '*': '<p>Legacy</p>' } } }), {
          status: 200,
        }),
      ),
    );
    const res = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Old`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { html: string }).html).toContain('Legacy');
  });

  it('404s a missing page instead of throwing wiki HTML at the client', async () => {
    setWiki('https://wiki.example/index.php/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'missingtitle', info: 'The page does not exist.' } }),
          { status: 200 },
        ),
      ),
    );
    const res = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Nowhere`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({
      error: 'No wiki page named "Nowhere"',
    });
  });

  it('502s a transport failure with JSON, never an exception', async () => {
    setWiki('https://wiki.example/index.php/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const res = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not reach the wiki/i);
  });

  it('404s when the campaign has no wiki configured', async () => {
    setWiki('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'No wiki configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a full URL as a title (the proxy only ever talks to the wiki host)', async () => {
    setWiki('https://wiki.example/index.php/');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await get(
      `/api/campaigns/${runtime.id}/wiki-page?title=${encodeURIComponent('https://evil.example/x')}`,
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a title', async () => {
    setWiki('https://wiki.example/index.php/');
    const res = await get(`/api/campaigns/${runtime.id}/wiki-page`);
    expect(res.status).toBe(400);
  });

  it('401s without a seat cookie, and serves any seated member', async () => {
    setWiki('https://wiki.example/index.php/');
    const fetchMock = vi.fn().mockResolvedValue(parseResponse('Elturel', '<p>ok</p>'));
    vi.stubGlobal('fetch', fetchMock);

    const anon = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`, null);
    expect(anon.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    const playerSeat = runtime.createSeat('player', 'Alice');
    const asPlayer = await get(`/api/campaigns/${runtime.id}/wiki-page?title=Elturel`, playerSeat);
    expect(asPlayer.status).toBe(200);
  });

  it('404s an unknown campaign', async () => {
    const res = await get('/api/campaigns/nope/wiki-page?title=Elturel');
    expect(res.status).toBe(404);
  });
});
