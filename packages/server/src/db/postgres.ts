/**
 * The PostgreSQL driver (issue #73) — a synchronous facade over an async
 * client, so `CampaignRuntime`'s write-through model is untouched.
 *
 * ## How a synchronous API rides on an async client
 *
 * **Writes** (`run`, `exec`) are queued, never awaited by the caller. One
 * strictly ordered queue serialises everything, which is exactly the guarantee
 * better-sqlite3 gives today (single writer, statements apply in call order).
 * `transaction(fn)` collects the writes `fn` performs into one batch and
 * enqueues it as `BEGIN ... COMMIT`. A write that fails is logged loudly and
 * counted in `health().failedWrites`; the queue keeps going rather than
 * wedging the process.
 *
 * *A failed write means memory and Postgres have diverged for that campaign.*
 * `/api/health` surfaces the counter so an operator can alert on it and
 * restart (a restart reloads every campaign from the database).
 *
 * **Reads** cannot be faked synchronously, so they are only legal inside
 * `withReadCache(body)`. `body` gets a `prime(fn)` that runs `fn` over and over
 * — serving cached rows, recording misses, executing the misses, repeating —
 * until a pass makes no new query. `fn` sees partial data on early passes, so
 * it must be a pure read (loading a campaign is; nothing in `load()` writes).
 * The cache is scoped with `AsyncLocalStorage`, so two concurrent exports do
 * not see each other's rows, and it is thrown away when `body` returns.
 *
 * A synchronous read *outside* `withReadCache` throws. That is deliberate: a
 * request-time DB read is a bug on this driver (the runtime is the cache), and
 * a loud failure beats silently returning nothing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DB, DbHealth, DbStatement, PrimeReads, SqlParams } from './driver.js';
import { normalizeParams, readKey, toPositionalPlaceholders } from './driver.js';

// -- the sliver of node-postgres we depend on --------------------------------
// Declared here rather than pulled from @types/pg: it keeps `pg` a runtime-only
// dependency (SQLite deployments never load it) and makes the driver trivially
// mockable in tests.

export interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount?: number | null;
}

export interface PgClientLike {
  query(sql: string, values?: unknown[]): Promise<PgQueryResult>;
  end?(): Promise<void>;
}

/** Opens a fresh connection. Called again if the connection is lost. */
export type PgConnect = () => Promise<PgClientLike>;

interface Op {
  sql: string;
  params: unknown[];
}

interface ReadCache {
  rows: Map<string, Array<Record<string, unknown>>>;
  misses: Map<string, Op>;
}

/** How many replay passes `prime` will make before giving up. */
const MAX_PRIME_PASSES = 12;

function isConnectionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|EPIPE|Connection terminated|server closed|not queryable|socket hang up/i.test(
    message,
  );
}

