#!/usr/bin/env node
/**
 * HexCrawl VTT — MCP server (stdio) for campaign integrations.
 *
 * Lets any AI assistant (Claude Code, opencode, a wiki-manager agent, ...) add
 * and update map locations, trails, and settlement clues in a HexCrawl
 * campaign. Wraps the app's `/api/integration/*` REST API over JSON-RPC on
 * stdin/stdout (the MCP stdio transport). Zero dependencies — plain Node.
 *
 * Env (all required — see docs/MCP.md for the full contract):
 *   HEXCRAWL_URL      Base URL of your instance, e.g. https://hex-crawl.example.com
 *   HEXCRAWL_CAMPAIGN Campaign id, from the DM link (…/c/<id>?key=…)
 *   HEXCRAWL_TOKEN    The campaign's DM key. SECRET — grants full DM access.
 *
 * Register (Claude Code):
 *   claude mcp add hexcrawl -e HEXCRAWL_URL=https://your-host \
 *     -e HEXCRAWL_CAMPAIGN=<id> -e HEXCRAWL_TOKEN=<dm-key> \
 *     -- node /path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs
 *
 * Run directly with --help or --version for CLI info; anything else assumes
 * an MCP client is speaking JSON-RPC on stdin and blocks reading it.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_NAME = 'hexcrawl';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

function printHelp() {
  process.stdout.write(`hexcrawl-mcp — MCP (stdio) server for a HexCrawl VTT campaign

Usage:
  node hexcrawl-mcp.mjs            Start the MCP server (reads JSON-RPC on stdin)
  node hexcrawl-mcp.mjs --help     Show this help
  node hexcrawl-mcp.mjs --version  Show the server version

This process is not interactive — it is meant to be launched by an MCP
client (Claude Code, opencode, etc.), not run by hand. See docs/MCP.md for
registration examples.

Required environment variables:
  HEXCRAWL_URL       Base URL of your HexCrawl instance
                      e.g. https://hex-crawl.example.com or http://localhost:3000
  HEXCRAWL_CAMPAIGN  Campaign id (from the DM link, .../c/<id>?key=...)
  HEXCRAWL_TOKEN     The campaign's DM key (SECRET — treat like a password;
                      it grants full DM access to that campaign)

Tools exposed: list_maps, list_locations, upsert_location, delete_location,
upsert_trail, generate_settlement_clues. Call tools/list over the MCP
protocol for full schemas, or see docs/MCP.md.
`);
}

function printVersion() {
  process.stdout.write(`${SERVER_VERSION}\n`);
}

function fail(message) {
  process.stderr.write(`hexcrawl-mcp: ${message}\n`);
  process.exit(1);
}

function checkEnv() {
  const missing = ['HEXCRAWL_URL', 'HEXCRAWL_CAMPAIGN', 'HEXCRAWL_TOKEN'].filter(
    (name) => !process.env[name] || !process.env[name].trim(),
  );
  if (missing.length === 0) return;
  fail(
    `missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.\n\n` +
      'This server needs all three of HEXCRAWL_URL, HEXCRAWL_CAMPAIGN, and HEXCRAWL_TOKEN set\n' +
      "before it starts — otherwise every tool call fails later with an opaque \"fetch failed\"\n" +
      'or 401 once an assistant actually tries to use it. Set them when registering the server,\n' +
      'e.g.:\n\n' +
      '  claude mcp add hexcrawl \\\n' +
      '    -e HEXCRAWL_URL=https://your-host \\\n' +
      '    -e HEXCRAWL_CAMPAIGN=<campaign id from the DM link> \\\n' +
      '    -e HEXCRAWL_TOKEN=<campaign DM key> \\\n' +
      '    -- node /path/to/hex-crawl-app/mcp/hexcrawl-mcp.mjs\n\n' +
      'See docs/MCP.md for the full env contract and other clients (opencode, generic stdio).',
  );
}

// --- CLI entry: --help / --version bypass the env check and the stdio loop.
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp();
  process.exit(0);
}
if (argv.includes('--version') || argv.includes('-v')) {
  printVersion();
  process.exit(0);
}
checkEnv();

const BASE = process.env.HEXCRAWL_URL.replace(/\/$/, '');
const CAMPAIGN = process.env.HEXCRAWL_CAMPAIGN;
const TOKEN = process.env.HEXCRAWL_TOKEN;

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}/api/integration/campaigns/${CAMPAIGN}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Could not reach ${BASE} (${err.message}). Check HEXCRAWL_URL points at a running ` +
        'HexCrawl instance and is reachable from this process.',
    );
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new Error('Unauthorized (401) — HEXCRAWL_TOKEN is not this campaign\'s DM key, or HEXCRAWL_CAMPAIGN is wrong.');
  }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Discriminated-union gate shape shared by location clues and trails. Kept as
// a loose `object` in JSON Schema (MCP clients render z.discriminatedUnion
// poorly) but documented precisely in each tool's description.
const GATE_DESCRIPTION =
  'How this is revealed to players. {kind:"auto"} — revealed the instant a character\'s ' +
  'token enters the hex. {kind:"skill", skill, dc, maxDistance, mode:"passive"|"active"} — ' +
  'revealed once a character within maxDistance hexes has that passive skill score >= dc ' +
  '(mode "passive", the default, is evaluated continuously as tokens move); mode "active" ' +
  'instead waits for the DM to trigger a roll. {kind:"manual"} — never auto-reveals; only a ' +
  'DM action in the app can reveal it. Default: {kind:"auto"}.';

const TOOLS = [
  {
    name: 'list_maps',
    description:
      'List the maps in the HexCrawl campaign: id, name, miles per hex, and grid geometry ' +
      '(hexSize, orientation, originX/originY — the pixel-to-hex conversion basis used by ' +
      'upsert_location). Use a map id from here with every other tool.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_locations',
    description:
      'List all content/locations on one map: hex coordinates (q/r), type, clues (with their ' +
      'gates), wiki page, and visibility settings. Use this before upsert_location to see what ' +
      'already exists (matching is by title, case-insensitive) or to get a contentId for ' +
      'delete_location.',
    inputSchema: {
      type: 'object',
      properties: { mapId: { type: 'string', description: 'Map id from list_maps' } },
      required: ['mapId'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_location',
    description:
      'Create or update a location (a pin on the hex map). Matched to an existing location by ' +
      '(mapId, title) case-insensitively — calling this again with the same title after editing ' +
      'a wiki page updates that same location in place rather than creating a duplicate.\n\n' +
      'Coordinate frames — give EITHER x/y OR q/r, not both: x/y are pixel coordinates on the ' +
      'raw map image, the SAME frame as wiki DataMap marker positions, and are converted to hex ' +
      'coordinates server-side using the map\'s grid geometry (from list_maps) — this is the ' +
      'preferred way to pass a position sourced from a DataMap. q/r are axial hex coordinates ' +
      'directly, for when you already know the hex (e.g. copied from list_locations).\n\n' +
      'Field-merge semantics on update — READ CAREFULLY, this is not uniform: dmNotes, glyph, ' +
      'wikiPage, and quest are replaced only if you pass a non-empty value (an empty ' +
      'string/omitted field leaves the existing value alone). clues is similar in spirit but ' +
      'stronger: passing a non-empty clues array fully REPLACES the existing clue list, while ' +
      'clues:[] or an omitted clues field KEEPS the existing clues untouched (there is no way to ' +
      'clear every clue through this tool — delete and recreate the location, or edit it in the ' +
      'app). type, showLabel, scaleVisibility, enabled, and knownLocation are DIFFERENT and do ' +
      'NOT merge: every call sets them to whatever you pass, or to their schema default ' +
      '(type="landmark", showLabel=false, scaleVisibility=1, enabled=true, knownLocation=false) ' +
      'if you omit them — even on an update to an existing location. Omitting one of these five ' +
      'on a follow-up call SILENTLY RESETS it. To only touch dmNotes/glyph/wikiPage/quest/clues ' +
      'on an existing location, you must still re-pass its current type, showLabel, ' +
      'scaleVisibility, enabled, and knownLocation (read them first with list_locations) or they ' +
      'will revert to defaults.\n\n' +
      'scaleVisibility controls the coarsest hex-zoom level the pin appears at: 0 = only visible ' +
      'zoomed all the way into fine hexes (hidden/small sites), 1 = fine + mid zoom (default), ' +
      '2 = visible at every zoom including the coarsest (cities, major landmarks).\n\n' +
      'knownLocation: true means players always see this pin\'s name and position even with zero ' +
      'discoveries — use for well-known settlements. Its clues stay gated as normal: players ' +
      'learn WHERE it is, not what is true about it (dmNotes and ungated clue content are never ' +
      'sent to players regardless of this flag).\n\n' +
      'Each clue has a gate (' +
      GATE_DESCRIPTION +
      ') plus optional indicatesDirection (appends an auto-computed compass bearing from the ' +
      'discovering character to this hex, e.g. "... — to the north-east") and revealsLocation ' +
      '(default true; set false for a clue that reveals information/rumor text without pinning ' +
      'down the location itself — e.g. a rumor overheard in a tavern that names a threat but not ' +
      'its lair).',
    inputSchema: {
      type: 'object',
      properties: {
        mapId: { type: 'string', description: 'Map id from list_maps' },
        title: { type: 'string', description: 'Match key for upsert — case-insensitive' },
        x: { type: 'number', description: 'Pixel x on the map image (wiki DataMap frame). Alternative to q/r.' },
        y: { type: 'number', description: 'Pixel y on the map image (wiki DataMap frame). Alternative to q/r.' },
        q: { type: 'integer', description: 'Axial hex q. Alternative to x/y.' },
        r: { type: 'integer', description: 'Axial hex r. Alternative to x/y.' },
        type: {
          type: 'string',
          enum: ['lair', 'dungeon', 'settlement', 'ruin', 'landmark', 'region', 'lore', 'hazard', 'cache', 'other'],
          description: 'Does NOT merge — omitting this on an update resets it to "landmark".',
        },
        glyph: { type: 'string', description: 'Emoji pin glyph, e.g. 🏰 🛖 🏚️ 🌲. Empty string keeps the existing glyph on update.' },
        dmNotes: { type: 'string', description: 'DM-only notes. NEVER sent to players. Empty string keeps the existing value on update.' },
        wikiPage: { type: 'string', description: 'Wiki article title (or full URL). Players get a "read more" link once they discover the location. Empty string keeps the existing value on update.' },
        showLabel: { type: 'boolean', description: 'Always render the title as a map label, not just an icon. Does NOT merge — omitting this on an update resets it to false.' },
        scaleVisibility: { type: 'integer', minimum: 0, maximum: 2, description: '0=fine only, 1=fine+mid, 2=every zoom. Does NOT merge — omitting this on an update resets it to 1.' },
        enabled: { type: 'boolean', description: 'Disabled content does not exist yet for players: no pin, no clues. Does NOT merge — omitting this on an update resets it to true. Re-pass the current value from list_locations if you only mean to change other fields.' },
        knownLocation: { type: 'boolean', description: 'Players always see the pin/name even with no discoveries; clues still gated. Does NOT merge — omitting this on an update resets it to false. Re-pass the current value from list_locations if you only mean to change other fields.' },
        quest: { type: 'string', description: 'Free-form quest tag for grouping. Empty string keeps the existing value on update.' },
        clues: {
          type: 'array',
          description:
            'FULLY REPLACES the existing clue list when provided (including a non-empty array). ' +
            'Omit this field, or pass clues:[], to leave existing clues untouched.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Player-facing text delivered on discovery. Never put DM-only/spoiler information here.' },
              gate: { type: 'object', description: GATE_DESCRIPTION },
              indicatesDirection: { type: 'boolean', description: 'Append an auto-computed compass bearing to the delivered text. Default: false.' },
              revealsLocation: { type: 'boolean', description: 'Whether discovering this clue pins down the location on the map. Default: true; set false for rumor/info-only clues.' },
            },
            required: ['text'],
          },
        },
      },
      required: ['mapId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_location',
    description: 'Permanently delete a location by its content id (from list_locations). Irreversible.',
    inputSchema: {
      type: 'object',
      properties: { contentId: { type: 'string' } },
      required: ['contentId'],
      additionalProperties: false,
    },
  },
  {
    name: 'upsert_trail',
    description:
      'Create or update a trail (tracks/spoor players can discover and follow) — an ordered ' +
      'path of hexes, matched to an existing trail by (mapId, name) case-insensitively so ' +
      'calling this again with the same name updates that trail\'s path and settings in place. ' +
      'Cells are axial q/r hex coordinates, at least 2, given in path order. Gate (' +
      GATE_DESCRIPTION +
      ') controls how the trail itself is discovered.',
    inputSchema: {
      type: 'object',
      properties: {
        mapId: { type: 'string', description: 'Map id from list_maps' },
        name: { type: 'string', description: 'Match key for upsert — case-insensitive' },
        glyph: { type: 'string', description: 'Emoji marker for the trail. Default: 👣' },
        dmNotes: { type: 'string', description: 'DM-only notes. NEVER sent to players.' },
        gate: { type: 'object', description: GATE_DESCRIPTION },
        cells: {
          type: 'array',
          description: 'Ordered hex path, at least 2 cells.',
          items: {
            type: 'object',
            properties: { q: { type: 'integer' }, r: { type: 'integer' } },
            required: ['q', 'r'],
          },
          minItems: 2,
        },
      },
      required: ['mapId', 'name', 'cells'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_settlement_clues',
    description:
      'Auto-generate the standard set of sensory discovery clues (smoke on the horizon, road ' +
      'noise, etc.) for every location of type "settlement" on a map that does not already have ' +
      'clues. Useful right after bulk-creating settlements with upsert_location. Idempotent — ' +
      'settlements that already have clues are left untouched, so it is safe to call again after ' +
      'adding new settlements.',
    inputSchema: {
      type: 'object',
      properties: { mapId: { type: 'string', description: 'Map id from list_maps' } },
      required: ['mapId'],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case 'list_maps':
      return api('GET', '/maps');
    case 'list_locations':
      return api('GET', `/maps/${encodeURIComponent(args.mapId)}/content`);
    case 'upsert_location':
      return api('POST', '/content', args);
    case 'delete_location':
      return api('DELETE', `/content/${encodeURIComponent(args.contentId)}`);
    case 'upsert_trail':
      return api('POST', '/trails', args);
    case 'generate_settlement_clues':
      return api('POST', '/generate-settlement-clues', args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const rl = createInterface({ input: process.stdin });
const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;
  if (method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    });
  } else if (method === 'tools/list') {
    write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    try {
      const result = await callTool(params.name, params.arguments ?? {});
      write({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      write({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
      });
    }
  } else if (method === 'ping') {
    write({ jsonrpc: '2.0', id, result: {} });
  } else if (id !== undefined) {
    write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
