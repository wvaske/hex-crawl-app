import type { CampaignRuntime } from '../state/runtime.js';
import { invalidateWikiPage, wikiApiEndpoint } from '../http/wiki.js';

/**
 * Wiki WRITE access, for plugins (plugins/AGENTS.md). The read proxy in
 * `http/wiki.ts` is anonymous; writing needs an account, so the DM stores a
 * MediaWiki bot login (Special:BotPasswords) per campaign in
 * `integration_secret` under `wikiBot`. It never reaches a snapshot or an
 * export, and the target host is still derived from the DM's `wikiBaseUrl`
 * setting — a caller only ever chooses a page title.
 *
 * MediaWiki sessions die without notice (expiry, a memcached restart), so every
 * write retries once through a fresh login when the wiki answers with a
 * session-shaped error.
 */

export const WIKI_BOT_SECRET = 'wikiBot';
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'hexcrawl-vtt/1.0 (wiki writer)';

/** Error codes that mean "log in again", not "your edit is wrong". */
const SESSION_ERRORS = new Set([
  'badtoken',
  'notloggedin',
  'assertuserfailed',
  'assertbotfailed',
  'readapidenied',
]);

export interface WikiBotCredentials {
  username: string;
  password: string;
}

export class WikiError extends Error {
  constructor(
    message: string,
    readonly code: string = 'wiki',
  ) {
    super(message);
  }
}

export interface WikiEditResult {
  title: string;
  /** Null when the edit changed nothing (MediaWiki's `nochange`). */
  revisionId: number | null;
  /** Human-facing URL of the page, built from the campaign's wikiBaseUrl. */
  url: string;
}

export type WikiEditMode = 'replace' | 'append' | 'prepend';

export interface WikiEditOptions {
  summary?: string;
  /** Fail instead of overwriting when the page already exists. */
  createOnly?: boolean;
  /** Add a `== section ==` to the end of the page instead of raw text (append mode). */
  sectionTitle?: string;
}

interface Session {
  endpoint: string;
  username: string;
  cookies: Map<string, string>;
  csrf: string | null;
}

/** One session per campaign, and one write at a time (appends must not race). */
const sessions = new Map<string, Session>();
const queues = new Map<string, Promise<unknown>>();

/** Test hook. */
export function resetWikiBotSessions(): void {
  sessions.clear();
  queues.clear();
}

export function readWikiBotCredentials(runtime: CampaignRuntime): WikiBotCredentials | null {
  const raw = runtime.getSecret(WIKI_BOT_SECRET);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WikiBotCredentials>;
    if (typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      return { username: parsed.username, password: parsed.password };
    }
  } catch {
    // fall through
  }
  return null;
}

export interface WikiBotStatus {
  /** A wiki URL is set on the campaign. */
  hasWiki: boolean;
  /** A bot login is stored, so writes can be attempted. */
  canWrite: boolean;
  username: string | null;
}

export function wikiBotStatus(runtime: CampaignRuntime): WikiBotStatus {
  const creds = readWikiBotCredentials(runtime);
  const hasWiki = wikiApiEndpoint(runtime.campaign.settings.wikiBaseUrl) !== null;
  return { hasWiki, canWrite: hasWiki && creds !== null, username: creds?.username ?? null };
}

/** Human-facing link for a page title — the same rule as the client's `wikiHref`. */
export function wikiPageUrl(wikiBaseUrl: string, title: string): string {
  if (!wikiBaseUrl.trim()) return '';
  return wikiBaseUrl + encodeURIComponent(title.trim().replace(/ /g, '_'));
}

// -- transport ---------------------------------------------------------------

function cookieHeader(session: Session): string {
  return [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(session: Session, res: Response): void {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/);
  for (const line of raw) {
    const pair = line.split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === 'deleted' || value === '') session.cookies.delete(name);
    else session.cookies.set(name, value);
  }
}

type ApiBody = Record<string, unknown> & { error?: { code?: string; info?: string } };

async function api(
  session: Session,
  params: Record<string, string>,
  method: 'GET' | 'POST',
): Promise<ApiBody> {
  const all = { ...params, format: 'json', formatversion: '2' };
  const url = new URL(session.endpoint);
  let body: URLSearchParams | undefined;
  if (method === 'GET') for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  else body = new URLSearchParams(all);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      body,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(session.cookies.size ? { Cookie: cookieHeader(session) } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const why = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable';
    throw new WikiError(`Could not reach the wiki (${why})`, 'network');
  }
  storeCookies(session, res);
  if (!res.ok) throw new WikiError(`Wiki responded ${res.status}`, 'http');
  try {
    return (await res.json()) as ApiBody;
  } catch {
    throw new WikiError('Wiki returned a non-JSON response', 'http');
  }
}

function tokenFrom(body: ApiBody, name: string): string {
  const tokens = (body.query as { tokens?: Record<string, string> } | undefined)?.tokens;
  const token = tokens?.[name];
  if (!token) throw new WikiError('Wiki did not return a token', 'token');
  return token;
}

