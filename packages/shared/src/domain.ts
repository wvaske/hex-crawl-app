import { z } from 'zod';

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN_IDS = [
  'plains',
  'forest',
  'hills',
  'mountains',
  'desert',
  'swamp',
  'water',
  'coast',
  'tundra',
  'jungle',
  'urban',
  'badlands',
] as const;

export const TerrainIdSchema = z.enum(TERRAIN_IDS);
export type TerrainId = z.infer<typeof TerrainIdSchema>;

export interface TerrainDef {
  id: TerrainId;
  label: string;
  color: string; // base fill
  glyph: string; // small decorative glyph drawn on the hex
}

export const TERRAINS: Record<TerrainId, TerrainDef> = {
  plains: { id: 'plains', label: 'Plains', color: '#a8c66c', glyph: '' },
  forest: { id: 'forest', label: 'Forest', color: '#4e7a3a', glyph: '♠' },
  hills: { id: 'hills', label: 'Hills', color: '#b5a45c', glyph: '︵' },
  mountains: { id: 'mountains', label: 'Mountains', color: '#8d8578', glyph: '▲' },
  desert: { id: 'desert', label: 'Desert', color: '#e0c988', glyph: '∙' },
  swamp: { id: 'swamp', label: 'Swamp', color: '#5d6e50', glyph: '҂' },
  water: { id: 'water', label: 'Water', color: '#4a7fa5', glyph: '≈' },
  coast: { id: 'coast', label: 'Coast', color: '#7ba7c2', glyph: '~' },
  tundra: { id: 'tundra', label: 'Tundra', color: '#c9d4d6', glyph: '❄' },
  jungle: { id: 'jungle', label: 'Jungle', color: '#2e6b3e', glyph: '❦' },
  urban: { id: 'urban', label: 'Urban', color: '#9a8f9e', glyph: '⌂' },
  badlands: { id: 'badlands', label: 'Badlands', color: '#a5714f', glyph: '×' },
};

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const CORE_SKILLS = [
  'perception',
  'survival',
  'nature',
  'arcana',
  'religion',
  'history',
  'investigation',
  'insight',
  'stealth',
  'medicine',
] as const;

export type CoreSkill = (typeof CORE_SKILLS)[number];

/** Skill name -> modifier. Core skills plus any custom ones the table adds. */
export const SkillsSchema = z.record(z.string(), z.number().int().min(-10).max(20));
export type Skills = z.infer<typeof SkillsSchema>;

export function passiveScore(skills: Skills, skill: string): number {
  return 10 + (skills[skill] ?? 0);
}

// ---------------------------------------------------------------------------
// Fog
// ---------------------------------------------------------------------------

export const FogStateSchema = z.enum(['hidden', 'explored', 'visible']);
export type FogState = z.infer<typeof FogStateSchema>;

// ---------------------------------------------------------------------------
// Campaign / seats / characters
// ---------------------------------------------------------------------------

export const CampaignSettingsSchema = z.object({
  /** Free text shown on the join screen. */
  description: z.string().max(2000).default(''),
  /** Base URL for wiki links on content (page titles are appended). */
  wikiBaseUrl: z.string().max(300).default('https://wiki.deeznuts.wiki/index.php/'),
});
export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  activeMapId: z.string().nullable(),
  settings: CampaignSettingsSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const SeatRoleSchema = z.enum(['dm', 'player']);
export type SeatRole = z.infer<typeof SeatRoleSchema>;

/** Public view of a seat (no auth token). */
export const SeatPublicSchema = z.object({
  id: z.string(),
  role: SeatRoleSchema,
  name: z.string(),
  characterId: z.string().nullable(),
  online: z.boolean(),
});
export type SeatPublic = z.infer<typeof SeatPublicSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  glyph: z.string().max(8),
  speed: z.number().int().min(0).max(120).default(30),
  skills: SkillsSchema,
  /** D&D Beyond character id, for one-click skill sync (public sheets only). */
  ddbId: z.string().nullable().default(null),
});
export type Character = z.infer<typeof CharacterSchema>;

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export const GridStyleSchema = z.object({
  lineColor: z.string().default('#000000'),
  lineOpacity: z.number().min(0).max(1).default(0.35),
  lineWidth: z.number().min(0.5).max(8).default(1.5),
  terrainOpacity: z.number().min(0).max(1).default(0.55),
});
export type GridStyle = z.infer<typeof GridStyleSchema>;

