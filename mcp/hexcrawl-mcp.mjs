#!/usr/bin/env node
/**
 * HexCrawl VTT — MCP server (stdio) for campaign integrations.
 *
 * Lets an agent (e.g. the dnd-dm-companion) add and update map locations in a
 * HexCrawl campaign when it creates wiki pages. Wraps the app's integration
 * REST API; no dependencies.
 *
 * Env:
 *   HEXCRAWL_URL      e.g. https://hex-crawl.deeznuts.wiki
 *   HEXCRAWL_CAMPAIGN campaign id, e.g. 6h7ANf52rU
 *   HEXCRAWL_TOKEN    the campaign's DM key
 *
 * Register (Claude Code): claude mcp add hexcrawl -e HEXCRAWL_URL=... \
 *   -e HEXCRAWL_CAMPAIGN=... -e HEXCRAWL_TOKEN=... -- node /path/to/hexcrawl-mcp.mjs
 */
import { createInterface } from 'node:readline';

const BASE = (process.env.HEXCRAWL_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const CAMPAIGN = process.env.HEXCRAWL_CAMPAIGN ?? '';
const TOKEN = process.env.HEXCRAWL_TOKEN ?? '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/integration/campaigns/${CAMPAIGN}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

const TOOLS = [
  {
    name: 'list_maps',
    description:
      'List the maps in the HexCrawl campaign (id, name, miles per hex, grid geometry). Use the map id with the other tools. Pixel coordinates for locations are in the map image frame (same frame as the wiki DataMaps).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_locations',
    description: 'List all content/locations on one map, including their hex coordinates, wiki pages, and clues.',
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
      'Create or update a location on a map (matched by title, case-insensitive — safe to call again after editing a wiki page). Give EITHER x/y pixel coordinates on the map image (preferred; same frame as the wiki DataMap markers) OR q/r hex coordinates. Set wikiPage to the wiki article title so players get a "read more" link. scaleVisibility: 0 = only visible when zoomed to fine hexes (hidden/small sites), 1 = fine+regional (default), 2 = visible at every zoom (cities, major landmarks). Clues control what players can learn: gate {kind:"auto"} reveals on arrival; {kind:"skill",skill,dc,maxDistance,mode:"passive"} reveals to characters whose passive skill beats the DC within range; {kind:"manual"} only when the DM reveals it.',
    inputSchema: {
      type: 'object',
      properties: {
        mapId: { type: 'string' },
        title: { type: 'string' },
        x: { type: 'number', description: 'Pixel x on the map image' },
        y: { type: 'number', description: 'Pixel y on the map image' },
        q: { type: 'integer', description: 'Axial hex q (alternative to x/y)' },
        r: { type: 'integer', description: 'Axial hex r (alternative to x/y)' },
        type: {
          type: 'string',
          enum: ['lair', 'dungeon', 'settlement', 'ruin', 'landmark', 'lore', 'hazard', 'cache', 'other'],
        },
        glyph: { type: 'string', description: 'Emoji pin glyph, e.g. 🏰 🛖 🏚️ 🌲' },
        dmNotes: { type: 'string' },
        wikiPage: { type: 'string', description: 'Wiki article title (or full URL)' },
        showLabel: { type: 'boolean', description: 'Always show the name on the map' },
        scaleVisibility: { type: 'integer', minimum: 0, maximum: 2 },
        clues: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, gate: { type: 'object' } },
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
    description: 'Delete a location by its content id (from list_locations).',
    inputSchema: {
      type: 'object',
      properties: { contentId: { type: 'string' } },
      required: ['contentId'],
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
        serverInfo: { name: 'hexcrawl', version: '1.0.0' },
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
