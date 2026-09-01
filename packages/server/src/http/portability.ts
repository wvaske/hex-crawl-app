/**
 * Campaign portability: export one campaign to a single self-contained JSON
 * document (DB rows + base64 uploaded images), and import such a document back
 * as a brand-new campaign with freshly minted ids and secrets.
 *
 * Design notes
 * - Rows are exported verbatim from the database (snake_case keys), so the
 *   format tracks the schema without a second mapping layer to keep in sync.
 *   The archive is backend-independent, which makes it the supported
 *   SQLite -> Postgres migration path (issue #73, deploy/RUNBOOK.md).
 * - Inserts intersect the archive's columns with the live table columns
 *   (`db.tableColumns`), so an archive taken before/after an additive
 *   `ensureColumn` migration still imports: missing columns take their SQL
 *   defaults, unknown columns are dropped.
 * - Import remaps every id (campaign, character, map, image layer, token,
 *   marker, content, clue, discovery, trail, trail discovery, search attempt,
 *   pending reveal, encounter table, log) so an archive can be restored into
 *   the instance it came from.
 * - Secrets are never exported: no dm/player key, no seat auth tokens. Seats
 *   are exported for reference (names/roles) but not restored — the importer
 *   gets a fresh DM seat and fresh invite keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { DB } from '../db/driver.js';

export const EXPORT_FORMAT_VERSION = 1;

/** Hard ceiling on an uploaded archive (images are embedded base64). */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

type Row = Record<string, unknown>;

export interface CampaignExport {
  formatVersion: number;
  exportedAt: number;
  /** Always false: dm/player keys and seat tokens are excluded by design. */
  secrets: false;
  campaign: Row;
  seats: Row[];
  characters: Row[];
  maps: Row[];
  hexes: Row[];
  fog: Row[];
  /** Per-hex time accounting (campaign clock); absent in pre-clock archives. */
  hexVisits: Row[];
  tokens: Row[];
  markers: Row[];
  contents: Row[];
  clues: Row[];
  discoveries: Row[];
  trails: Row[];
  trailDiscoveries: Row[];
  /** Hex-search history and un-adjudicated results (issue #107). */
  searchAttempts: Row[];
  pendingReveals: Row[];
  encTables: Row[];
  log: Row[];
  /** image_layer rows, each with the uploaded file inlined as base64. */
  images: Row[];
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function inClause(n: number): string {
  return Array(n).fill('?').join(',');
}

function childRows(db: DB, table: string, column: string, parents: string[], order = ''): Row[] {
  if (!parents.length) return [];
  const by = order ? ` ORDER BY ${order}` : '';
  return db
    .prepare(`SELECT * FROM ${table} WHERE ${column} IN (${inClause(parents.length)})${by}`)
    .all(...parents) as Row[];
}

/** Everything except the (potentially huge) image payloads. */
function collectExport(db: DB, campaignId: string): Omit<CampaignExport, 'images'> | null {
  const campaign = db.prepare('SELECT * FROM campaign WHERE id = ?').get(campaignId) as
    | Row
    | undefined;
  if (!campaign) return null;
  // Never leak the invite keys.
  const { dm_secret: _dm, player_secret: _player, ...campaignSafe } = campaign;

  const seats = (
    db.prepare('SELECT * FROM seat WHERE campaign_id = ?').all(campaignId) as Row[]
  ).map(({ token: _token, ...rest }) => rest);
  const characters = db
    .prepare('SELECT * FROM character WHERE campaign_id = ?')
    .all(campaignId) as Row[];
  // `maps` and `contents` feed the `IN (...)` lists of the queries below, so
  // both are ordered deterministically: an unordered SELECT may come back in a
  // different order on a second call, which would change those queries'
  // parameters — and on a driver that caches reads by (sql, params), a warmed
  // cache would then miss (see `withReadCache` in db/driver.ts).
  const maps = db
    .prepare('SELECT * FROM map WHERE campaign_id = ? ORDER BY sort_order, id')
    .all(campaignId) as Row[];
  const mapIds = maps.map((m) => m.id as string);
  const contents = childRows(db, 'content', 'map_id', mapIds, 'id');
  const contentIds = contents.map((c) => c.id as string);

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    secrets: false,
    campaign: campaignSafe,
    seats,
    characters,
    maps,
    hexes: childRows(db, 'hex', 'map_id', mapIds),
    fog: childRows(db, 'fog', 'map_id', mapIds),
    hexVisits: childRows(db, 'hex_visit', 'map_id', mapIds),
    tokens: childRows(db, 'token', 'map_id', mapIds),
    markers: childRows(db, 'marker', 'map_id', mapIds),
    contents,
    clues: childRows(db, 'clue', 'content_id', contentIds),
    discoveries: db
      .prepare('SELECT * FROM discovery WHERE campaign_id = ?')
      .all(campaignId) as Row[],
    trails: childRows(db, 'trail', 'map_id', mapIds),
    trailDiscoveries: db
      .prepare('SELECT * FROM trail_discovery WHERE campaign_id = ?')
      .all(campaignId) as Row[],
    searchAttempts: db
      .prepare('SELECT * FROM search_attempt WHERE campaign_id = ?')
      .all(campaignId) as Row[],
    pendingReveals: db
      .prepare('SELECT * FROM pending_reveal WHERE campaign_id = ?')
      .all(campaignId) as Row[],
    encTables: db.prepare('SELECT * FROM enc_table WHERE campaign_id = ?').all(campaignId) as Row[],
    log: db
      .prepare('SELECT * FROM log WHERE campaign_id = ? ORDER BY at, id')
      .all(campaignId) as Row[],
  };
}