/** Log in with a fresh session. Throws WikiError('…', 'login') on bad credentials. */
export async function wikiLogin(endpoint: string, creds: WikiBotCredentials): Promise<Session> {
  const session: Session = { endpoint, username: creds.username, cookies: new Map(), csrf: null };
  const loginToken = tokenFrom(
    await api(session, { action: 'query', meta: 'tokens', type: 'login' }, 'GET'),
    'logintoken',
  );
  const body = await api(
    session,
    { action: 'login', lgname: creds.username, lgpassword: creds.password, lgtoken: loginToken },
    'POST',
  );
  const login = body.login as { result?: string; reason?: string } | undefined;
  if (login?.result !== 'Success') {
    throw new WikiError(
      `Wiki login failed: ${login?.reason ?? login?.result ?? body.error?.info ?? 'unknown reason'}`,
      'login',
    );
  }
  return session;
}

async function sessionFor(runtime: CampaignRuntime, fresh: boolean): Promise<Session> {
  const endpoint = wikiApiEndpoint(runtime.campaign.settings.wikiBaseUrl);
  if (!endpoint) throw new WikiError('No wiki is configured for this campaign', 'unconfigured');
  const creds = readWikiBotCredentials(runtime);
  if (!creds) {
    throw new WikiError('No wiki bot login is stored — add one in Setup → Wiki write access', 'unconfigured');
  }
  const cached = sessions.get(runtime.id);
  if (!fresh && cached && cached.endpoint === endpoint && cached.username === creds.username) {
    return cached;
  }
  const session = await wikiLogin(endpoint, creds);
  sessions.set(runtime.id, session);
  return session;
}

/** Drop the cached session (credentials changed or were removed). */
export function forgetWikiSession(runtime: CampaignRuntime): void {
  sessions.delete(runtime.id);
}

/** Run `fn` with a session, once more through a fresh login on a session-shaped error. */
async function withSession<T>(
  runtime: CampaignRuntime,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await sessionFor(runtime, false));
  } catch (err) {
    if (!(err instanceof WikiError) || !SESSION_ERRORS.has(err.code)) throw err;
    return await fn(await sessionFor(runtime, true));
  }
}

function serialized<T>(runtime: CampaignRuntime, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(runtime.id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    runtime.id,
    next.catch(() => undefined),
  );
  return next;
}

// -- operations --------------------------------------------------------------

/**
 * Raw wikitext of a page, or null when it does not exist. Uses the bot session
 * when one is stored (private wikis), anonymous otherwise.
 */
export async function readWikiText(runtime: CampaignRuntime, title: string): Promise<string | null> {
  const endpoint = wikiApiEndpoint(runtime.campaign.settings.wikiBaseUrl);
  if (!endpoint) throw new WikiError('No wiki is configured for this campaign', 'unconfigured');
  const read = async (session: Session): Promise<string | null> => {
    const body = await api(
      session,
      { action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title },
      'GET',
    );
    if (body.error) throw new WikiError(body.error.info ?? 'Wiki read failed', body.error.code ?? 'wiki');
    const page = (
      body.query as
        | { pages?: Array<{ missing?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> }> }
        | undefined
    )?.pages?.[0];
    if (!page || page.missing) return null;
    return page.revisions?.[0]?.slots?.main?.content ?? '';
  };
  if (!readWikiBotCredentials(runtime)) {
    return read({ endpoint, username: '', cookies: new Map(), csrf: null });
  }
  return withSession(runtime, read);
}

export async function editWikiPage(
  runtime: CampaignRuntime,
  title: string,
  text: string,
  mode: WikiEditMode,
  opts: WikiEditOptions = {},
): Promise<WikiEditResult> {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 255 || /[#<>[\]{}|]/.test(cleanTitle)) {
    throw new WikiError(`"${title}" is not a valid wiki page title`, 'badtitle');
  }
  return serialized(runtime, () =>
    withSession(runtime, async (session) => {
      session.csrf ??= tokenFrom(await api(session, { action: 'query', meta: 'tokens' }, 'GET'), 'csrftoken');
      const params: Record<string, string> = {
        action: 'edit',
        title: cleanTitle,
        summary: opts.summary ?? 'Edited from HexCrawl',
        bot: '1',
        assert: 'user',
        token: session.csrf,
      };
      if (opts.createOnly) params.createonly = '1';
      if (mode === 'append' && opts.sectionTitle) {
        params.section = 'new';
        params.sectiontitle = opts.sectionTitle;
        params.text = text;
      } else if (mode === 'append') params.appendtext = text;
      else if (mode === 'prepend') params.prependtext = text;
      else params.text = text;

      const body = await api(session, params, 'POST');
      if (body.error) {
        const code = body.error.code ?? 'wiki';
        if (code === 'badtoken') session.csrf = null;
        const message =
          code === 'articleexists'
            ? `A wiki page named "${cleanTitle}" already exists`
            : code === 'protectedpage' || code === 'permissiondenied'
              ? `The wiki bot is not allowed to edit "${cleanTitle}"`
              : (body.error.info ?? 'Wiki edit failed');
        throw new WikiError(message, code);
      }
      const edit = body.edit as { result?: string; title?: string; newrevid?: number } | undefined;
      if (edit?.result !== 'Success') {
        throw new WikiError(`Wiki edit was not accepted (${edit?.result ?? 'no result'})`, 'edit');
      }
      invalidateWikiPage(session.endpoint, cleanTitle);
      return {
        title: edit.title ?? cleanTitle,
        revisionId: edit.newrevid ?? null,
        url: wikiPageUrl(runtime.campaign.settings.wikiBaseUrl, edit.title ?? cleanTitle),
      };
    }),
  );
}
