/**
 * Seed a demo campaign — "The Wyrmfang Marches" — into a running server.
 *
 * A ready-made hex crawl for trying the app or reproducing the README media:
 * painted terrain, a party of three, a town with generated sensory clues, a
 * hidden village, a dragon's lair with distance-gated regional-effect clues,
 * a drag-trail, markers, and two terrain-bound encounter tables. Everything
 * goes through the same WebSocket command bus the UI uses.
 *
 * Usage (with `pnpm dev` or the Docker container running):
 *   node docs/demo/seed-demo-campaign.mjs [baseUrl]   # default http://localhost:3000
 *
 * Prints JSON: { campaignId, dmKey, playerKey, mapId, characters, tokens }.
 * Open `<app>/c/<campaignId>?key=<dmKey>` for the DM view.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'packages/server/package.json'));
const WebSocket = require('ws');

const BASE = process.argv[2] ?? 'http://localhost:3000';

// --- hex helpers (flat-top, odd-q offset -> axial) --------------------------
const ax = (col, row) => ({ q: col, r: row - ((col - (col & 1)) >> 1) });
const NEIGHBORS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];
const ring1 = ({ q, r }) => NEIGHBORS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
const key = (h) => `${h.q},${h.r}`;

// Deterministic PRNG for ragged zone edges.
let seed = 1234567;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);

// --- design the map ---------------------------------------------------------
const COLS = 22;
const ROWS = 14;
const terrain = new Map(); // key -> terrainId (also keyed set of all cells)

const zone = (col, row) => {
  if (col <= 1) return 'water';
  if (col === 2) return rand() < 0.25 ? 'water' : 'coast';
  if (col <= 6) return 'plains';
  if (col <= 12) {
    if (col >= 10 && row >= 10) return 'swamp';
    if (row === 0) return 'plains';
    return 'forest';
  }
  if (col <= 16) return 'hills';
  if (row <= 8) return 'mountains';
  return 'badlands';
};

for (let col = 0; col < COLS; col++) {
  for (let row = 0; row < ROWS; row++) {
    let t = zone(col, row);
    // ragged boundaries
    if (col === 7 && t === 'forest' && rand() < 0.35) t = 'plains';
    if (col === 12 && t === 'forest' && rand() < 0.3) t = 'hills';
    if (col === 16 && t === 'hills' && rand() < 0.35) t = 'mountains';
    if (col === 13 && t === 'hills' && rand() < 0.2) t = 'forest';
    terrain.set(key(ax(col, row)), t);
  }
}
// forest clearing at the camp
terrain.set(key(ax(9, 6)), 'plains');

// volcanic scarring around the lair (regional effect made visible)
const LAIR = ax(18, 3);
for (const h of ring1(LAIR)) if (terrain.has(key(h))) terrain.set(key(h), 'badlands');
terrain.set(key(LAIR), 'badlands');

// --- talk to the server -----------------------------------------------------
const res = await fetch(`${BASE}/api/campaigns`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'The Wyrmfang Marches', dmName: 'Demo DM' }),
});
if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`);
const { campaignId, dmKey, playerKey } = await res.json();
const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')])
  .map((c) => c.split(';')[0])
  .join('; ');

const wsUrl = `${BASE.replace(/^http/, 'ws')}/ws?campaign=${campaignId}`;
const sock = new WebSocket(wsUrl, { headers: { Cookie: cookie } });

let counter = 0;
const pending = new Map();
let snapshot = null;
let snapshotResolve = null;

sock.on('message', (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === 'snapshot') {
    snapshot = msg;
    snapshotResolve?.(msg);
  } else if (msg.type === 'ack' && pending.has(msg.commandId)) {
    pending.get(msg.commandId).resolve(msg);
    pending.delete(msg.commandId);
  } else if (msg.type === 'error') {
    const p = pending.get(msg.commandId);
    if (p) {
      p.reject(new Error(`command ${msg.commandId} rejected: ${msg.message}`));
      pending.delete(msg.commandId);
    } else {
      console.error('server error:', msg.message);
    }
  }
});

const send = (cmd) =>
  new Promise((resolve, reject) => {
    const id = `seed-${++counter}`;
    pending.set(id, { resolve, reject });
    sock.send(JSON.stringify({ ...cmd, id }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`command ${id} (${cmd.kind}) timed out`));
      }
    }, 10000);
  });

const nextSnapshot = () =>
  new Promise((resolve) => {
    snapshotResolve = resolve;
  });

/** Snapshots arrive on their own after each ack; wait for the latest one. */
const settle = () => new Promise((r) => setTimeout(r, 300));