/** Resolve `/uploads/<campaignId>/<file>` to a path inside `uploadsDir`. */
function uploadFilePath(uploadsDir: string, urlPath: unknown): string | null {
  if (typeof urlPath !== 'string') return null;
  const m = /^\/uploads\/([\w-]+)\/([\w-]+\.\w+)$/.exec(urlPath);
  if (!m) return null;
  return path.join(uploadsDir, m[1]!, m[2]!);
}

/**
 * Stream the export as JSON chunks. Image files are read and encoded one at a
 * time so peak memory stays at roughly one image rather than the whole archive.
 */
export function* exportCampaignChunks(
  db: DB,
  campaignId: string,
  uploadsDir: string,
): Generator<string> {
  const base = collectExport(db, campaignId);
  if (!base) throw new Error('Campaign not found');
  const head = JSON.stringify(base);
  yield `${head.slice(0, -1)},"images":[`;
  const layers = childRows(
    db,
    'image_layer',
    'map_id',
    base.maps.map((m) => m.id as string),
  );
  let first = true;
  for (const layer of layers) {
    const filePath = uploadFilePath(uploadsDir, layer.path);
    let dataBase64: string | null = null;
    if (filePath && fs.existsSync(filePath)) {
      dataBase64 = fs.readFileSync(filePath).toString('base64');
    }
    yield `${first ? '' : ','}${JSON.stringify({ ...layer, dataBase64 })}`;
    first = false;
  }
  yield ']}';
}

/**
 * Issue every query `exportCampaignChunks` will issue, without touching the
 * filesystem or building the archive. On a driver whose reads are async this is
 * what fills the read cache so the generator above can then run synchronously;
 * on SQLite nobody calls it. See `withReadCache` in `db/driver.ts`.
 */
export function exportReadPlan(db: DB, campaignId: string): void {
  const base = collectExport(db, campaignId);
  if (!base) return;
  childRows(
    db,
    'image_layer',
    'map_id',
    base.maps.map((m) => m.id as string),
  );
}

/** Convenience wrapper (tests, CLI): the whole export as one object. */
export function exportCampaign(db: DB, campaignId: string, uploadsDir: string): CampaignExport {
  return JSON.parse([...exportCampaignChunks(db, campaignId, uploadsDir)].join('')) as CampaignExport;
}