/** Postgres rejects `undefined`; SQLite's callers already pass explicit nulls. */
function coerceParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export class PostgresDb implements DB {
  readonly dialect = 'postgres' as const;

  private client: PgClientLike | null = null;
  /** Tail of the ordered write queue. */
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private failed = 0;
  private lastError: string | null = null;
  /** Open `transaction()` collector, if any (transactions do not nest here). */
  private batch: Op[] | null = null;
  private columns = new Map<string, Set<string>>();
  private readonly reads = new AsyncLocalStorage<ReadCache>();

  constructor(private readonly connect: PgConnect) {}

  // -- connection ------------------------------------------------------------

  private async ensureClient(): Promise<PgClientLike> {
    if (!this.client) this.client = await this.connect();
    return this.client;
  }

  /**
   * One round trip, with a single reconnect-and-retry on a dropped socket.
   *
   * Parameterless statements are sent with `values` omitted so node-postgres
   * uses the simple query protocol — the extended protocol refuses the
   * multi-statement DDL that `exec` sends.
   */
  async query(sql: string, params: unknown[] = []): Promise<PgQueryResult> {
    const values = params.length ? params : undefined;
    try {
      return await (await this.ensureClient()).query(sql, values);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      console.error('[db] postgres connection lost, reconnecting:', err);
      this.client = null;
      return await (await this.ensureClient()).query(sql, values);
    }
  }

  // -- writes ----------------------------------------------------------------

  private submit(op: Op): void {
    if (this.batch) {
      this.batch.push(op);
      return;
    }
    this.enqueue([op], false);
  }

  private enqueue(ops: Op[], transactional: boolean): void {
    if (!ops.length) return;
    this.pending += ops.length;
    this.tail = this.tail.then(async () => {
      try {
        await this.applyOps(ops, transactional);
      } finally {
        this.pending -= ops.length;
      }
    });
  }

  private async applyOps(ops: Op[], transactional: boolean): Promise<void> {
    if (transactional) {
      try {
        await this.query('BEGIN');
        for (const op of ops) await this.query(op.sql, op.params);
        await this.query('COMMIT');
      } catch (err) {
        this.recordFailure(err, ops[0]?.sql ?? '(transaction)', ops.length);
        try {
          await this.query('ROLLBACK');
        } catch {
          /* the connection is already gone; nothing to roll back */
        }
      }
      return;
    }
    for (const op of ops) {
      try {
        await this.query(op.sql, op.params);
      } catch (err) {
        this.recordFailure(err, op.sql, 1);
      }
    }
  }

  private recordFailure(err: unknown, sql: string, count: number): void {
    this.failed += count;
    this.lastError = err instanceof Error ? err.message : String(err);
    console.error(
      `[db] WRITE FAILED (${count} statement${count === 1 ? '' : 's'}) — in-memory state and Postgres have diverged.\n` +
        `     sql: ${sql}\n     error: ${this.lastError}`,
    );
  }

  // -- DB interface ----------------------------------------------------------

  prepare(sql: string): DbStatement {
    const translated = toPositionalPlaceholders(sql);
    return {
      run: (...params: SqlParams): void => {
        this.submit({ sql: translated, params: normalizeParams(params).map(coerceParam) });
      },
      get: (...params: SqlParams): unknown => {
        const rows = this.read(translated, normalizeParams(params).map(coerceParam));
        return rows[0];
      },
      all: (...params: SqlParams): unknown[] =>
        this.read(translated, normalizeParams(params).map(coerceParam)),
    };
  }

  exec(sql: string): void {
    this.submit({ sql, params: [] });
  }

  /**
   * Collect everything `fn` writes into one batch and queue it as
   * BEGIN/.../COMMIT. Safe because a transaction body is synchronous: nothing
   * else can interleave a write between the first statement and the last.
   *
   * Nesting folds into the outer batch (one COMMIT), and an inner throw drops
   * only the statements that inner block added — near enough to SQLite's
   * SAVEPOINT behaviour for the flat transactions this codebase uses.
   */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      const outer = this.batch;
      const batch = outer ?? [];
      const mark = batch.length;
      this.batch = batch;
      let result: R;
      try {
        result = fn(...args);
      } catch (err) {
        // Mirror better-sqlite3: a throw discards the transaction's writes.
        batch.length = mark;
        this.batch = outer;
        throw err;
      }
      this.batch = outer;
      if (!outer) this.enqueue(batch, true);
      return result;
    };
  }

  tableColumns(table: string): Set<string> {
    return this.columns.get(table) ?? new Set();
  }

  /** Re-read `information_schema` into the synchronous column cache. */
  async refreshColumns(): Promise<void> {
    const result = await this.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
    );
    const next = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const table = String(row.table_name);
      let set = next.get(table);
      if (!set) {
        set = new Set<string>();
        next.set(table, set);
      }
      set.add(String(row.column_name));
    }
    this.columns = next;
  }

  // -- reads -----------------------------------------------------------------

  private read(sql: string, params: unknown[]): Array<Record<string, unknown>> {
    const cache = this.reads.getStore();
    if (!cache) {
      throw new Error(
        `Synchronous read outside withReadCache() on the Postgres driver — route this through ` +
          `the in-memory runtime or wrap the call site (sql: ${sql})`,
      );
    }
    const key = readKey(sql, params);
    const hit = cache.rows.get(key);
    if (hit) return hit;
    cache.misses.set(key, { sql, params });
    return [];
  }

  withReadCache<T>(body: (prime: PrimeReads) => Promise<T>): Promise<T> {
    const cache: ReadCache = { rows: new Map(), misses: new Map() };
    const prime: PrimeReads = async <R>(fn: () => R): Promise<R> => {
      for (let pass = 0; pass < MAX_PRIME_PASSES; pass++) {
        cache.misses.clear();
        const value = fn();
        if (cache.misses.size === 0) return value;
        // A read must see everything already written (import-then-load).
        await this.flush();
        for (const [key, op] of cache.misses) {
          const result = await this.query(op.sql, op.params);
          cache.rows.set(key, result.rows);
        }
      }
      throw new Error(
        `withReadCache: read set did not settle after ${MAX_PRIME_PASSES} passes — a query's ` +
          `parameters probably depend on rows that change between passes`,
      );
    };
    return this.reads.run(cache, () => body(prime));
  }

  // -- lifecycle -------------------------------------------------------------

  async flush(): Promise<void> {
    // Await the current tail, then re-check: a queued write may have enqueued
    // more work while we waited.
    let previous: Promise<void> | null = null;
    while (previous !== this.tail) {
      previous = this.tail;
      await previous;
    }
  }

  async close(): Promise<void> {
    await this.flush();
    await this.client?.end?.();
    this.client = null;
  }

  health(): DbHealth {
    return {
      driver: 'postgres',
      pendingWrites: this.pending,
      failedWrites: this.failed,
      lastError: this.lastError,
    };
  }
}

/**
 * Build a `pg.Client` factory for `url`.
 *
 * The import is dynamic so a SQLite deployment never evaluates node-postgres —
 * but it is a literal specifier, so esbuild still bundles it into the
 * production server (see the `bundle` script). `pg`'s types come from the
 * hand-written `db/pg.d.ts`.
 */
export function pgConnector(url: string): PgConnect {
  return async (): Promise<PgClientLike> => {
    const { Client, types } = await import('pg');
    // int8 and numeric arrive as strings by default; every such column in this
    // schema is a JS number (millisecond timestamps, hex coords, counters).
    types.setTypeParser(20, (v: string) => Number(v));
    types.setTypeParser(1700, (v: string) => Number(v));
    const client = new Client({ connectionString: url });
    await client.connect();
    client.on('error', (err: unknown) => {
      console.error('[db] postgres client error:', err);
    });
    return client;
  };
}
