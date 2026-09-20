# Plugins

A plugin adds a sidebar panel — and the server logic behind it — to HexCrawl
without touching the core app. The DM switches plugins on per campaign under
**Setup → Plugins**.

- `example-fate-dice/` — per-character special dice, logged to the table and
  (optionally) a wiki page.
- `example-letters/` — players write in-game letters; each becomes a wiki page.

Both ship disabled and exist to be copied. Build without them by setting
`HEXCRAWL_PLUGINS_SKIP=example-*`.

**Your own plugins stay private**: everything in this folder except `example-*`
is gitignored. Keep them in your own repository and set
`HEXCRAWL_PLUGINS_DIR=/path/to/your/plugins`; they are mirrored in and compiled
at build time. `pnpm plugins` lists what the next build will include.

Writing one (or asking an AI agent to): see [AGENTS.md](AGENTS.md).
