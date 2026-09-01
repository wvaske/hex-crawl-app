/**
 * Read-only MediaWiki proxy (issue #66).
 *
 * The client cannot call a wiki's api.php directly (no CORS headers on a
 * typical MediaWiki install), so the server fetches the parsed HTML of a page
 * and hands it back sanitized. Reads need no credentials — the wiki is public
 * to anyone who can read it — so this is deliberately a fetch-and-cache with
 * no auth of its own; the route in `app.ts` requires a seat.
 *
 * The endpoint is derived from `campaign.settings.wikiBaseUrl` (DM-set), never
 * from anything the caller sends: the caller only chooses a page *title*, so
 * this can never be pointed at an arbitrary host.
 */

/** How long a fetched page stays in the in-memory cache. */
export const WIKI_CACHE_TTL_MS = 5 * 60 * 1000;

/** Give up on a slow wiki rather than holding a request open. */
const FETCH_TIMEOUT_MS = 8000;

export interface WikiPageResult {
  title: string;
  html: string;
}

export interface WikiErrorResult {
  error: string;
  status: 404 | 502;
}

export type WikiFetchResult = WikiPageResult | WikiErrorResult;

export function isWikiError(r: WikiFetchResult): r is WikiErrorResult {
  return 'error' in r;
}

/**
 * Derive the api.php endpoint from a campaign's wiki base URL — the same
 * setting that builds the human-facing links (`wikiHref` on the client).
 * Handles the common shapes:
 *
 *   https://wiki.example/index.php/   → https://wiki.example/api.php
 *   https://wiki.example/w/index.php/ → https://wiki.example/w/api.php
 *   https://wiki.example/wiki/        → https://wiki.example/api.php
 *   https://wiki.example/api.php      → unchanged
 *
 * Returns null when no wiki is configured or the URL is unusable.
 */
export function wikiApiEndpoint(wikiBaseUrl: string): string | null {
  const raw = (wikiBaseUrl ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toLowerCase();
  if (last === 'api.php') {
    return `${url.origin}/${segments.join('/')}`;
  }
  // Drop the page-serving segment ("index.php", "wiki", "w/index.php") so
  // what's left is the script directory api.php lives in.
  if (last === 'index.php' || last === 'wiki') segments.pop();
  const dir = segments.length ? `/${segments.join('/')}` : '';
  return `${url.origin}${dir}/api.php`;
}

interface CacheEntry {
  at: number;
  result: WikiFetchResult;
}

const cache = new Map<string, CacheEntry>();

/** Test hook: drop everything cached so far. */
export function clearWikiCache(): void {
  cache.clear();
}

/**
 * Fetch one page's parsed HTML, sanitized and cached for
 * {@link WIKI_CACHE_TTL_MS}. Never throws: transport and MediaWiki-level
 * failures come back as `{error, status}` so the route can answer JSON.
 */
export async function fetchWikiPage(endpoint: string, title: string): Promise<WikiFetchResult> {
  const key = `${endpoint}|${title}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < WIKI_CACHE_TTL_MS) return hit.result;

  const result = await fetchUncached(endpoint, title);
  cache.set(key, { at: Date.now(), result });
  return result;
}

async function fetchUncached(endpoint: string, title: string): Promise<WikiFetchResult> {
  const url = new URL(endpoint);
  url.searchParams.set('action', 'parse');
  url.searchParams.set('page', title);
  url.searchParams.set('prop', 'text');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('format', 'json');

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', 'User-Agent': 'hexcrawl-vtt/1.0 (wiki reader)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { error: `Could not reach the wiki (${describe(err)})`, status: 502 };
  }
  if (!res.ok) {
    return { error: `Wiki responded ${res.status}`, status: 502 };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { error: 'Wiki returned a non-JSON response', status: 502 };
  }

  const apiError = (body as { error?: { code?: string; info?: string } }).error;
  if (apiError) {
    const missing = apiError.code === 'missingtitle' || apiError.code === 'nosuchpageid';
    return {
      error: missing ? `No wiki page named "${title}"` : (apiError.info ?? 'Wiki request failed'),
      status: missing ? 404 : 502,
    };
  }

  const parse = (body as { parse?: { title?: string; text?: string | { '*'?: string } } }).parse;
  // formatversion=2 gives `text` as a string; older installs nest it under '*'.
  const text = typeof parse?.text === 'string' ? parse.text : parse?.text?.['*'];
  if (!parse || typeof text !== 'string') {
    return { error: 'Wiki returned no page content', status: 502 };
  }

  return { title: parse.title ?? title, html: sanitizeWikiHtml(text, endpoint) };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'timed out' : err.message;
  return 'unknown error';
}

/**
 * Strip the actively dangerous parts of wiki HTML before it reaches a
 * `dangerouslySetInnerHTML`. This is a regex sanitizer, not a parser: the wiki
 * is semi-trusted content authored by the DM's own table, and MediaWiki's
 * parser output is already tag-balanced. It removes script/style/iframe-class
 * elements, inline `on*` handlers, and `javascript:` URLs, and it absolutizes
 * wiki-relative links so they point back at the wiki instead of at this app.
 */
export function sanitizeWikiHtml(html: string, endpoint?: string): string {
  let out = html;
  // Elements whose *content* must go with them.
  out = out.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // Unclosed variants of the same, plus embedding/navigation elements.
  out = out.replace(
    /<\/?(script|style|noscript|template|iframe|frame|frameset|object|embed|applet|form|input|button|link|meta|base)\b[^>]*>/gi,
    '',
  );
  // Inline event handlers in any quoting style.
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  // javascript:/data: URLs in href/src.
  out = out.replace(
    /\s(href|src)\s*=\s*("|')?\s*(javascript|vbscript|data):[^"'>\s]*("|')?/gi,
    ' $1="#"',
  );

  if (endpoint) {
    try {
      const origin = new URL(endpoint).origin;
      // MediaWiki emits root-relative links ("/index.php/Foo"); rebase them on
      // the wiki so a click in the app leaves for the wiki, not a dead route.
      out = out.replace(/\s(href|src)\s*=\s*"\/(?!\/)/gi, ` $1="${origin}/`);
      out = out.replace(/\s(href|src)\s*=\s*'\/(?!\/)/gi, ` $1='${origin}/`);
    } catch {
      // Unparseable endpoint: leave the links as-is.
    }
  }
  return out;
}