await new Promise((resolve, reject) => {
  sock.on('open', resolve);
  sock.on('error', reject);
});
await nextSnapshot();
const mapId = snapshot.state.campaign.activeMapId;
if (!mapId) throw new Error('no active map');

// --- map & campaign ---------------------------------------------------------
await send({ kind: 'map.update', mapId, patch: { name: 'Wyrmfang Marches' } });
await send({
  kind: 'campaign.update',
  settings: {
    description:
      'Demo campaign: a wilderness crawl through the Wyrmfang Marches — a dragon in the peaks, smoke on the horizon, and a party that has to find both.',
  },
});

// --- terrain ----------------------------------------------------------------
const byTerrain = new Map();
for (const [k, t] of terrain) {
  const [q, r] = k.split(',').map(Number);
  if (!byTerrain.has(t)) byTerrain.set(t, []);
  byTerrain.get(t).push({ q, r });
}
for (const [t, cells] of byTerrain) {
  await send({ kind: 'terrain.paint', mapId, cells, terrain: t });
}

// --- characters & tokens ----------------------------------------------------
const CHARS = [
  {
    name: 'Mira Thornheart',
    color: '#3f8f4f',
    glyph: '🏹',
    speed: 30,
    skills: { perception: 7, survival: 5, nature: 4, stealth: 3 },
  },
  {
    name: 'Brant Ironmar',
    color: '#b0553a',
    glyph: '⚔️',
    speed: 30,
    skills: { perception: 1, survival: 0, history: 2, medicine: 2 },
  },
  {
    name: 'Sable Wren',
    color: '#6b5bd2',
    glyph: '✨',
    speed: 30,
    skills: { arcana: 6, history: 4, investigation: 5, perception: 0 },
  },
];
for (const c of CHARS) await send({ kind: 'character.create', character: c });
await settle();
const characters = snapshot.state.characters;

const CAMP = ax(9, 6);
for (const ch of characters) {
  await send({
    kind: 'token.create',
    mapId,
    q: CAMP.q,
    r: CAMP.r,
    tokenKind: 'pc',
    characterId: ch.id,
    label: ch.name.split(' ')[0],
    color: ch.color,
    glyph: ch.glyph,
    playerVisible: true,
  });
}

// group the three PCs into one party so they travel as a unit
await settle();
for (const t of snapshot.state.mapState?.tokens ?? []) {
  await send({ kind: 'token.update', tokenId: t.id, patch: { partyId: 'the-party' } });
}

// --- fog: the party's back-trail from Emberwick to the camp -----------------
const backTrail = [ax(4, 6), ax(5, 6), ax(6, 6), ax(7, 6), ax(8, 6), ax(8, 7)];
await send({ kind: 'fog.set', mapId, cells: backTrail, state: 'explored' });
const visibleRing = [CAMP, ...ring1(CAMP)];
await send({ kind: 'fog.set', mapId, cells: visibleRing, state: 'visible' });

// --- content ----------------------------------------------------------------
const EMBERWICK = ax(4, 6);
const DUNMERE = ax(4, 10);
const SPIRE = ax(14, 8);
const CACHE = ax(11, 4);

const forestCells = byTerrain.get('forest') ?? [];
const THORNWOOD_ANCHOR = ax(9, 3);
const thornArea = forestCells.filter((c) => key(c) !== key(THORNWOOD_ANCHOR));