export const MoveModeSchema = z.enum(['step', 'free']);
export const FogModeSchema = z.enum(['manual', 'auto']);

export const EncounterCheckConfigSchema = z.object({
  /** Die rolled for the encounter check, e.g. "1d20". */
  die: z.string().default('1d20'),
  /** An encounter occurs when the roll is >= this threshold. */
  threshold: z.number().int().default(18),
});
export type EncounterCheckConfig = z.infer<typeof EncounterCheckConfigSchema>;

export const MapInfoSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  orientation: z.enum(['pointy', 'flat']),
  /** Hex circumradius in world pixels. */
  hexSize: z.number().min(4).max(512),
  originX: z.number(),
  originY: z.number(),
  gridStyle: GridStyleSchema,
  /** Hexes revealed around a PC token when fogMode is auto. */
  sightRadius: z.number().int().min(0).max(10).default(1),
  fogMode: FogModeSchema.default('auto'),
  /** Whether previously-visible hexes decay to explored when unobserved. */
  fogDecay: z.boolean().default(true),
  moveMode: MoveModeSchema.default('free'),
  /** Player moves become requests the DM approves (turn-based travel). */
  moveApproval: z.boolean().default(false),
  /** Real-world miles per hex, for display. */
  milesPerHex: z.number().min(0).max(1000).default(6),
  encounterCheck: EncounterCheckConfigSchema,
  sortOrder: z.number().int().default(0),
});
export type MapInfo = z.infer<typeof MapInfoSchema>;

export const ImageLayerSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  /** URL path under /uploads. */
  path: z.string(),
  name: z.string().default('Map image'),
  x: z.number().default(0),
  y: z.number().default(0),
  scale: z.number().min(0.01).max(100).default(1),
  opacity: z.number().min(0).max(1).default(1),
  z: z.number().int().default(0),
  dmOnly: z.boolean().default(false),
  /** Overlay toggle: hidden for everyone when false. */
  visible: z.boolean().default(true),
});
export type ImageLayer = z.infer<typeof ImageLayerSchema>;

/** A painted hex cell. Unpainted hexes have no entry. */
export const HexCellSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  terrain: TerrainIdSchema,
});
export type HexCell = z.infer<typeof HexCellSchema>;

/** A player's declared move awaiting DM approval (in-memory, per map). */
export const PendingMoveSchema = z.object({
  tokenId: z.string(),
  fromQ: z.number().int(),
  fromR: z.number().int(),
  toQ: z.number().int(),
  toR: z.number().int(),
  seatId: z.string(),
  label: z.string(),
  color: z.string(),
  at: z.number(),
});
export type PendingMove = z.infer<typeof PendingMoveSchema>;

export const FogCellSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  state: FogStateSchema,
});
export type FogCell = z.infer<typeof FogCellSchema>;

// ---------------------------------------------------------------------------
// Tokens & markers
// ---------------------------------------------------------------------------

export const TokenKindSchema = z.enum(['pc', 'npc']);
export type TokenKind = z.infer<typeof TokenKindSchema>;

export const TokenSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  kind: TokenKindSchema,
  characterId: z.string().nullable(),
  label: z.string().max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  glyph: z.string().max(8),
  playerVisible: z.boolean().default(true),
  /** Tokens sharing a partyId move together; any member's move shifts the group. */
  partyId: z.string().nullable().default(null),
});
export type Token = z.infer<typeof TokenSchema>;

export const MarkerSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  glyph: z.string().min(1).max(8),
  label: z.string().max(120).default(''),
  dmOnly: z.boolean().default(false),
});
export type Marker = z.infer<typeof MarkerSchema>;

