/**
 * The SQLite driver: a thin, behaviour-preserving wrapper around
 * better-sqlite3. Every method forwards straight through, so the default
 * (quickstart) path is exactly what it was before the driver abstraction —
 * synchronous reads and writes, one process, one file.
 */
import Database from 'better-sqlite3';
import type { DB, DbHealth, DbStatement, SqlParams } from './driver.js';
import { normalizeParams } from './driver.js';

type Raw = Database.Database;

class SqliteDb implements DB {
  readonly dialect = 'sqlite' as const;

  constructor(private readonly raw: Raw) {}

  prepare(sql: string): DbStatement {
    const stmt = this.raw.prepare(sql);
    return {
      run: (...params: SqlParams): void => {
        stmt.run(...(normalizeParams(params) as never[]));
      },
      get: (...params: SqlParams): unknown => stmt.get(...(normalizeParams(params) as never[])),
      all: (...params: SqlParams): unknown[] =>
        stmt.all(...(normalizeParams(params) as never[])) as unknown[],
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return this.raw.transaction(fn as never) as unknown as (...args: A) => R;
  }

  tableColumns(table: string): Set<string> {
    const rows = this.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((c) => c.name));
  }

  async flush(): Promise<void> {
    // Writes are already durable when `run` returns.
  }

  async close(): Promise<void> {
    this.raw.close();
  }

  health(): DbHealth {
    return { driver: 'sqlite', pendingWrites: 0, failedWrites: 0, lastError: null };
  }

  /** Escape hatch for the few SQLite-only setup calls (`getDb`). */
  pragma(source: string): unknown {
    return this.raw.pragma(source);
  }
}

/** Open (or create) a SQLite database file with the app's pragmas. */
export function openSqlite(file: string, opts: { wal?: boolean } = {}): DB {
  const raw = new Database(file);
  if (opts.wal) raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  return new SqliteDb(raw);
}