const contents = [
  {
    id: null,
    mapId,
    ...EMBERWICK,
    type: 'settlement',
    title: 'Emberwick',
    glyph: '🏘️',
    dmNotes:
      'Market town, pop. ~800. Mayor Odile Harrow is quietly hiring adventurers: three farmsteads on the East Road burned this season, and the survivors all describe the same red wing-shadow.',
    showLabel: true,
    scaleVisibility: 1,
    knownLocation: true,
    wikiPage: 'Emberwick',
    quest: 'A Shadow Over the Marches',
    enabled: true,
    clues: [],
  },
  {
    id: null,
    mapId,
    ...DUNMERE,
    type: 'settlement',
    title: 'Dunmere',
    glyph: '🏘️',
    dmNotes:
      'Fishing village on the mere, pop. ~90. Not on any map the party has; they can find it by its hearth-smoke.',
    showLabel: false,
    scaleVisibility: 0,
    knownLocation: false,
    quest: '',
    enabled: true,
    clues: [],
  },
  {
    id: null,
    mapId,
    ...THORNWOOD_ANCHOR,
    area: thornArea,
    type: 'region',
    title: 'The Thornwood',
    glyph: '🗺️',
    dmNotes: 'Old-growth forest. Regional encounter table "Thornwood" applies.',
    showLabel: true,
    scaleVisibility: 2,
    knownLocation: true,
    quest: '',
    enabled: true,
    clues: [
      {
        id: null,
        text: 'Ancient oaks close overhead and the light goes green and dim. Game trails crisscross the gloom — none made by anything shod.',
        gate: { kind: 'auto' },
        sortOrder: 0,
        indicatesDirection: false,
        revealsLocation: false,
      },
    ],
  },
  {
    id: null,
    mapId,
    ...LAIR,
    area: ring1(LAIR),
    type: 'lair',
    title: "Cinderfang's Lair",
    glyph: '🐉',
    dmNotes:
      "Adult red dragon. Lair actions per the book. Regional effects within ~3 hexes: sulphurous haze, dead birdsong, unseasonal heat — the painted badlands scarring marks the blast radius. Hoard ≈ 9,400 gp plus the Harrow family signet.",
    showLabel: false,
    scaleVisibility: 1,
    knownLocation: false,
    quest: 'A Shadow Over the Marches',
    enabled: true,
    clues: [
      {
        id: null,
        text: 'The air carries a faint reek of sulphur, and the birdsong has stopped dead.',
        gate: { kind: 'skill', skill: 'survival', dc: 10, maxDistance: 3, mode: 'passive' },
        sortOrder: 0,
        indicatesDirection: true,
        revealsLocation: false,
      },
      {
        id: null,
        text: 'A distant, leathery wingbeat echoes off the peaks — something very large is aloft.',
        gate: { kind: 'skill', skill: 'perception', dc: 13, maxDistance: 5, mode: 'passive' },
        sortOrder: 1,
        indicatesDirection: true,
        revealsLocation: false,
      },
      {
        id: null,
        text: 'Charred pines raked by claws the length of scythes. A dragon hunts these slopes.',
        gate: { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 1, mode: 'passive' },
        sortOrder: 2,
        indicatesDirection: true,
        revealsLocation: true,
      },
      {
        id: null,
        text: 'A cave mouth exhales shimmering heat, its threshold ringed with scorched bone. You have found the dragon’s lair.',
        gate: { kind: 'auto' },
        sortOrder: 3,
        indicatesDirection: false,
        revealsLocation: true,
      },
    ],
  },
  {
    id: null,
    mapId,
    ...SPIRE,
    type: 'ruin',
    title: 'The Hollow Spire',
    glyph: '🗿',
    dmNotes:
      "Collapsed wizard's tower, pre-dating Emberwick. The scrying chamber below is intact — a safe vantage to study the lair, if cleared of stirges.",
    showLabel: false,
    scaleVisibility: 1,
    knownLocation: false,
    quest: '',
    enabled: true,
    clues: [
      {
        id: null,
        text: 'A broken spire of pale stone juts above the hilltops like a snapped mast.',
        gate: { kind: 'skill', skill: 'perception', dc: 12, maxDistance: 2, mode: 'passive' },
        sortOrder: 0,
        indicatesDirection: true,
        revealsLocation: true,
      },
      {
        id: null,
        text: 'The stonework is Netherese — this tower predates every kingdom on the map.',
        gate: { kind: 'skill', skill: 'history', dc: 13, maxDistance: 0, mode: 'active' },
        sortOrder: 1,
        indicatesDirection: false,
        revealsLocation: false,
      },
    ],
  },
  {
    id: null,
    mapId,
    ...CACHE,
    type: 'cache',
    title: 'Waymoot cache',
    glyph: '💰',
    dmNotes:
      'Strongbox buried by the last caravan through: 120 gp, two potions of fire resistance. Only a deliberate search finds it.',
    showLabel: false,
    scaleVisibility: 0,
    knownLocation: false,
    quest: '',
    enabled: true,
    clues: [
      {
        id: null,
        text: 'Beneath a lightning-split oak, fresh-turned earth over an iron strongbox.',
        gate: { kind: 'skill', skill: 'investigation', dc: 13, maxDistance: 0, mode: 'active' },
        sortOrder: 0,
        indicatesDirection: false,
        revealsLocation: true,
      },
    ],
  },
];
for (const content of contents) await send({ kind: 'content.upsert', content });

