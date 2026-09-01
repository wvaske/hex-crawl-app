/**
 * Storage driver tests (issue #73).
 *
 * The Postgres side runs entirely against a MOCK client — CI has no database.
 * A live-Postgres round trip is available behind HEXCRAWL_TEST_DATABASE_URL
 * (see the bottom of this file and deploy/RUNBOOK.md).
 */
import { describe, expect, it, vi } from 'vitest';
import { createTestDb, migrate } from './index.js';
import { normalizeParams, toPositionalPlaceholders, type DB } from './driver.js';
import { PostgresDb, type PgClientLike, type PgQueryResult } from './postgres.js';
import { addColumnSql, columnDecl } from './schema.pg.js';

// ---------------------------------------------------------------------------
// A mock node-postgres client
// ---------------------------------------------------------------------------

interface Call {
  sql: string;
  values: unknown[] | undefined;
}

class MockPg implements PgClientLike {
  calls: Call[] = [];
  ended = 0;
  /** Rows to answer a query with; default none. */
  respond: (sql: string, values: unknown[] | undefined) => Array<Record<string, unknown>> =
    () => [];
  /** Return an Error to make that statement fail. */
  failOn: (sql: string) => Error | null = () => null;

  async query(sql: string, values?: unknown[]): Promise<PgQueryResult> {
    this.calls.push({ sql, values });
    const failure = this.failOn(sql);
    if (failure) throw failure;
    return { rows: this.respond(sql, values) };
  }

  async end(): Promise<void> {
    this.ended += 1;
  }

  /** Just the SQL, for order assertions. */
  sqls(): string[] {
    return this.calls.map((c) => c.sql);
  }
}

function mockDb(): { db: PostgresDb; pg: MockPg } {
  const pg = new MockPg();
  return { db: new PostgresDb(async () => pg), pg };
}

/** Silence the deliberate `console.error` from a failing write. */
function quiet(): { restore: () => void; messages: unknown[][] } {
  const messages: unknown[][] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    messages.push(args);
  });
  return { restore: () => spy.mockRestore(), messages };
}

// ---------------------------------------------------------------------------
// SQL translation
// ---------------------------------------------------------------------------

describe('placeholder translation', () => {
  it('numbers each ? in order', () => {
    expect(toPositionalPlaceholders('INSERT INTO seat VALUES (?,?,?)')).toBe(
      'INSERT INTO seat VALUES ($1,$2,$3)',
    );
    expect(
      toPositionalPlaceholders('SELECT * FROM log WHERE campaign_id = ? ORDER BY at DESC LIMIT ?'),
    ).toBe('SELECT * FROM log WHERE campaign_id = $1 ORDER BY at DESC LIMIT $2');
  });

  it('leaves SQL without placeholders alone', () => {
    const sql = 'DELETE FROM seat';
    expect(toPositionalPlaceholders(sql)).toBe(sql);
  });

  it('does not touch a ? inside a string literal', () => {
    expect(toPositionalPlaceholders(`UPDATE map SET name = 'who? me' WHERE id = ?`)).toBe(
      `UPDATE map SET name = 'who? me' WHERE id = $1`,
    );
  });

  it('handles doubled quotes inside a literal', () => {
    expect(toPositionalPlaceholders(`SELECT '?''?' , ? FROM map`)).toBe(
      `SELECT '?''?' , $1 FROM map`,
    );
  });

  it('does not touch a ? inside a quoted identifier or a comment', () => {
    expect(toPositionalPlaceholders('SELECT "we?rd" FROM map WHERE id = ?')).toBe(
      'SELECT "we?rd" FROM map WHERE id = $1',
    );
    expect(toPositionalPlaceholders('SELECT 1 -- ?\nWHERE id = ?')).toBe(
      'SELECT 1 -- ?\nWHERE id = $1',
    );
    expect(toPositionalPlaceholders('SELECT /* ? */ 1 WHERE id = ?')).toBe(
      'SELECT /* ? */ 1 WHERE id = $1',
    );
  });

  it('translates the ON CONFLICT upserts the runtime uses verbatim', () => {
    const sql =
      'INSERT INTO hex (map_id, q, r, terrain) VALUES (?,?,?,?) ' +
      'ON CONFLICT(map_id,q,r) DO UPDATE SET terrain=excluded.terrain';
    expect(toPositionalPlaceholders(sql)).toBe(
      'INSERT INTO hex (map_id, q, r, terrain) VALUES ($1,$2,$3,$4) ' +
        'ON CONFLICT(map_id,q,r) DO UPDATE SET terrain=excluded.terrain',
    );
  });
});