/** Curated marker glyph library, grouped for the picker UI. */
export const MARKER_LIBRARY: { group: string; glyphs: { glyph: string; name: string }[] }[] = [
  {
    group: 'Hazards & effects',
    glyphs: [
      { glyph: '🔥', name: 'Fire' },
      { glyph: '⛈️', name: 'Storm' },
      { glyph: '🌫️', name: 'Fog / miasma' },
      { glyph: '❄️', name: 'Freezing' },
      { glyph: '☠️', name: 'Deadly' },
      { glyph: '☣️', name: 'Corruption' },
      { glyph: '🕸️', name: 'Webs' },
      { glyph: '🌊', name: 'Flood' },
    ],
  },
  {
    group: 'Places',
    glyphs: [
      { glyph: '🏰', name: 'Keep' },
      { glyph: '🏘️', name: 'Village' },
      { glyph: '⛺', name: 'Camp' },
      { glyph: '🕳️', name: 'Cave' },
      { glyph: '🗼', name: 'Tower' },
      { glyph: '⚓', name: 'Harbor' },
      { glyph: '🌉', name: 'Bridge' },
      { glyph: '⛩️', name: 'Shrine' },
    ],
  },
  {
    group: 'Story',
    glyphs: [
      { glyph: '❗', name: 'Danger' },
      { glyph: '❓', name: 'Mystery' },
      { glyph: '⭐', name: 'Objective' },
      { glyph: '💰', name: 'Treasure' },
      { glyph: '🐉', name: 'Lair' },
      { glyph: '⚔️', name: 'Battle' },
      { glyph: '🚩', name: 'Rally point' },
      { glyph: '📜', name: 'Note' },
      { glyph: '👣', name: 'Footsteps / tracks' },
      { glyph: '🐾', name: 'Animal tracks' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Content, clues, discoveries
// ---------------------------------------------------------------------------

export const CONTENT_TYPES = [
  'lair',
  'dungeon',
  'settlement',
  'ruin',
  'landmark',
  'region',
  'lore',
  'hazard',
  'cache',
  'other',
] as const;
export const ContentTypeSchema = z.enum(CONTENT_TYPES);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const CONTENT_TYPE_GLYPHS: Record<ContentType, string> = {
  lair: '🐉',
  dungeon: '🏛️',
  settlement: '🏘️',
  ruin: '🗿',
  landmark: '🗻',
  region: '🗺️',
  lore: '📜',
  hazard: '☠️',
  cache: '💰',
  other: '📍',
};

export const GateSchema = z.discriminatedUnion('kind', [
  /** Revealed to any character whose token enters the content hex. */
  z.object({ kind: z.literal('auto') }),
  /**
   * Revealed when a character within `maxDistance` hexes has
   * passive skill >= dc (mode 'passive'), or via a DM-triggered roll
   * (mode 'active').
   */
  z.object({
    kind: z.literal('skill'),
    skill: z.string().min(1),
    dc: z.number().int().min(1).max(40),
    maxDistance: z.number().int().min(0).max(30),
    mode: z.enum(['passive', 'active']).default('passive'),
  }),
  /** Only the DM can reveal it. */
  z.object({ kind: z.literal('manual') }),
]);
export type Gate = z.infer<typeof GateSchema>;

export const ClueSchema = z.object({
  id: z.string(),
  contentId: z.string(),
  /** Player-facing text delivered on discovery. */
  text: z.string().min(1).max(2000),
  gate: GateSchema,
  sortOrder: z.number().int().default(0),
  /**
   * Append an auto-computed compass bearing (from the discovering character
   * toward this content's hex) to the delivered text: "… — to the north-east".
   */
  indicatesDirection: z.boolean().default(false),
  /**
   * Whether discovering this clue on the hex pins down the content's
   * location. Info-only clues (tracks, rumors) never reveal the pin, so an
   * item can stay hidden until a specific check finds it.
   */
  revealsLocation: z.boolean().default(true),
});
export type Clue = z.infer<typeof ClueSchema>;

export const ContentSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  type: ContentTypeSchema,
  title: z.string().min(1).max(120),
  dmNotes: z.string().max(10000).default(''),
  glyph: z.string().max(8).default(''),
  /** Render the title as an always-on map label (major towns and the like). */
  showLabel: z.boolean().default(false),
  /** Coarsest hex scale the pin is visible at: 0=fine only, 1=+mid, 2=all. */
  scaleVisibility: z.number().int().min(0).max(2).default(1),
  /** Disabled content doesn't exist yet for players: no clues, no pin. */
  enabled: z.boolean().default(true),
  /** Free-form quest tag for grouping (enable/disable a whole quest). */
  quest: z.string().max(120).default(''),
  /** Wiki page title (or full URL) players can read for more information. */
  wikiPage: z.string().max(300).default(''),
  clues: z.array(ClueSchema),
});
export type Content = z.infer<typeof ContentSchema>;

export const DiscoveryHowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto') }),
  z.object({
    kind: z.literal('passive'),
    skill: z.string(),
    passive: z.number(),
    dc: z.number(),
    distance: z.number(),
  }),
  z.object({
    kind: z.literal('roll'),
    skill: z.string(),
    roll: z.number(),
    modifier: z.number(),
    total: z.number(),
    dc: z.number(),
  }),
  z.object({ kind: z.literal('manual') }),
]);
export type DiscoveryHow = z.infer<typeof DiscoveryHowSchema>;

