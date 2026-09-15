import WebSocket from 'ws';
import { nanoid } from 'nanoid';
import type { CampaignRuntime } from '../state/runtime.js';
import type { Hub } from '../ws/hub.js';
import {
  CORE_SKILLS,
  type Character,
  type DdbGameLogStatus,
  type RollDetail,
} from '@hexcrawl/shared';
import { applySearchRoll, deliverCheckEntry, type RollResult } from '../ws/handlers.js';

/**
 * D&D Beyond game-log import (issue #146).
 *
 * D&D Beyond streams a campaign's rolls over a websocket that its own web
 * client and app consume. It is not a public API: the endpoints below are
 * what the community tools (Foundry's DDB Gamelog, ddb-importer) use, and
 * they can change without notice. Authentication is a short-lived token
 * minted from the DM's `CobaltSession` cookie, which HexCrawl stores
 * server-side (write-only, never in a snapshot or an export).
 *
 * Read-only: rolls come in, nothing goes back.
 */

export const DDB_AUTH_URL = 'https://auth-service.dndbeyond.com/v1/cobalt-token';
export const DDB_CAMPAIGNS_URL = 'https://www.dndbeyond.com/api/campaign/stt/active-campaigns';
export const DDB_GAMELOG_WS = 'wss://game-log-api-live.dndbeyond.com/v1';
const USER_AGENT = 'Mozilla/5.0 (HexCrawl VTT game-log import)';
/** How many raw events the status keeps for the DM's verification view. */
const RECENT_EVENTS = 8;

export interface DdbToken {
  token: string;
  /** Seconds, as reported by the auth service. */
  ttl: number;
  userId: string;
  displayName: string;
}

