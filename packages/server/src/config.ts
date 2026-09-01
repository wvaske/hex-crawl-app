import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal `.env` loader (no dependency). Reads the first `.env` found walking
 * up from cwd to the repo root, and sets any key it defines that is not
 * already present in the real environment — real env vars always win, so
 * containers/compose/systemd override the file.
 *
 * Supported syntax: `KEY=value`, `#` comments, optional `export ` prefix,
 * single/double quoted values (`\n` unescaped inside double quotes).
 * See `.env.example` at the repo root for the documented contract.
 */
function loadDotEnv(): void {
  if (process.env.HEXCRAWL_SKIP_DOTENV) return;
  let dir = process.env.DOTENV_DIR ?? process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      applyDotEnv(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

function applyDotEnv(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // real env wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim(); // trailing comment
    }
    process.env[key] = value;
  }
}

loadDotEnv();

export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** All persistent state lives here: SQLite db + uploaded images. */
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../../data');
export const DB_PATH = path.join(DATA_DIR, 'hexcrawl.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