// settlement sensory clues (smoke / din / smell with compass bearings)
await send({ kind: 'clues.generateSettlements', mapId });

// --- trail ------------------------------------------------------------------
await send({
  kind: 'trail.upsert',
  trail: {
    id: null,
    mapId,
    name: 'Drag furrow',
    glyph: '🐾',
    dmNotes: 'Cinderfang dragging an ox carcass home. Leads from the forest edge up to the lair.',
    gate: { kind: 'skill', skill: 'survival', dc: 11, maxDistance: 1, mode: 'passive' },
    cells: [ax(12, 7), ax(13, 6), ax(14, 6), ax(15, 5), ax(16, 5), ax(17, 4)],
  },
});

// --- markers ----------------------------------------------------------------
await send({
  kind: 'marker.place',
  marker: { mapId, ...ax(9, 6), glyph: '⛺', label: 'Night camp', dmOnly: false },
});
await send({
  kind: 'marker.place',
  marker: { mapId, ...ax(6, 5), glyph: '🔥', label: 'Burned farmstead', dmOnly: false },
});
await send({
  kind: 'marker.place',
  marker: { mapId, ...ax(19, 6), glyph: '❗', label: 'Wyvern eyrie (unplaced)', dmOnly: true },
});

// --- encounter tables -------------------------------------------------------
await send({
  kind: 'encounterTable.upsert',
  table: {
    id: null,
    name: 'The Thornwood',
    terrains: ['forest'],
    die: '1d12',
    enabled: true,
    entries: [
      { min: 1, max: 2, text: 'Wolves shadowing the party at the edge of sight', quantity: '2d4' },
      { min: 3, max: 4, text: 'A moon-pale stag that is not a stag, watching', quantity: '' },
      { min: 5, max: 7, text: 'Deadfall across the trail — lose an hour or risk the brambles', quantity: '' },
      { min: 8, max: 9, text: 'Goblin foragers with a stolen Emberwick mule', quantity: '1d6' },
      { min: 10, max: 11, text: 'An owlbear’s territorial scrape, fresh', quantity: '' },
      { min: 12, max: 12, text: 'Kobold tribute-bearers hauling a cart of silver toward the peaks', quantity: '2d6' },
    ],
  },
});
await send({
  kind: 'encounterTable.upsert',
  table: {
    id: null,
    name: 'Wyrmfang foothills',
    terrains: ['hills', 'mountains', 'badlands'],
    die: '1d12',
    enabled: true,
    entries: [
      { min: 1, max: 3, text: 'Kobold raiding party wearing red-lacquered scale charms', quantity: '2d6' },
      { min: 4, max: 5, text: 'Rockslide — DC 12 Dexterity or 2d6 bludgeoning', quantity: '' },
      { min: 6, max: 8, text: 'A wyvern riding the thermals, hunting', quantity: '' },
      { min: 9, max: 10, text: 'Scorched sheep carcasses, a week old', quantity: '' },
      { min: 11, max: 11, text: 'A prospector who has seen the dragon and will not stop shaking', quantity: '' },
      { min: 12, max: 12, text: 'CINDERFANG passes high overhead. Everyone hides or is seen.', quantity: '' },
    ],
  },
});

await settle();
const tokens = snapshot.state.mapState?.tokens ?? [];
console.log(
  JSON.stringify(
    {
      campaignId,
      dmKey,
      playerKey,
      mapId,
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      tokens: tokens.map((t) => ({ id: t.id, characterId: t.characterId, label: t.label })),
    },
    null,
    2,
  ),
);
sock.close();