export function exportFileName(campaignId: string, at = new Date()): string {
  return `hexcrawl-${campaignId}-${at.toISOString().slice(0, 10)}.json`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const RowSchema = z.record(z.string(), z.unknown());
const RowsSchema = z.array(RowSchema).default([]);

export const CampaignImportSchema = z.object({
  formatVersion: z.number().int(),
  campaign: RowSchema,
  characters: RowsSchema,
  maps: RowsSchema,
  hexes: RowsSchema,
  fog: RowsSchema,
  // Absent in archives exported before the campaign clock existed.
  hexVisits: RowsSchema.default([]),
  tokens: RowsSchema,
  markers: RowsSchema,
  contents: RowsSchema,
  clues: RowsSchema,
  discoveries: RowsSchema,
  trails: RowsSchema,
  trailDiscoveries: RowsSchema,
  // Absent in archives exported before hex-search approval (issue #107).
  searchAttempts: RowsSchema.default([]),
  pendingReveals: RowsSchema.default([]),
  encTables: RowsSchema,
  log: RowsSchema,
  images: RowsSchema,
});

export interface ImportResult {
  campaignId: string;
  dmSecret: string;
  playerSecret: string;
  /** Counts per table, for logging / test assertions. */
  counts: Record<string, number>;
}

/**
 * Insert rows using the intersection of the archive's keys and the live table's
 * columns. Values outside SQLite's scalar domain are JSON-stringified so a
 * hand-edited archive can't crash the driver.
 *
 * `db.tableColumns` (not a `PRAGMA` query) so this works on every backend and
 * stays safe to call inside the import transaction.
 */
function insertRows(db: DB, table: string, rows: Row[]): number {
  if (!rows.length) return 0;
  const cols = db.tableColumns(table);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => cols.has(k));
  if (!keys.length) return 0;
  const stmt = db.prepare(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${inClause(keys.length)})`,
  );
  for (const row of rows) {
    stmt.run(...keys.map((k) => toSqlValue(row[k])));
  }
  return rows.length;
}

function toSqlValue(value: unknown): string | number | bigint | Buffer | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

/** Assign a fresh id to every row's `id`, returning old -> new. */
function remapIds(rows: Row[], size = 10): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const old = row.id;
    if (typeof old !== 'string' || map.has(old)) continue;
    map.set(old, nanoid(size));
  }
  return map;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Create a brand-new campaign from an export archive. Returns the new ids and
 * freshly minted invite keys. Runs in a single SQLite transaction; image files
 * are written after the transaction commits.
 */
export function importCampaign(
  db: DB,
  raw: unknown,
  opts: { uploadsDir: string; name?: string },
): ImportResult {
  const parsed = CampaignImportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Not a HexCrawl backup file: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  const data = parsed.data;
  if (data.formatVersion !== EXPORT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported backup format v${data.formatVersion} (this server reads v${EXPORT_FORMAT_VERSION})`,
    );
  }

  const campaignId = nanoid(10);
  const dmSecret = nanoid(24);
  const playerSecret = nanoid(24);

  const charMap = remapIds(data.characters);
  const mapMap = remapIds(data.maps);
  const tokenMap = remapIds(data.tokens);
  const markerMap = remapIds(data.markers);
  const contentMap = remapIds(data.contents);
  const clueMap = remapIds(data.clues);
  const trailMap = remapIds(data.trails);
  const encMap = remapIds(data.encTables);
  const imageMap = remapIds(data.images);
  const discoveryMap = remapIds(data.discoveries);
  const trailDiscMap = remapIds(data.trailDiscoveries);
  const attemptMap = remapIds(data.searchAttempts, 12);
  const pendingMap = remapIds(data.pendingReveals, 12);
  const logMap = remapIds(data.log, 12);

  const name = (opts.name ?? str(data.campaign.name) ?? 'Restored campaign').slice(0, 120);
  const activeMapId = mapMap.get(str(data.campaign.active_map_id) ?? '') ?? null;

  /** Keep only rows whose remapped parents all resolved. */
  const keep = (rows: Row[], mapped: (row: Row) => Row | null): Row[] =>
    rows.map(mapped).filter((r): r is Row => r !== null);

  const uploadsRoot = opts.uploadsDir;
  const files: Array<{ fileName: string; data: Buffer }> = [];

  const images = keep(data.images, (row) => {
    const mapId = mapMap.get(str(row.map_id) ?? '');
    if (!mapId) return null;
    let urlPath = str(row.path) ?? '';
    const b64 = str(row.dataBase64);
    if (b64) {
      const ext = path.extname(urlPath).toLowerCase();
      const safeExt = IMAGE_EXTS.has(ext) ? ext : '.png';
      const fileName = `${nanoid(12)}${safeExt}`;
      files.push({ fileName, data: Buffer.from(b64, 'base64') });
      urlPath = `/uploads/${campaignId}/${fileName}`;
    }
    const { dataBase64: _drop, ...rest } = row;
    return { ...rest, id: imageMap.get(str(row.id) ?? '') ?? nanoid(10), map_id: mapId, path: urlPath };
  });

  const counts: Record<string, number> = {};
  const tx = db.transaction(() => {
    // The clock blob's partyHex references a map id — remap it (or drop it
    // when the map didn't survive) so linger-time accounting stays coherent.
    let timeJson = str(data.campaign.time) ?? null;
    if (timeJson) {
      try {
        const time = JSON.parse(timeJson) as { partyHex?: { mapId?: string } | null };
        if (time.partyHex?.mapId) {
          const remapped = mapMap.get(time.partyHex.mapId);
          if (remapped) time.partyHex.mapId = remapped;
          else time.partyHex = null;
          timeJson = JSON.stringify(time);
        }
      } catch {
        timeJson = null;
      }
    }
    counts.campaign = insertRows(db, 'campaign', [
      {
        ...data.campaign,
        id: campaignId,
        name,
        dm_secret: dmSecret,
        player_secret: playerSecret,
        active_map_id: activeMapId,
        created_at: Date.now(),
        time: timeJson,
      },
    ]);
    counts.character = insertRows(
      db,
      'character',
      keep(data.characters, (row) => {
        const id = charMap.get(str(row.id) ?? '');
        return id ? { ...row, id, campaign_id: campaignId } : null;
      }),
    );
    counts.map = insertRows(
      db,
      'map',
      keep(data.maps, (row) => {
        const id = mapMap.get(str(row.id) ?? '');
        return id ? { ...row, id, campaign_id: campaignId } : null;
      }),
    );
    counts.image_layer = insertRows(db, 'image_layer', images);
    for (const table of ['hex', 'fog', 'hex_visit'] as const) {
      const rows =
        table === 'hex' ? data.hexes : table === 'fog' ? data.fog : data.hexVisits;
      counts[table] = insertRows(
        db,
        table,
        keep(rows, (row) => {
          const mapId = mapMap.get(str(row.map_id) ?? '');
          return mapId ? { ...row, map_id: mapId } : null;
        }),
      );
    }
    counts.token = insertRows(
      db,
      'token',
      keep(data.tokens, (row) => {
        const id = tokenMap.get(str(row.id) ?? '');
        const mapId = mapMap.get(str(row.map_id) ?? '');
        if (!id || !mapId) return null;
        const charId = str(row.character_id);
        return {
          ...row,
          id,
          map_id: mapId,
          character_id: charId ? (charMap.get(charId) ?? null) : null,
        };
      }),
    );
    counts.marker = insertRows(
      db,
      'marker',
      keep(data.markers, (row) => {
        const id = markerMap.get(str(row.id) ?? '');
        const mapId = mapMap.get(str(row.map_id) ?? '');
        return id && mapId ? { ...row, id, map_id: mapId } : null;
      }),
    );
    counts.content = insertRows(
      db,
      'content',
      keep(data.contents, (row) => {
        const id = contentMap.get(str(row.id) ?? '');
        const mapId = mapMap.get(str(row.map_id) ?? '');
        return id && mapId ? { ...row, id, map_id: mapId } : null;
      }),
    );
    counts.clue = insertRows(
      db,
      'clue',
      keep(data.clues, (row) => {
        const id = clueMap.get(str(row.id) ?? '');
        const contentId = contentMap.get(str(row.content_id) ?? '');
        return id && contentId ? { ...row, id, content_id: contentId } : null;
      }),
    );
    counts.discovery = insertRows(
      db,
      'discovery',
      keep(data.discoveries, (row) => {
        const id = discoveryMap.get(str(row.id) ?? '');
        const clueId = clueMap.get(str(row.clue_id) ?? '');
        const charId = charMap.get(str(row.character_id) ?? '');
        return id && clueId && charId
          ? { ...row, id, campaign_id: campaignId, clue_id: clueId, character_id: charId }
          : null;
      }),
    );
    counts.trail = insertRows(
      db,
      'trail',
      keep(data.trails, (row) => {
        const id = trailMap.get(str(row.id) ?? '');
        const mapId = mapMap.get(str(row.map_id) ?? '');
        return id && mapId ? { ...row, id, map_id: mapId } : null;
      }),
    );
    counts.trail_discovery = insertRows(
      db,
      'trail_discovery',
      keep(data.trailDiscoveries, (row) => {
        const id = trailDiscMap.get(str(row.id) ?? '');
        const trailId = trailMap.get(str(row.trail_id) ?? '');
        const charId = charMap.get(str(row.character_id) ?? '');
        return id && trailId && charId
          ? { ...row, id, campaign_id: campaignId, trail_id: trailId, character_id: charId }
          : null;
      }),
    );
    counts.search_attempt = insertRows(
      db,
      'search_attempt',
      keep(data.searchAttempts, (row) => {
        const id = attemptMap.get(str(row.id) ?? '');
        const mapId = mapMap.get(str(row.map_id) ?? '');
        const charId = charMap.get(str(row.character_id) ?? '');
        return id && mapId && charId
          ? { ...row, id, campaign_id: campaignId, map_id: mapId, character_id: charId }
          : null;
      }),
    );
    counts.pending_reveal = insertRows(
      db,
      'pending_reveal',
      keep(data.pendingReveals, (row) => {
        const id = pendingMap.get(str(row.id) ?? '');
        const clueId = clueMap.get(str(row.clue_id) ?? '');
        const charId = charMap.get(str(row.character_id) ?? '');
        const attemptId = attemptMap.get(str(row.attempt_id) ?? '');
        return id && clueId && charId && attemptId
          ? {
              ...row,
              id,
              campaign_id: campaignId,
              clue_id: clueId,
              character_id: charId,
              attempt_id: attemptId,
            }
          : null;
      }),
    );
    counts.enc_table = insertRows(
      db,
      'enc_table',
      keep(data.encTables, (row) => {
        const id = encMap.get(str(row.id) ?? '');
        return id ? { ...row, id, campaign_id: campaignId } : null;
      }),
    );
    counts.log = insertRows(
      db,
      'log',
      keep(data.log, (row) => {
        const id = logMap.get(str(row.id) ?? '');
        if (!id) return null;
        // Seats are not restored, so an entry whispered to one seat has no
        // audience any more: keep it, but DM-only rather than dangling.
        const visibility = str(row.visibility);
        return {
          ...row,
          id,
          campaign_id: campaignId,
          visibility: visibility === 'all' ? 'all' : 'dm',
        };
      }),
    );
  });
  tx();

  if (files.length) {
    const dir = path.join(uploadsRoot, campaignId);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(dir, file.fileName), file.data);
  }

  return { campaignId, dmSecret, playerSecret, counts };
}
