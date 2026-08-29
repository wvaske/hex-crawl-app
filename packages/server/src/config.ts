import path from 'node:path';

export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** All persistent state lives here: SQLite db + uploaded images. */
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../../data');
export const DB_PATH = path.join(DATA_DIR, 'hexcrawl.db');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