export const DiscoverySchema = z.object({
  id: z.string(),
  clueId: z.string(),
  characterId: z.string(),
  at: z.number(), // epoch ms
  how: DiscoveryHowSchema,
  /** Compass bearing sensed at discovery time (clue's indicatesDirection). */
  direction: z.string().nullable().default(null),
  /**
   * Whether this discovery pins down the source's location (made on the hex
   * itself, or DM-revealed). Distance discoveries start false and upgrade
   * when the character later reaches the hex.
   */
  locates: z.boolean().default(false),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

/** What a player sees of a content entry: only what their character discovered. */
export const ContentPlayerViewSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  type: ContentTypeSchema,
  title: z.string(),
  glyph: z.string(),
  showLabel: z.boolean().default(false),
  scaleVisibility: z.number().int().min(0).max(2).default(1),
  wikiPage: z.string().default(''),
  discoveredClues: z.array(
    z.object({ clueId: z.string(), text: z.string(), at: z.number() }),
  ),
});
export type ContentPlayerView = z.infer<typeof ContentPlayerViewSchema>;

// ---------------------------------------------------------------------------
// Encounters
// ---------------------------------------------------------------------------

export const EncounterEntrySchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
  text: z.string().min(1).max(1000),
  /** Optional quantity dice, e.g. "2d4". */
  quantity: z.string().default(''),
});
export type EncounterEntry = z.infer<typeof EncounterEntrySchema>;

export const EncounterTableSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  /** Terrains this table applies to. Empty = any terrain. */
  terrains: z.array(TerrainIdSchema),
  /** Dice rolled against the entries, e.g. "2d6" or "1d12". */
  die: z.string().default('1d12'),
  entries: z.array(EncounterEntrySchema),
  /** Disabled tables are never picked by terrain matching (session curation). */
  enabled: z.boolean().default(true),
});
export type EncounterTable = z.infer<typeof EncounterTableSchema>;

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export const LogVisibilitySchema = z.union([
  z.literal('dm'),
  z.literal('all'),
  z.string(), // a specific seatId
]);

export const LogEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.string(),
  text: z.string(),
  /** 'dm' | 'all' | seatId */
  visibility: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

// ---------------------------------------------------------------------------
// Aggregate state (what a snapshot carries)
// ---------------------------------------------------------------------------

/**
 * A trail: one ordered path of cells (tracks, footprints, a blazed route).
 * Standing on a cell "pushes" the party along: the walker learns the
 * direction to the next and previous cells, never the whole path.
 */