/** Exchange the cookie for a short-lived bearer token (and the user's id). */
export async function mintToken(cobalt: string, fetchFn: typeof fetch = fetch): Promise<DdbToken> {
  const res = await fetchFn(DDB_AUTH_URL, {
    method: 'POST',
    headers: { Cookie: `CobaltSession=${cobalt}`, 'User-Agent': USER_AGENT },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`D&D Beyond rejected the cookie (${res.status})`);
  const body = JSON.parse(text) as { token?: string; ttl?: number };
  if (!body.token) throw new Error('D&D Beyond returned no token for that cookie');
  const payload = decodeJwtPayload(body.token);
  const userId = String(payload.sub ?? payload.userId ?? payload.id ?? '');
  if (!userId) throw new Error('D&D Beyond token carries no user id');
  return {
    token: body.token,
    ttl: Number(body.ttl ?? 300),
    userId,
    displayName: String(payload.displayName ?? payload.name ?? ''),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface DdbCampaignSummary {
  id: string;
  name: string;
  dmId: string;
  dmUsername: string;
}

/** The account's active campaigns (the ones its game-log can stream). */
export async function discoverCampaigns(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<DdbCampaignSummary[]> {
  const res = await fetchFn(DDB_CAMPAIGNS_URL, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`D&D Beyond campaign list failed (${res.status})`);
  const body = JSON.parse(text) as { data?: unknown } | unknown[];
  const list = Array.isArray(body) ? body : ((body as { data?: unknown }).data ?? []);
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const row = c as Record<string, unknown>;
    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      dmId: String(row.dmId ?? row.dmUserId ?? ''),
      dmUsername: String(row.dmUsername ?? ''),
    };
  });
}

// ---------------------------------------------------------------------------
// Event mapping (pure)
// ---------------------------------------------------------------------------

/** What HexCrawl keeps of one D&D Beyond roll event. */
export interface DdbRoll {
  /** D&D Beyond's id for the roll (dedupe key). */
  id: string;
  /** D&D Beyond character id, when the roll came from a character. */
  characterDdbId: string | null;
  characterName: string;
  /** The roll's name on the sheet: "Perception", "Longsword", "Wisdom Save". */
  action: string;
  /** D&D Beyond's classification: check, save, to hit, damage, heal, roll. */
  rollType: string;
  advantage: 'none' | 'advantage' | 'disadvantage';
  notation: string;
  /** Every die value rolled. */
  values: number[];
  /** The die that counted (highest under advantage, lowest under disadvantage). */
  roll: number;
  modifier: number;
  total: number;
  /** True for a roll whispered to the DM (or another single user). */
  whisper: boolean;
  at: number;
}

/**
 * Parse one websocket message. Returns null for anything that is not a
 * fulfilled dice roll (pending rolls, presence, unknown shapes) — the feed
 * carries more than dice, and the shape is not ours to trust.
 */
export function parseGameLogEvent(raw: string | Record<string, unknown>): DdbRoll | null {
  let event: Record<string, unknown>;
  try {
    event = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw;
  } catch {
    return null;
  }
  if (!event || typeof event !== 'object') return null;
  const eventType = String(event.eventType ?? '');
  if (!eventType.startsWith('dice/roll/fulfilled')) return null;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const rolls = Array.isArray(data.rolls) ? (data.rolls as Record<string, unknown>[]) : [];
  const first = rolls[0];
  if (!first) return null;
  const result = (first.result ?? {}) as Record<string, unknown>;
  const values = (Array.isArray(result.values) ? result.values : [])
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const context = (data.context ?? {}) as Record<string, unknown>;
  const kind = String(first.rollKind ?? '').toLowerCase();
  const advantage =
    kind === 'advantage' ? 'advantage' : kind === 'disadvantage' ? 'disadvantage' : 'none';
  const notation = String(first.diceNotationStr ?? first.diceNotation ?? '');
  const isD20 = /d20\b/i.test(notation);
  let roll = values[0] ?? 0;
  if (isD20 && values.length > 1) {
    roll = advantage === 'disadvantage' ? Math.min(...values) : Math.max(...values);
  } else if (!isD20 && values.length > 1) {
    roll = values.reduce((a, b) => a + b, 0);
  }
  const modifier = Number(result.constant ?? 0) || 0;
  const total = Number(result.total ?? roll + modifier) || roll + modifier;
  const scope = String(event.messageScope ?? '');
  const id = String(data.rollId ?? first.rollId ?? event.id ?? '');
  if (!id) return null;
  return {
    id,
    characterDdbId: context.entityId != null ? String(context.entityId) : null,
    characterName: String(context.name ?? event.entityName ?? ''),
    action: String(data.action ?? first.action ?? 'Roll'),
    rollType: String(first.rollType ?? 'roll').toLowerCase(),
    advantage,
    notation,
    values,
    roll,
    modifier,
    total,
    whisper: scope === 'userId',
    at: Date.parse(String(event.dateTime ?? '')) || Date.now(),
  };
}

/** Match the roll's character: by linked D&D Beyond id first, then by name. */
export function matchCharacter(runtime: CampaignRuntime, roll: DdbRoll): Character | null {
  if (roll.characterDdbId) {
    for (const ch of runtime.characters.values()) {
      if (ch.ddbId && ch.ddbId === roll.characterDdbId) return ch;
    }
  }
  const name = roll.characterName.trim().toLowerCase();
  if (!name) return null;
  for (const ch of runtime.characters.values()) {
    if (ch.name.trim().toLowerCase() === name) return ch;
  }
  return null;
}

/** "Perception" → 'perception' when the roll is a skill check the app knows. */
export function skillOf(roll: DdbRoll, character: Character | null): string | null {
  if (roll.rollType !== 'check') return null;
  const key = roll.action.trim().toLowerCase();
  if ((CORE_SKILLS as readonly string[]).includes(key)) return key;
  if (character && key in character.skills) return key;
  return null;
}

// ---------------------------------------------------------------------------
// Import into the campaign
// ---------------------------------------------------------------------------

/**
 * Write one D&D Beyond roll into the campaign log exactly like a tray roll
 * (issue #129 shape), and — when the campaign asks for it and the roll is a
 * skill check by a character with a token — let it count as a search of the
 * hex that character stands on. Returns false when the roll was already
 * imported or nothing in the campaign matched it usefully.
 */
export function importRoll(runtime: CampaignRuntime, hub: Hub, roll: DdbRoll): boolean {
  if (runtime.hasImportedRoll(roll.id)) return false;
  runtime.markImportedRoll(roll.id);
  const settings = runtime.campaign.settings;
  const character = matchCharacter(runtime, roll);
  const skill = skillOf(roll, character);
  const mapId = runtime.campaign.activeMapId;
  const rt = mapId ? runtime.mapStates.get(mapId) : null;
  const token =
    character && rt
      ? [...rt.tokens.values()].find((t) => t.kind === 'pc' && t.characterId === character.id)
      : undefined;
  const hex = token ? { q: token.q, r: token.r } : null;
  const detail: RollDetail = { rolls: roll.values, advantage: roll.advantage, extras: [] };
  const result: RollResult = {
    characterId: character?.id ?? `ddb:${roll.characterDdbId ?? roll.characterName}`,
    name: character?.name ?? (roll.characterName || 'Someone'),
    roll: roll.roll,
    modifier: roll.modifier,
    total: roll.total,
    detail,
    success: null,
    hex,
    counts: true,
  };
  const dmSeat = [...runtime.seats.values()].find((s) => s.role === 'dm');
  const ctx = { runtime, hub, seat: dmSeat!, rng: Math.random };
  let found = 0;
  let pending = 0;
  const searching = Boolean(
    settings.ddbGameLog.countAsSearch && skill && character && hex && mapId && !roll.whisper,
  );
  if (searching) {
    const outcome = applySearchRoll(
      ctx,
      { mapId: mapId!, hex: hex!, skill: skill!, dmRoll: false },
      [result],
    );
    found = outcome.found;
    pending = outcome.pending;
  }
  const label = skill ? capitalize(skill) : roll.action;
  const kindTag = roll.rollType && roll.rollType !== 'check' ? ` (${roll.rollType})` : '';
  const where = searching ? ` on hex ${hex!.q},${hex!.r}` : '';
  const adv = roll.advantage !== 'none' ? ` [${roll.advantage}]` : '';
  const dice =
    roll.values.length > 1
      ? `d20 ${roll.roll} (${roll.advantage === 'none' ? 'dice' : roll.advantage === 'advantage' ? 'adv' : 'dis'}: ${roll.values.join(', ')})`
      : `${roll.notation || 'd20'} ${roll.roll}`;
  const text =
    `${label}${kindTag}${where}${adv} · D&D Beyond: ${result.name}: ${roll.total} (${dice}${roll.modifier ? `${roll.modifier > 0 ? '+' : ''}${roll.modifier}` : ''})` +
    (searching && !result.counts ? ' · re-roll' : '') +
    (pending
      ? ` — ${pending} awaiting your approval`
      : found
        ? ` — ${found} clue(s) uncovered`
        : '');
  const entry = runtime.appendLog('check', text, roll.whisper ? 'dm' : 'all', {
    skill: skill ?? roll.action.toLowerCase(),
    dc: null,
    results: [result],
    hex,
    mapId: mapId ?? null,
    search: searching,
    advantage: roll.advantage,
    extras: [],
    source: 'ddb',
    ddbRollId: roll.id,
    rollType: roll.rollType,
    action: roll.action,
    pending,
    unmatched: !character,
  });
  deliverCheckEntry(ctx, entry, character ? [character.id] : []);
  hub.scheduleSync(runtime);
  return true;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Connector lifecycle
// ---------------------------------------------------------------------------

/** One live connection per campaign; started/stopped by the DM (or at boot). */
export class DdbGameLogConnector {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  readonly status: DdbGameLogStatus;

  constructor(
    private runtime: CampaignRuntime,
    private hub: Hub,
    private opts: { fetchFn?: typeof fetch; makeSocket?: (url: string) => WebSocket } = {},
  ) {
    this.status = runtime.ddbStatus;
  }

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    void this.connect();
  }

  stop(reason = 'stopped by the DM'): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.setStatus({ connected: false, since: null, lastError: reason });
  }

  private setStatus(patch: Partial<DdbGameLogStatus>): void {
    Object.assign(this.status, patch);
    this.hub.scheduleSync(this.runtime);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const cobalt = this.runtime.getSecret('ddbCobalt');
    const { campaignId, userId } = this.runtime.campaign.settings.ddbGameLog;
    if (!cobalt || !campaignId) {
      this.setStatus({ connected: false, lastError: 'No cookie or campaign configured' });
      return;
    }
    let token: DdbToken;
    try {
      token = await mintToken(cobalt, this.opts.fetchFn);
    } catch (err) {
      this.setStatus({
        connected: false,
        lastError: err instanceof Error ? err.message : 'token failed',
      });
      this.scheduleReconnect();
      return;
    }
    const uid = userId || token.userId;
    const url = `${DDB_GAMELOG_WS}?gameId=${encodeURIComponent(campaignId)}&userId=${encodeURIComponent(uid)}&stt=${encodeURIComponent(token.token)}`;
    const ws = this.opts.makeSocket
      ? this.opts.makeSocket(url)
      : new WebSocket(url, { headers: { 'User-Agent': USER_AGENT } });
    this.socket = ws;
    ws.on('open', () => {
      this.attempt = 0;
      this.setStatus({ connected: true, since: Date.now(), lastError: null });
    });
    ws.on('message', (data) => this.onMessage(String(data)));
    ws.on('error', (err) => {
      this.setStatus({ lastError: err.message });
    });
    ws.on('close', (code, reason) => {
      if (this.socket === ws) this.socket = null;
      this.setStatus({
        connected: false,
        since: null,
        lastError: this.stopped
          ? this.status.lastError
          : `closed (${code}${reason.length ? ` ${reason.toString()}` : ''})`,
      });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(this.attempt, 4));
    this.attempt++;
    this.timer = setTimeout(() => void this.connect(), delay);
  }

  /** Exposed for tests: feed one raw message as if it came off the socket. */
  onMessage(raw: string): void {
    this.status.lastEventAt = Date.now();
    this.status.recent = [raw.slice(0, 2000), ...this.status.recent].slice(0, RECENT_EVENTS);
    const roll = parseGameLogEvent(raw);
    if (!roll) {
      this.hub.scheduleSync(this.runtime);
      return;
    }
    if (importRoll(this.runtime, this.hub, roll)) this.status.imported++;
    this.hub.scheduleSync(this.runtime);
  }
}

const connectors = new Map<string, DdbGameLogConnector>();

/** Start (or restart) the campaign's listener. */
export function startConnector(
  runtime: CampaignRuntime,
  hub: Hub,
  opts?: ConstructorParameters<typeof DdbGameLogConnector>[2],
): DdbGameLogConnector {
  stopConnector(runtime);
  const c = new DdbGameLogConnector(runtime, hub, opts);
  connectors.set(runtime.id, c);
  c.start();
  return c;
}

export function stopConnector(runtime: CampaignRuntime, reason?: string): void {
  const c = connectors.get(runtime.id);
  if (!c) return;
  c.stop(reason);
  connectors.delete(runtime.id);
}

export function connectorFor(runtime: CampaignRuntime): DdbGameLogConnector | null {
  return connectors.get(runtime.id) ?? null;
}

/** Placeholder id for rolls whose character could not be matched. */
export const UNMATCHED_PREFIX = 'ddb:';

/** Kept for symmetry with other engines' exports. */
export const _internal = { nanoid };
