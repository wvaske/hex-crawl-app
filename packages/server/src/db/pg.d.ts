/**
 * Minimal ambient types for `pg` (issue #73).
 *
 * node-postgres ships no types of its own and `@types/pg` would be a second
 * new dependency for the five members `db/postgres.ts` actually touches. If
 * `@types/pg` is ever added, delete this file — it would shadow the real one.
 */
declare module 'pg' {
  interface PgResult {
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }

  export class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(sql: string, values?: unknown[]): Promise<PgResult>;
    end(): Promise<void>;
    on(event: string, handler: (err: unknown) => void): void;
  }

  export const types: {
    setTypeParser(oid: number, parser: (value: string) => unknown): void;
  };
}