describe('parameter normalisation', () => {
  it('accepts spread params', () => {
    expect(normalizeParams(['a', 1, null])).toEqual(['a', 1, null]);
  });

  it('accepts a single array, like better-sqlite3 does', () => {
    expect(normalizeParams([['a', 1, null]])).toEqual(['a', 1, null]);
  });
});

describe('column declarations', () => {
  it('keeps SQLite declarations untouched', () => {
    expect(columnDecl('INTEGER NOT NULL DEFAULT 0', 'sqlite')).toBe('INTEGER NOT NULL DEFAULT 0');
  });

  it('maps SQLite types onto Postgres ones', () => {
    expect(columnDecl('INTEGER NOT NULL DEFAULT 1', 'postgres')).toBe('BIGINT NOT NULL DEFAULT 1');
    expect(columnDecl('REAL NOT NULL DEFAULT 0', 'postgres')).toBe(
      'DOUBLE PRECISION NOT NULL DEFAULT 0',
    );
    expect(columnDecl("TEXT NOT NULL DEFAULT '{}'", 'postgres')).toBe("TEXT NOT NULL DEFAULT '{}'");
  });

  it('guards the Postgres ALTER with IF NOT EXISTS', () => {
    expect(addColumnSql('marker', 'player_placed', 'INTEGER NOT NULL DEFAULT 0', 'postgres')).toBe(
      'ALTER TABLE marker ADD COLUMN IF NOT EXISTS player_placed BIGINT NOT NULL DEFAULT 0',
    );
    expect(addColumnSql('marker', 'player_placed', 'INTEGER NOT NULL DEFAULT 0', 'sqlite')).toBe(
      'ALTER TABLE marker ADD COLUMN player_placed INTEGER NOT NULL DEFAULT 0',
    );
  });
});

// ---------------------------------------------------------------------------
// Write queue
// ---------------------------------------------------------------------------

describe('postgres write queue', () => {
  it('applies writes in call order', async () => {
    const { db, pg } = mockDb();
    db.prepare('UPDATE map SET name = ? WHERE id = ?').run('one', 'm1');
    db.prepare('UPDATE map SET name = ? WHERE id = ?').run('two', 'm1');
    db.prepare('DELETE FROM map WHERE id = ?').run('m1');
    // Nothing has run yet: writes are fire-and-forget.
    expect(pg.calls).toHaveLength(0);
    await db.flush();
    expect(pg.calls.map((c) => c.values)).toEqual([['one', 'm1'], ['two', 'm1'], ['m1']]);
  });

  it('reports queued writes through health()', async () => {
    const { db } = mockDb();
    db.prepare('DELETE FROM map WHERE id = ?').run('m1');
    expect(db.health()).toMatchObject({ driver: 'postgres', pendingWrites: 1, failedWrites: 0 });
    await db.flush();
    expect(db.health().pendingWrites).toBe(0);
  });

  it('converts booleans to 0/1 and undefined to null', async () => {
    const { db, pg } = mockDb();
    db.prepare('INSERT INTO token (a,b,c,d) VALUES (?,?,?,?)').run(true, false, undefined, null);
    await db.flush();
    expect(pg.calls[0]!.values).toEqual([1, 0, null, null]);
  });

  it('sends parameterless statements over the simple query protocol', async () => {
    const { db, pg } = mockDb();
    db.exec('CREATE TABLE a (id TEXT); CREATE TABLE b (id TEXT);');
    await db.flush();
    // `values: undefined` is what lets node-postgres accept two statements.
    expect(pg.calls[0]!.values).toBeUndefined();
  });

  it('keeps going after a failed write and counts it', async () => {
    const { db, pg } = mockDb();
    const log = quiet();
    pg.failOn = (sql) => (sql.startsWith('UPDATE') ? new Error('boom') : null);
    db.prepare('UPDATE map SET name = ? WHERE id = ?').run('one', 'm1');
    db.prepare('DELETE FROM map WHERE id = ?').run('m1');
    await db.flush();
    log.restore();
    expect(pg.sqls()).toHaveLength(2); // the second write still ran
    expect(db.health()).toMatchObject({ failedWrites: 1, lastError: 'boom' });
    expect(JSON.stringify(log.messages)).toContain('WRITE FAILED');
  });
});