export const TrailSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  name: z.string().min(1).max(120),
  /** Glyph stamped on each discovered cell. */
  glyph: z.string().max(8).default('👣'),
  dmNotes: z.string().max(10000).default(''),
  /** How a cell of the trail is noticed (distance is from the walker to the cell). */
  gate: GateSchema.default({ kind: 'auto' }),
  cells: z.array(z.object({ q: z.number().int(), r: z.number().int() })).min(2),
});
export type Trail = z.infer<typeof TrailSchema>;

/** One character's knowledge of one trail cell. */
export const TrailDiscoverySchema = z.object({
  id: z.string(),
  trailId: z.string(),
  cellIndex: z.number().int(),
  characterId: z.string(),
  at: z.number(),
});
export type TrailDiscovery = z.infer<typeof TrailDiscoverySchema>;

/**
 * A rendered trail sign: a discovered cell with the bearings onward and back.
 * Angles are map-space degrees (0 = east, screen clockwise) for drawing
 * arrows; compass names are for prose.
 */
export const TrailSignSchema = z.object({
  trailId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  glyph: z.string(),
  forward: z.string().nullable(),
  backward: z.string().nullable(),
  forwardAngle: z.number().nullable(),
  backwardAngle: z.number().nullable(),
});
export type TrailSign = z.infer<typeof TrailSignSchema>;

export const MapStateSchema = z.object({
  imageLayers: z.array(ImageLayerSchema),
  hexes: z.array(HexCellSchema),
  fog: z.array(FogCellSchema),
  tokens: z.array(TokenSchema),
  markers: z.array(MarkerSchema),
  /** DM: full Content[]; players: ContentPlayerView[] */
  contents: z.array(z.union([ContentSchema, ContentPlayerViewSchema])),
  pendingMoves: z.array(PendingMoveSchema).default([]),
  /** DM only: full trail definitions (players receive trailSigns instead). */
  trails: z.array(TrailSchema).default([]),
  /** Players: signs for the trail cells their character has discovered. */
  trailSigns: z.array(TrailSignSchema).default([]),
});
export type MapState = z.infer<typeof MapStateSchema>;

/**
 * A player's sensed clue on the current map: the information itself, without
 * the source's location. `observableFrom` is the set of hexes the character
 * has already visited from which this clue can be sensed — the raw material
 * for triangulating the source.
 */
export const SenseSchema = z.object({
  clueId: z.string(),
  /** Raw clue text (direction is carried separately). */
  text: z.string(),
  /** Bearing toward the source: live while in range, else the discovery snapshot. */
  direction: z.string().nullable(),
  /** Whether the clue is observable from the character's current hex. */
  inRange: z.boolean(),
  /** When it was first discovered (epoch ms). */
  at: z.number(),
  /** Visited hexes from which this clue can be sensed. */
  observableFrom: z.array(z.object({ q: z.number().int(), r: z.number().int() })),
  /** True once the source itself has been located (pin shown on the map). */
  located: z.boolean(),
  /** Source title, revealed only once located. */
  contentTitle: z.string().nullable(),
});
export type Sense = z.infer<typeof SenseSchema>;

export const CampaignStateSchema = z.object({
  campaign: CampaignSchema,
  seats: z.array(SeatPublicSchema),
  characters: z.array(CharacterSchema),
  maps: z.array(MapInfoSchema),
  mapState: MapStateSchema.nullable(),
  /** DM: all; player: own character's. */
  discoveries: z.array(DiscoverySchema),
  /** DM: all; player: own character's. */
  trailDiscoveries: z.array(TrailDiscoverySchema).default([]),
  /** Player only: sensed clues on the viewed map; empty for the DM. */
  senses: z.array(SenseSchema).default([]),
  /** DM only; empty for players. */
  encounterTables: z.array(EncounterTableSchema),
  log: z.array(LogEntrySchema),
});
export type CampaignState = z.infer<typeof CampaignStateSchema>;

export function isFullContent(c: Content | ContentPlayerView): c is Content {
  return 'clues' in c;
}
