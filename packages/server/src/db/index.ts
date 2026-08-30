import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_PATH, UPLOADS_DIR } from '../config.js';

export type DB = Database.Database;

let db: DB | null = null;

export function getDb(): DB {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** For tests: an isolated in-memory database. */
export function createTestDb(): DB {
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  migrate(mem);
  return mem;
}

function migrate(d: DB): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS campaign (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dm_secret TEXT NOT NULL,
      player_secret TEXT NOT NULL,
      active_map_id TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seat (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('dm','player')),
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      character_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seat_campaign ON seat(campaign_id);

    CREATE TABLE IF NOT EXISTS character (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      glyph TEXT NOT NULL DEFAULT '',
      speed INTEGER NOT NULL DEFAULT 30,
      skills TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS character_campaign ON character(campaign_id);

    CREATE TABLE IF NOT EXISTS map (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      orientation TEXT NOT NULL,
      hex_size REAL NOT NULL,
      origin_x REAL NOT NULL DEFAULT 0,
      origin_y REAL NOT NULL DEFAULT 0,
      grid_style TEXT NOT NULL DEFAULT '{}',
      sight_radius INTEGER NOT NULL DEFAULT 1,
      fog_mode TEXT NOT NULL DEFAULT 'auto',
      fog_decay INTEGER NOT NULL DEFAULT 1,
      move_mode TEXT NOT NULL DEFAULT 'free',
      miles_per_hex REAL NOT NULL DEFAULT 6,
      encounter_check TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS map_campaign ON map(campaign_id);

    CREATE TABLE IF NOT EXISTS image_layer (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Map image',
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      scale REAL NOT NULL DEFAULT 1,
      opacity REAL NOT NULL DEFAULT 1,
      z INTEGER NOT NULL DEFAULT 0,
      dm_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS image_layer_map ON image_layer(map_id);

    CREATE TABLE IF NOT EXISTS hex (
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      terrain TEXT NOT NULL,
      PRIMARY KEY (map_id, q, r)
    );

    CREATE TABLE IF NOT EXISTS fog (
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (map_id, q, r)
    );

    CREATE TABLE IF NOT EXISTS token (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      kind TEXT NOT NULL,
      character_id TEXT,
      label TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      glyph TEXT NOT NULL DEFAULT '',
      player_visible INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS token_map ON token(map_id);

    CREATE TABLE IF NOT EXISTS marker (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      glyph TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      dm_only INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS marker_map ON marker(map_id);

    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q INTEGER NOT NULL,
      r INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      dm_notes TEXT NOT NULL DEFAULT '',
      glyph TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS content_map ON content(map_id);

    CREATE TABLE IF NOT EXISTS clue (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      gate TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS clue_content ON clue(content_id);

    CREATE TABLE IF NOT EXISTS discovery (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      clue_id TEXT NOT NULL REFERENCES clue(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      how TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS discovery_campaign ON discovery(campaign_id);
    CREATE UNIQUE INDEX IF NOT EXISTS discovery_unique ON discovery(clue_id, character_id);

    CREATE TABLE IF NOT EXISTS enc_table (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      terrains TEXT NOT NULL DEFAULT '[]',
      die TEXT NOT NULL DEFAULT '1d12',
      entries TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS enc_table_campaign ON enc_table(campaign_id);

    CREATE TABLE IF NOT EXISTS log (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      visibility TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS log_campaign_at ON log(campaign_id, at);
  `);
  // Additive migrations for columns introduced after first release.
  ensureColumn(d, 'content', 'show_label', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'content', 'scale_visibility', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(d, 'content', 'wiki_page', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, 'image_layer', 'visible', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(d, 'map', 'move_approval', 'INTEGER NOT NULL DEFAULT 0');
}

function ensureColumn(d: DB, table: string, column: string, decl: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