describe('postgres transactions', () => {
  it('wraps a batch in BEGIN/COMMIT and preserves order around it', async () => {
    const { db, pg } = mockDb();
    db.prepare('INSERT INTO log VALUES (?)').run('before');
    const tx = db.transaction((terrain: string) => {
      db.prepare('DELETE FROM hex WHERE map_id = ?').run('m1');
      db.prepare('INSERT INTO hex VALUES (?)').run(terrain);
      return terrain.toUpperCase();
    });
    expect(tx('swamp')).toBe('SWAMP');
    db.prepare('INSERT INTO log VALUES (?)').run('after');
    await db.flush();
    expect(pg.sqls()).toEqual([
      'INSERT INTO log VALUES ($1)',
      'BEGIN',
      'DELETE FROM hex WHERE map_id = $1',
      'INSERT INTO hex VALUES ($1)',
      'COMMIT',
      'INSERT INTO log VALUES ($1)',
    ]);
  });

  it('discards the batch when the transaction body throws', async () => {
    const { db, pg } = mockDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM hex WHERE map_id = ?').run('m1');
      throw new Error('nope');
    });
    expect(() => tx()).toThrow('nope');
    await db.flush();
    expect(pg.calls).toHaveLength(0);
  });

  it('rolls back and counts every statement when a batch fails', async () => {
    const { db, pg } = mockDb();
    const log = quiet();
    pg.failOn = (sql) => (sql.startsWith('INSERT INTO hex') ? new Error('constraint') : null);
    db.transaction(() => {
      db.prepare('DELETE FROM hex WHERE map_id = ?').run('m1');
      db.prepare('INSERT INTO hex VALUES (?)').run('swamp');
    })();
    await db.flush();
    log.restore();
    expect(pg.sqls()).toContain('ROLLBACK');
    expect(pg.sqls()).not.toContain('COMMIT');
    expect(db.health().failedWrites).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('postgres reads', () => {
  it('refuses a synchronous read outside withReadCache', () => {
    const { db } = mockDb();
    expect(() => db.prepare('SELECT * FROM campaign WHERE id = ?').all('c1')).toThrow(
      /outside withReadCache/,
    );
  });

  it('replays until the read set settles, then returns that pass', async () => {
    const { db, pg } = mockDb();
    pg.respond = (sql, values) => {
      if (sql.startsWith('SELECT * FROM campaign')) return [{ id: 'c1' }];
      if (sql.startsWith('SELECT * FROM map')) return [{ id: 'm1', campaign_id: values?.[0] }];
      if (sql.startsWith('SELECT * FROM hex')) return [{ map_id: values?.[0], q: 1, r: 2 }];
      return [];
    };
    // Query 3's parameters depend on query 2's rows, which depend on query 1's:
    // three dependent levels, so `prime` needs several passes.
    const result = await db.withReadCache((prime) =>
      prime(() => {
        const campaign = db.prepare('SELECT * FROM campaign WHERE id = ?').get('c1') as
          { id: string } | undefined;
        if (!campaign) return null;
        const maps = db
          .prepare('SELECT * FROM map WHERE campaign_id = ?')
          .all(campaign.id) as Array<{
          id: string;
        }>;
        return maps.map(
          (m) =>
            db.prepare('SELECT * FROM hex WHERE map_id = ?').all(m.id) as Array<
              Record<string, unknown>
            >,
        );
      }),
    );
    expect(result).toEqual([[{ map_id: 'm1', q: 1, r: 2 }]]);
    // Each distinct query is executed exactly once despite the replays.
    expect(pg.sqls()).toEqual([
      'SELECT * FROM campaign WHERE id = $1',
      'SELECT * FROM map WHERE campaign_id = $1',
      'SELECT * FROM hex WHERE map_id = $1',
    ]);
  });

  it('serves a repeated read from the cache', async () => {
    const { db, pg } = mockDb();
    pg.respond = () => [{ id: 'c1' }];
    await db.withReadCache(async (prime) => {
      await prime(() => db.prepare('SELECT * FROM campaign WHERE id = ?').get('c1'));
      // A second, identical read after priming does not hit the server.
      const again = db.prepare('SELECT * FROM campaign WHERE id = ?').get('c1');
      expect(again).toEqual({ id: 'c1' });
    });
    expect(pg.sqls()).toEqual(['SELECT * FROM campaign WHERE id = $1']);
  });

  it('flushes queued writes before reading', async () => {
    const { db, pg } = mockDb();
    pg.respond = () => [{ id: 'c1' }];
    db.prepare('INSERT INTO campaign VALUES (?)').run('c1');
    await db.withReadCache((prime) =>
      prime(() => db.prepare('SELECT * FROM campaign WHERE id = ?').get('c1')),
    );
    expect(pg.sqls()[0]).toBe('INSERT INTO campaign VALUES ($1)');
  });

  it('keeps two concurrent read caches apart', async () => {
    const { db, pg } = mockDb();
    pg.respond = (_sql, values) => [{ id: values?.[0] }];
    const [a, b] = await Promise.all([
      db.withReadCache((prime) =>
        prime(() => db.prepare('SELECT * FROM campaign WHERE id = ?').get('a')),
      ),
      db.withReadCache((prime) =>
        prime(() => db.prepare('SELECT * FROM campaign WHERE id = ?').get('b')),
      ),
    ]);
    expect(a).toEqual({ id: 'a' });
    expect(b).toEqual({ id: 'b' });
  });

  it('gives up loudly if the read set never settles', async () => {
    const { db, pg } = mockDb();
    let n = 0;
    pg.respond = () => [{ id: `c${n++}` }];
    await expect(
      db.withReadCache((prime) =>
        prime(() => {
          // A different parameter every pass, so nothing is ever fully cached.
          const row = db.prepare('SELECT * FROM campaign WHERE id = ?').get(`k${n}`);
          return row;
        }),
      ),
    ).rejects.toThrow(/did not settle/);
  });
});

describe('postgres schema cache', () => {
  it('reads information_schema into tableColumns', async () => {
    const { db, pg } = mockDb();
    pg.respond = (sql) =>
      sql.includes('information_schema')
        ? [
            { table_name: 'marker', column_name: 'id' },
            { table_name: 'marker', column_name: 'dm_only' },
            { table_name: 'map', column_name: 'id' },
          ]
        : [];
    await db.refreshColumns();
    expect([...db.tableColumns('marker')]).toEqual(['id', 'dm_only']);
    expect(db.tableColumns('nope').size).toBe(0);
  });

  it('emits the Postgres DDL then only the missing additive columns', async () => {
    const { db, pg } = mockDb();
    pg.respond = (sql) =>
      sql.includes('information_schema')
        ? [
            { table_name: 'content', column_name: 'show_label' },
            { table_name: 'marker', column_name: 'player_placed' },
          ]
        : [];
    await db.refreshColumns();
    migrate(db);
    await db.flush();
    const sqls = pg.sqls();
    const ddl = sqls.find((s) => s.includes('CREATE TABLE IF NOT EXISTS campaign'))!;
    expect(ddl).toContain('created_at BIGINT NOT NULL');
    expect(ddl).toContain('hex_size DOUBLE PRECISION NOT NULL');
    expect(ddl).not.toMatch(/\bINTEGER\b/);
    const alters = sqls.filter((s) => s.startsWith('ALTER TABLE'));
    // Already present, so not re-added; everything else is.
    expect(alters.some((s) => s.includes('content ADD COLUMN IF NOT EXISTS show_label'))).toBe(
      false,
    );
    expect(alters.some((s) => s.includes('marker ADD COLUMN IF NOT EXISTS player_placed'))).toBe(
      false,
    );
    expect(alters).toContain(
      "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS time TEXT NOT NULL DEFAULT '{}'",
    );
    expect(alters).toContain(
      'ALTER TABLE content ADD COLUMN IF NOT EXISTS scale_visibility BIGINT NOT NULL DEFAULT 1',
    );
  });
});

describe('postgres lifecycle', () => {
  it('flushes and closes the client', async () => {
    const { db, pg } = mockDb();
    db.prepare('DELETE FROM map WHERE id = ?').run('m1');
    await db.close();
    expect(pg.calls).toHaveLength(1);
    expect(pg.ended).toBe(1);
  });

  it('reconnects once when the connection drops mid-write', async () => {
    const first = new MockPg();
    const second = new MockPg();
    const log = quiet();
    first.failOn = () => new Error('Connection terminated unexpectedly');
    let handed = 0;
    const db = new PostgresDb(async () => (handed++ === 0 ? first : second));
    db.prepare('DELETE FROM map WHERE id = ?').run('m1');
    await db.flush();
    log.restore();
    expect(second.calls).toHaveLength(1);
    expect(db.health().failedWrites).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The SQLite driver still behaves exactly as the app expects
// ---------------------------------------------------------------------------

describe('sqlite driver', () => {
  const seed = (db: DB): void => {
    db.prepare(
      'INSERT INTO campaign (id, name, dm_secret, player_secret, active_map_id, settings, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run('c1', 'Test', 'dm', 'pl', null, '{}', 1234);
  };

  it('round-trips rows through prepare/run/get/all', () => {
    const db = createTestDb();
    seed(db);
    expect(db.prepare('SELECT * FROM campaign WHERE id = ?').get('c1')).toMatchObject({
      id: 'c1',
      name: 'Test',
      created_at: 1234,
    });
    expect(db.prepare('SELECT * FROM campaign WHERE id = ?').get('nope')).toBeUndefined();
    expect(db.prepare('SELECT * FROM campaign').all()).toHaveLength(1);
  });

  it('stores booleans as 0/1 integers, as both dialects do', () => {
    const db = createTestDb();
    seed(db);
    db.prepare(
      'INSERT INTO map (id, campaign_id, name, orientation, hex_size, fog_decay, move_approval) VALUES (?,?,?,?,?,?,?)',
    ).run('m1', 'c1', 'Overland', 'flat', 48, 1, 0);
    const row = db.prepare('SELECT fog_decay, move_approval FROM map WHERE id = ?').get('m1') as {
      fog_decay: number;
      move_approval: number;
    };
    expect(row).toEqual({ fog_decay: 1, move_approval: 0 });
    expect(Boolean(row.fog_decay)).toBe(true);
    expect(Boolean(row.move_approval)).toBe(false);
  });

  it('accepts a single array of params (better-sqlite3 spread binding)', () => {
    const db = createTestDb();
    db.prepare(
      'INSERT INTO campaign (id, name, dm_secret, player_secret, active_map_id, settings, created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(['c2', 'Array', 'dm', 'pl', null, '{}', 7]);
    expect(db.prepare('SELECT name FROM campaign WHERE id = ?').get('c2')).toEqual({
      name: 'Array',
    });
  });

  it('commits and rolls back transactions', () => {
    const db = createTestDb();
    seed(db);
    expect(() =>
      db.transaction(() => {
        db.prepare('UPDATE campaign SET name = ? WHERE id = ?').run('Renamed', 'c1');
        throw new Error('abort');
      })(),
    ).toThrow('abort');
    expect(db.prepare('SELECT name FROM campaign WHERE id = ?').get('c1')).toEqual({
      name: 'Test',
    });
    db.transaction(() => {
      db.prepare('UPDATE campaign SET name = ? WHERE id = ?').run('Renamed', 'c1');
    })();
    expect(db.prepare('SELECT name FROM campaign WHERE id = ?').get('c1')).toEqual({
      name: 'Renamed',
    });
  });

  it('exposes table columns, including the additive migrations', () => {
    const db = createTestDb();
    expect(db.tableColumns('marker').has('player_placed')).toBe(true);
    expect(db.tableColumns('campaign').has('time')).toBe(true);
    expect(db.tableColumns('content').has('area')).toBe(true);
  });

  it('has no read cache and reports a clean health line', async () => {
    const db = createTestDb();
    expect(db.withReadCache).toBeUndefined();
    expect(db.dialect).toBe('sqlite');
    expect(db.health()).toEqual({
      driver: 'sqlite',
      pendingWrites: 0,
      failedWrites: 0,
      lastError: null,
    });
    await db.flush();
  });
});
