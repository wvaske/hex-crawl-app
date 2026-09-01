/**
 * The SQLite schema (inline in `db/index.ts`) and the Postgres one
 * (`db/schema.pg.ts`) are written out separately, so this test is what stops
 * them drifting: it runs `migrate` against a recording driver in each dialect
 * and compares the schema each one would produce — tables, columns, column
 * types and indexes, additive `ensureColumn` migrations included.
 *
 * If it fails after you add a column, you added it to only one of the two.
 */
import { describe, expect, it } from 'vitest';
import { migrate } from './index.js';
import type { DB, DbDialect, DbHealth, DbStatement } from './driver.js';

/** A DB that only records the DDL `migrate` emits. */
class RecordingDb implements DB {
  statements: string[] = [];

  constructor(readonly dialect: DbDialect) {}

  prepare(): DbStatement {
    throw new Error('migrate() must not query');
  }
  exec(sql: string): void {
    this.statements.push(sql);
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return fn;
  }
  /** Empty: every additive migration is treated as still missing. */
  tableColumns(): Set<string> {
    return new Set();
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
  health(): DbHealth {
    return { driver: this.dialect, pendingWrites: 0, failedWrites: 0, lastError: null };
  }
}

type Schema = {
  tables: Map<string, Map<string, string>>;
  indexes: Set<string>;
};

/** Normalise a declared type to a dialect-independent name. */
function canonicalType(decl: string): string {
  const upper = decl.toUpperCase();
  if (upper.startsWith('DOUBLE PRECISION') || upper.startsWith('REAL')) return 'float';
  if (upper.startsWith('BIGINT') || upper.startsWith('INTEGER')) return 'int';
  if (upper.startsWith('TEXT')) return 'text';
  return `unknown(${decl})`;
}

const CONSTRAINT = /^(PRIMARY|CHECK|UNIQUE|FOREIGN|CONSTRAINT)\b/i;

/** Split a CREATE TABLE body on commas that are not inside parens or quotes. */
function splitDefs(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseSchema(statements: string[]): Schema {
  const tables = new Map<string, Map<string, string>>();
  const indexes = new Set<string>();
  const sql = statements.join(';\n');

  const tableRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/g;
  for (const match of sql.matchAll(tableRe)) {
    const columns = new Map<string, string>();
    for (const def of splitDefs(match[2]!)) {
      if (CONSTRAINT.test(def)) continue;
      const [name, ...rest] = def.split(/\s+/);
      if (!name) continue;
      columns.set(name, canonicalType(rest.join(' ')));
    }
    tables.set(match[1]!, columns);
  }

  const indexRe = /CREATE (UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]*)\)/g;
  for (const match of sql.matchAll(indexRe)) {
    const unique = match[1] ? 'unique ' : '';
    const cols = match[4]!
      .split(',')
      .map((c) => c.trim())
      .join(',');
    indexes.add(`${unique}${match[2]} on ${match[3]}(${cols})`);
  }

  const alterRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)\s+([^;]+)/g;
  for (const match of sql.matchAll(alterRe)) {
    const columns = tables.get(match[1]!);
    expect(columns, `ALTER TABLE for unknown table ${match[1]}`).toBeDefined();
    columns!.set(match[2]!, canonicalType(match[3]!.trim()));
  }

  return { tables, indexes };
}

function schemaFor(dialect: DbDialect): Schema {
  const db = new RecordingDb(dialect);
  migrate(db);
  return parseSchema(db.statements);
}

describe('sqlite and postgres schemas', () => {
  const sqlite = schemaFor('sqlite');
  const postgres = schemaFor('postgres');

  it('parses a plausible schema out of both (guards the test itself)', () => {
    expect(sqlite.tables.size).toBeGreaterThanOrEqual(16);
    expect(sqlite.tables.get('campaign')?.get('created_at')).toBe('int');
    expect(sqlite.tables.get('map')?.get('hex_size')).toBe('float');
    // The additive migrations are picked up too.
    expect(sqlite.tables.get('content')?.get('area')).toBe('text');
    expect(sqlite.tables.get('marker')?.get('player_placed')).toBe('int');
    expect(sqlite.indexes.has('unique discovery_unique on discovery(clue_id,character_id)')).toBe(
      true,
    );
  });

  it('declares the same tables', () => {
    expect([...postgres.tables.keys()].sort()).toEqual([...sqlite.tables.keys()].sort());
  });

  it('declares the same columns, with matching types, in every table', () => {
    for (const [table, columns] of sqlite.tables) {
      const other = postgres.tables.get(table);
      expect(other, `postgres schema is missing table ${table}`).toBeDefined();
      expect(Object.fromEntries([...other!].sort()), `column mismatch on ${table}`).toEqual(
        Object.fromEntries([...columns].sort()),
      );
    }
  });

  it('declares the same indexes', () => {
    expect([...postgres.indexes].sort()).toEqual([...sqlite.indexes].sort());
  });

  it('uses no SQLite-only type names in the Postgres DDL', () => {
    const pgDdl = new RecordingDb('postgres');
    migrate(pgDdl);
    const sql = pgDdl.statements.join('\n');
    expect(sql).not.toMatch(/\bINTEGER\b/);
    expect(sql).not.toMatch(/\bREAL\b/);
  });
});
