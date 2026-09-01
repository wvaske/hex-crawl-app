/**
 * PostgreSQL DDL (issue #73). A line-for-line mirror of the SQLite schema in
 * `db/index.ts`, with only the type names changed:
 *
 * - `INTEGER` -> `BIGINT`. Millisecond timestamps (`at`, `created_at`,
 *   `first_arrived`, ...) already exceed int4, and SQLite's INTEGER is 64-bit.
 *   The driver installs a type parser so int8 comes back as a JS `number`
 *   rather than pg's default string.
 * - `REAL` -> `DOUBLE PRECISION`.
 * - Booleans stay 0/1 `BIGINT` columns, exactly as in SQLite, so the
 *   `Boolean(row.x)` / `x ? 1 : 0` conventions in `state/runtime.ts` and
 *   `http/portability.ts` need no per-dialect branch.
 *
 * Identifiers are left unquoted and lower-case, matching the runtime SQL. All
 * of them (including `character`, `text`, `at`, `time`, `data`) are valid
 * unquoted Postgres `ColId`s.
 *
 * `db/schema-parity.test.ts` asserts this file and the SQLite DDL declare the
 * same tables and columns, so the two cannot drift.
 */
export const POSTGRES_SCHEMA = `
    CREATE TABLE IF NOT EXISTS campaign (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dm_secret TEXT NOT NULL,
      player_secret TEXT NOT NULL,
      active_map_id TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seat (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('dm','player')),
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      character_id TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seat_campaign ON seat(campaign_id);

    CREATE TABLE IF NOT EXISTS character (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      glyph TEXT NOT NULL DEFAULT '',
      speed BIGINT NOT NULL DEFAULT 30,
      skills TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS character_campaign ON character(campaign_id);

    CREATE TABLE IF NOT EXISTS map (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      orientation TEXT NOT NULL,
      hex_size DOUBLE PRECISION NOT NULL,
      origin_x DOUBLE PRECISION NOT NULL DEFAULT 0,
      origin_y DOUBLE PRECISION NOT NULL DEFAULT 0,
      grid_style TEXT NOT NULL DEFAULT '{}',
      sight_radius BIGINT NOT NULL DEFAULT 1,
      fog_mode TEXT NOT NULL DEFAULT 'auto',
      fog_decay BIGINT NOT NULL DEFAULT 1,
      move_mode TEXT NOT NULL DEFAULT 'free',
      miles_per_hex DOUBLE PRECISION NOT NULL DEFAULT 6,
      encounter_check TEXT NOT NULL DEFAULT '{}',
      sort_order BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS map_campaign ON map(campaign_id);

    CREATE TABLE IF NOT EXISTS image_layer (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Map image',
      x DOUBLE PRECISION NOT NULL DEFAULT 0,
      y DOUBLE PRECISION NOT NULL DEFAULT 0,
      scale DOUBLE PRECISION NOT NULL DEFAULT 1,
      opacity DOUBLE PRECISION NOT NULL DEFAULT 1,
      z BIGINT NOT NULL DEFAULT 0,
      dm_only BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS image_layer_map ON image_layer(map_id);

    CREATE TABLE IF NOT EXISTS hex (
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
      terrain TEXT NOT NULL,
      PRIMARY KEY (map_id, q, r)
    );

    CREATE TABLE IF NOT EXISTS fog (
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (map_id, q, r)
    );

    CREATE TABLE IF NOT EXISTS token (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
      kind TEXT NOT NULL,
      character_id TEXT,
      label TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      glyph TEXT NOT NULL DEFAULT '',
      player_visible BIGINT NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS token_map ON token(map_id);

    CREATE TABLE IF NOT EXISTS marker (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
      glyph TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      dm_only BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS marker_map ON marker(map_id);

    CREATE TABLE IF NOT EXISTS content (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
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
      sort_order BIGINT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS clue_content ON clue(content_id);

    CREATE TABLE IF NOT EXISTS discovery (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      clue_id TEXT NOT NULL REFERENCES clue(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      at BIGINT NOT NULL,
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
      at BIGINT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      visibility TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS log_campaign_at ON log(campaign_id, at);

    CREATE TABLE IF NOT EXISTS trail (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      glyph TEXT NOT NULL DEFAULT '👣',
      dm_notes TEXT NOT NULL DEFAULT '',
      gate TEXT NOT NULL DEFAULT '{"kind":"auto"}',
      cells TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS trail_map ON trail(map_id);

    CREATE TABLE IF NOT EXISTS hex_visit (
      map_id TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
      q BIGINT NOT NULL,
      r BIGINT NOT NULL,
      first_arrived BIGINT NOT NULL,
      last_arrived BIGINT NOT NULL,
      total_minutes BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (map_id, q, r)
    );

    CREATE TABLE IF NOT EXISTS trail_discovery (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
      trail_id TEXT NOT NULL REFERENCES trail(id) ON DELETE CASCADE,
      cell_index BIGINT NOT NULL,
      character_id TEXT NOT NULL,
      at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trail_discovery_campaign ON trail_discovery(campaign_id);
    CREATE UNIQUE INDEX IF NOT EXISTS trail_discovery_unique ON trail_discovery(trail_id, cell_index, character_id);
`;

/**
 * Translate one `ensureColumn` declaration (written in SQLite types) for the
 * target dialect. Keeping a single declaration list in `db/index.ts` is what
 * stops the two schemas drifting as new columns land.
 */
export function columnDecl(decl: string, dialect: 'sqlite' | 'postgres'): string {
  if (dialect !== 'postgres') return decl;
  return decl.replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bREAL\b/g, 'DOUBLE PRECISION');
}

/**
 * The `ALTER TABLE` one additive migration emits. Postgres gets
 * `IF NOT EXISTS`, so re-running a migration is a no-op even if the driver's
 * column cache was stale; SQLite has no such clause and relies on the check.
 */
export function addColumnSql(
  table: string,
  column: string,
  decl: string,
  dialect: 'sqlite' | 'postgres',
): string {
  const guard = dialect === 'postgres' ? 'IF NOT EXISTS ' : '';
  return `ALTER TABLE ${table} ADD COLUMN ${guard}${column} ${columnDecl(decl, dialect)}`;
}
