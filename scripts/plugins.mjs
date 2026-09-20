#!/usr/bin/env node
/**
 * Plugin wiring (see plugins/AGENTS.md). Runs before dev, typecheck, test and
 * build — it is fast and idempotent:
 *
 *  1. SYNC (optional). `HEXCRAWL_PLUGINS_DIR` names one or more directories
 *     outside this repo (path-delimiter separated) that hold private plugins,
 *     one folder each. They are mirrored into `plugins/<id>/`, which is
 *     gitignored. The external directory stays the source of truth: edit
 *     there, never in the mirrored copy (it is overwritten).
 *  2. GENERATE. Writes the two gitignored registries that statically import
 *     every installed plugin, so esbuild/Vite bundle them:
 *       packages/server/src/plugins/registry.generated.ts
 *       packages/client/src/plugins/registry.generated.ts
 *
 * `HEXCRAWL_PLUGINS_SKIP` (comma separated, trailing `*` allowed, e.g.
 * `example-*`) leaves installed folders out of the build.
 *
 * Flags: --watch (keep mirroring external dirs while `pnpm dev` runs),
 *        --list  (print what would be built and exit).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const MARKER = '.synced-from';
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const COPY_SKIP = new Set(['node_modules', '.git', 'dist', '.DS_Store']);

const REGISTRIES = [
  {
    file: path.join(ROOT, 'packages/server/src/plugins/registry.generated.ts'),
    entry: ['server/index.ts'],
    typeImport: "import type { ServerPlugin } from './api.js';",
    exportLine: 'export const GENERATED_SERVER_PLUGINS: readonly ServerPlugin[] = [',
  },
  {
    file: path.join(ROOT, 'packages/client/src/plugins/registry.generated.ts'),
    entry: ['client/index.tsx', 'client/index.ts'],
    typeImport: "import type { ClientPlugin } from './api.js';",
    exportLine: 'export const GENERATED_CLIENT_PLUGINS: readonly ClientPlugin[] = [',
  },
];

/** Env first, then the repo's `.env` (same precedence as the server's loader). */
function setting(name) {
  if (process.env[name] !== undefined) return process.env[name];
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === name) return m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    // no .env
  }
  return '';
}

function sourceDirs() {
  return setting('HEXCRAWL_PLUGINS_DIR')
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(ROOT, d.replace(/^~(?=$|\/)/, process.env.HOME ?? '~')));
}

function skipped(id) {
  return setting('HEXCRAWL_PLUGINS_SKIP')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p));
}

/**
 * Make `to` a copy of `from`, touching only what differs — a blind
 * delete-and-recopy would yank files out from under Vite and `tsx watch`.
 */
function mirrorTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  const keep = new Set([MARKER]);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name) || entry.name === MARKER) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(dst) && !fs.statSync(dst).isDirectory()) fs.rmSync(dst);
      mirrorTree(src, dst);
    } else if (entry.isFile()) {
      const next = fs.readFileSync(src);
      if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) fs.rmSync(dst, { recursive: true });
      if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(next)) fs.writeFileSync(dst, next);
    } else continue;
    keep.add(entry.name);
  }
  for (const name of fs.readdirSync(to)) {
    if (!keep.has(name)) fs.rmSync(path.join(to, name), { recursive: true, force: true });
  }
}

function sync() {
  const seen = new Set();
  for (const dir of sourceDirs()) {
    if (!fs.existsSync(dir)) {
      console.warn(`[plugins] HEXCRAWL_PLUGINS_DIR: ${dir} does not exist — skipped`);
      continue;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name);
      if (!entry.isDirectory() || !fs.existsSync(path.join(src, 'manifest.ts'))) continue;
      if (!ID_RE.test(entry.name)) {
        console.warn(`[plugins] ${src}: folder name is not a valid plugin id — skipped`);
        continue;
      }
      const dst = path.join(PLUGINS_DIR, entry.name);
      // Never clobber a folder that was not mirrored by us (a tracked example,
      // or a plugin someone is developing in place).
      if (fs.existsSync(dst) && !fs.existsSync(path.join(dst, MARKER))) {
        console.warn(`[plugins] plugins/${entry.name} exists and is not a mirror — ${src} skipped`);
        continue;
      }
      mirrorTree(src, dst);
      const marker = `${src}\nMirrored by scripts/plugins.mjs — edit the source, not this copy.\n`;
      const markerFile = path.join(dst, MARKER);
      if (!fs.existsSync(markerFile) || fs.readFileSync(markerFile, 'utf8') !== marker) {
        fs.writeFileSync(markerFile, marker);
      }
      seen.add(entry.name);
    }
  }
  // A mirror whose source went away (plugin deleted or renamed) goes too —
  // but only when a source dir is configured, so unsetting the variable for
  // one command does not wipe the mirrors.
  if (sourceDirs().length === 0 || !fs.existsSync(PLUGINS_DIR)) return;
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    const dir = path.join(PLUGINS_DIR, entry.name);
    if (entry.isDirectory() && fs.existsSync(path.join(dir, MARKER)) && !seen.has(entry.name)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[plugins] removed stale mirror plugins/${entry.name}`);
    }
  }
}

function installed() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PLUGINS_DIR, e.name, 'manifest.ts')))
    .map((e) => e.name)
    .filter((id) => {
      if (ID_RE.test(id)) return !skipped(id);
      console.warn(`[plugins] plugins/${id}: folder name is not a valid plugin id — skipped`);
      return false;
    })
    .sort();
}

function generate(ids) {
  for (const reg of REGISTRIES) {
    const from = path.dirname(reg.file);
    const found = [];
    for (const id of ids) {
      const entry = reg.entry.find((e) => fs.existsSync(path.join(PLUGINS_DIR, id, e)));
      if (!entry) continue;
      const rel = path
        .relative(from, path.join(PLUGINS_DIR, id, entry))
        .split(path.sep)
        .join('/')
        .replace(/\.tsx?$/, '.js');
      found.push({ id, rel, name: `p${found.length}` });
    }
    const text = [
      '// GENERATED by scripts/plugins.mjs — do not edit, do not commit.',
      reg.typeImport,
      ...found.map((f) => `import ${f.name} from '${f.rel}';`),
      '',
      reg.exportLine,
      ...found.map((f) => `  ${f.name}, // ${f.id}`),
      '];',
      '',
    ].join('\n');
    fs.mkdirSync(from, { recursive: true });
    // Untouched when unchanged: a rewrite restarts `tsx watch` and Vite HMR.
    if (!fs.existsSync(reg.file) || fs.readFileSync(reg.file, 'utf8') !== text) {
      fs.writeFileSync(reg.file, text);
    }
  }
}

function run() {
  sync();
  const ids = installed();
  generate(ids);
  return ids;
}

const args = new Set(process.argv.slice(2));
const ids = run();
if (args.has('--list')) {
  console.log(ids.length ? ids.join('\n') : '(no plugins installed)');
} else if (args.has('--watch')) {
  const dirs = sourceDirs().filter((d) => fs.existsSync(d));
  if (dirs.length === 0) process.exit(0); // nothing external to mirror
  console.log(`[plugins] ${ids.length} installed; watching ${dirs.join(', ')}`);
  let timer = null;
  for (const dir of dirs) {
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          run();
        } catch (err) {
          console.error('[plugins] sync failed:', err);
        }
      }, 150);
    });
  }
}
