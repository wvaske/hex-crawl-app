import { z } from 'zod';
import { hexDistance, type HexCoord } from './hex/coords.js';

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

/** A campaign-defined travel mode, on top of the built-in list in rules/time. */
export const CustomTravelModeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  /** Miles per hour at normal pace. */
  mph: z.number().min(0.1).max(500),
});
export type CustomTravelMode = z.infer<typeof CustomTravelModeSchema>;

/**
 * Map settings that can be shared campaign-wide. A map lists the ones it
 * follows in `MapInfo.inheritedFields`; the server propagates a changed
 * default into every map inheriting that field (see the map manager, #60).
 * Defaults here mirror the values `map.create` used before inheritance
 * existed, so a brand-new campaign behaves exactly as it always did.
 */
const MapEncounterDefaultsSchema = z.object({
  die: z.string().default('1d20'),
  threshold: z.number().int().default(18),
  autoEvery: z.number().int().min(0).max(99).default(0),
});

export const MapDefaultsSchema = z.object({
  sightRadius: z.number().int().min(0).max(10).default(1),
  fogMode: z.enum(['manual', 'auto']).default('auto'),
  fogDecay: z.boolean().default(false),
  moveMode: z.enum(['step', 'free']).default('free'),
  moveApproval: z.boolean().default(false),
  milesPerHex: z.number().min(0).max(1000).default(6),
  encounterCheck: MapEncounterDefaultsSchema.default(() => MapEncounterDefaultsSchema.parse({})),
});
export type MapDefaults = z.infer<typeof MapDefaultsSchema>;

/** The map fields that can follow the campaign defaults. */
export const INHERITABLE_MAP_FIELDS = [
  'sightRadius',
  'fogMode',
  'fogDecay',
  'moveMode',
  'moveApproval',
  'milesPerHex',
  'encounterCheck',
] as const;
export type InheritableMapField = (typeof INHERITABLE_MAP_FIELDS)[number];

/**
 * A fantasy calendar laid over the campaign clock (issue #79). The clock stays
 * a plain minute count; this is naming only. Every month has the same length
 * (`monthLength`), and festivals are intercalary days that sit *between*
 * months and belong to no month — Harptos's Midwinter and friends. A year is
 * `months.length * monthLength + festivals.length` days long.
 */
export const CalendarFestivalSchema = z.object({
  name: z.string().min(1).max(60),
  /** 0-based index of the month this festival follows. */
  afterMonth: z.number().int().min(0).max(98),
});
export type CalendarFestival = z.infer<typeof CalendarFestivalSchema>;

export const CalendarConfigSchema = z.object({
  name: z.string().min(1).max(60),
  monthLength: z.number().int().min(1).max(99),
  months: z.array(z.string().min(1).max(60)).min(1).max(99),
  /** Year number of campaign day 1. */
  startYear: z.number().int().min(-99999).max(99999),
  /** Rendered after the year: "1492 DR". */
  yearSuffix: z.string().max(12).default(''),
  festivals: z.array(CalendarFestivalSchema).max(99).default([]),
  /** 0-based day-of-year the campaign starts on (0 = the first day). */
  startDayOfYear: z.number().int().min(0).max(9998).default(0),
});
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;

/** One row of a weather table: rolled value range → the day's weather. */
export const WeatherEntrySchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
  text: z.string().min(1).max(120),
  icon: z.string().max(8).default(''),
});
export type WeatherEntry = z.infer<typeof WeatherEntrySchema>;

/** The weather now, rolled when the clock last crossed into a new day. */
export const WeatherStateSchema = z.object({
  text: z.string().max(120),
  icon: z.string().max(8),
  rolledAtMinutes: z.number().int().min(0),
});
export type WeatherState = z.infer<typeof WeatherStateSchema>;

/** Die rolled against a weather table when the campaign has not set one. */
export const WEATHER_DIE = '1d20';

/**
 * Built-in temperate weather table (1d20), used when a campaign has not
 * configured `settings.weatherTable`. Deliberately fictional colour — nothing
 * mechanical hangs off it yet (pace/encounter hooks are a follow-up).
 */
export const DEFAULT_WEATHER_TABLE: WeatherEntry[] = [
  { min: 1, max: 5, text: 'Clear skies', icon: '☀️' },
  { min: 6, max: 9, text: 'Scattered cloud', icon: '🌤️' },
  { min: 10, max: 12, text: 'Overcast', icon: '☁️' },
  { min: 13, max: 14, text: 'Drizzle', icon: '🌦️' },
  { min: 15, max: 16, text: 'Steady rain', icon: '🌧️' },
  { min: 17, max: 17, text: 'Thick fog', icon: '🌫️' },
  { min: 18, max: 18, text: 'Hard wind', icon: '💨' },
  { min: 19, max: 19, text: 'Thunderstorm', icon: '⛈️' },
  { min: 20, max: 20, text: 'Violent storm', icon: '🌪️' },
];

export const CampaignSettingsSchema = z.object({
  /** Free text shown on the join screen. */
  description: z.string().max(2000).default(''),
  /** Base URL for wiki links on content (page titles are appended). */
  wikiBaseUrl: z.string().max(300).default(''),
  /** Extra travel modes for the campaign clock. */
  customTravelModes: z.array(CustomTravelModeSchema).default([]),
  /** Hour of day (0-23) the sun rises; drives day/night derivation. */
  sunriseHour: z.number().min(0).max(23).default(6),
  /** Hour of day (0-24) the sun sets. */
  sunsetHour: z.number().min(0).max(24).default(20),
  /**
   * Prep mode: while true, players keep seeing the map layers (terrain,
   * markers, content, images, trails) as they were when the pause began;
   * DM edits stay invisible until the pause is lifted. Tokens, fog and the
   * log stay live throughout.
   */
  pausePlayerMapSync: z.boolean().default(false),
  /** Campaign-wide map settings; maps opt in per field via inheritedFields. */
  mapDefaults: MapDefaultsSchema.default(() => MapDefaultsSchema.parse({})),
  /** Fantasy calendar naming for the clock; null renders plain "Day N". */
  calendar: CalendarConfigSchema.nullable().default(null),
  /** Weather table rolled at dawn; null uses DEFAULT_WEATHER_TABLE. */
  weatherTable: z.array(WeatherEntrySchema).max(100).nullable().default(null),
});
export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;

export const TravelPaceSchema = z.enum(['fast', 'normal', 'careful']);
export type TravelPace = z.infer<typeof TravelPaceSchema>;

/**
 * The campaign clock. `minutes` is in-game minutes since campaign start, so
 * day/hour arithmetic is pure integer math and a calendar can be layered on
 * later (issue #79). Campaigns begin at 8:00 AM on day 1.
 */
export const CampaignTimeSchema = z.object({
  minutes: z.number().int().min(0).default(8 * 60),
  /** Travel mode id — a built-in or one of settings.customTravelModes. */
  travelMode: z.string().min(1).max(40).default('foot'),
  pace: TravelPaceSchema.default('normal'),
  /**
   * Where the party stands and when they got there (clock minutes), so time
   * spent lingering can be credited to that hex when they leave.
   */
  partyHex: z
    .object({
      mapId: z.string(),
      q: z.number().int(),
      r: z.number().int(),
      arrivedMinutes: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  /**
   * The current weather, rerolled whenever the clock crosses into a new day
   * (issue #79). Null until the first roll — brand-new campaigns and any
   * campaign that predates the feature.
   */
  weather: WeatherStateSchema.nullable().default(null),
});
export type CampaignTime = z.infer<typeof CampaignTimeSchema>;

export const CampaignSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  activeMapId: z.string().nullable(),
  settings: CampaignSettingsSchema,
  /** Visible to everyone: players see the clock too. */
  time: CampaignTimeSchema,
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

/**
 * Player-editable free-form character info. Kept as plain strings — the
 * `notes` field is the storage shape the future wiki-notes sync (issue #64)
 * will read from, so it stays a simple string rather than rich content.
 */
export const CharacterExtraSchema = z.object({
  bio: z.string().max(5000).default(''),
  appearance: z.string().max(5000).default(''),
  goals: z.string().max(5000).default(''),
  inventory: z.string().max(5000).default(''),
  notes: z.string().max(5000).default(''),
});
export type CharacterExtra = z.infer<typeof CharacterExtraSchema>;

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  glyph: z.string().max(8),
  speed: z.number().int().min(0).max(120).default(30),
  skills: SkillsSchema,
  /** D&D Beyond character id, for one-click skill sync (public sheets only). */
  ddbId: z.string().nullable().default(null),
  /** Player-editable sheet extras: bio, appearance, goals, inventory, notes. */
  extra: CharacterExtraSchema.default({ bio: '', appearance: '', goals: '', inventory: '', notes: '' }),
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
  /** Auto-roll a check every N hexes of party travel (0 = off). */
  autoEvery: z.number().int().min(0).max(99).default(0),
  /** Server-managed: hexes travelled since the last auto check. */
  hexesSinceCheck: z.number().int().min(0).default(0),
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
  /**
   * Names of settings this map takes from `campaign.settings.mapDefaults`
   * (see INHERITABLE_MAP_FIELDS). The value below is always concrete — the
   * server writes the default through on change — so readers never resolve
   * inheritance themselves. Editing a field here drops it from this list.
   */
  inheritedFields: z.array(z.string()).default([]),
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
  /**
   * Sticker id from the client sticker library (`<category>/<slug>`, issue
   * #67). When set it wins over `glyph` for rendering; `glyph` is still stored
   * as the fallback for anything that cannot draw an SVG (and for markers
   * placed before the library existed).
   */
  icon: z.string().max(120).default(''),
  /** Render size multiplier for the placed sticker/glyph. */
  scale: z.number().min(0.5).max(3).default(1),
  label: z.string().max(120).default(''),
  dmOnly: z.boolean().default(false),
  /** Party note dropped by a player rather than the DM (issue #74). */
  playerPlaced: z.boolean().default(false),
  /** Seat that placed a player note; that seat (and the DM) may edit/delete it. */
  ownerSeatId: z.string().nullable().default(null),
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

/** A hex coordinate pair as stored inside content areas and trail paths. */
export const HexRefSchema = z.object({ q: z.number().int(), r: z.number().int() });

export const ContentSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  /** The anchor hex: where the pin/label sits, and always a member of the area. */
  q: z.number().int(),
  r: z.number().int(),
  /**
   * Multi-hex footprint (issue #69): the member hexes BESIDE the anchor. A
   * region is explored-if-any — every distance check, auto gate and search
   * uses the nearest member hex (see `distanceToContent`). Empty = a plain
   * single-hex pin, which is what everything was before footprints existed.
   */
  area: z.array(HexRefSchema).default([]),
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
  /**
   * Common knowledge: players always see this pin (name and place), even
   * with no discoveries. Clues stay gated — they know WHERE it is, not
   * what's true about it.
   */
  knownLocation: z.boolean().default(false),
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
  /** Another character shared what they knew. */
  z.object({ kind: z.literal('shared'), fromCharacterId: z.string() }),
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
  /**
   * The region's footprint. Only present because the view itself only exists
   * once the character has located (or commonly knows) the place — an
   * undiscovered region never reaches a player at all.
   */
  area: z.array(HexRefSchema).default([]),
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

/**
 * Per-hex visit accounting for the party, in campaign-clock minutes. Feeds
 * "when were we here?" (#66) and time-spent-in-hex (#59). Player-visible for
 * non-hidden hexes — it is the party's own travel history and carries no
 * DM-only data beyond coordinates and clock stamps.
 */
export const HexVisitSchema = z.object({
  q: z.number().int(),
  r: z.number().int(),
  /** Clock minutes at the party's first arrival on this hex. */
  firstArrived: z.number().int().min(0),
  /** Clock minutes at their most recent arrival. */
  lastArrived: z.number().int().min(0),
  /** Total minutes the party has spent standing here (travel time excluded). */
  totalMinutes: z.number().int().min(0).default(0),
});
export type HexVisit = z.infer<typeof HexVisitSchema>;

/**
 * One character's one shot at searching one hex with one skill (issue #107).
 * The row IS the limit: a player may not roll the same skill on the same hex
 * twice until the DM clears the attempt. DM-initiated group rolls record
 * attempts too (so the investigation view shows the history) but ignore the
 * limit.
 */
export const SearchAttemptSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  characterId: z.string(),
  skill: z.string(),
  roll: z.number().int(),
  modifier: z.number().int(),
  total: z.number().int(),
  at: z.number(),
});
export type SearchAttempt = z.infer<typeof SearchAttemptSchema>;

/**
 * A clue a player's search roll beat, waiting on the DM's call (issue #107).
 * Everything the discovery will need is frozen here at roll time — the
 * bearing and whether the find locates the source are computed against where
 * the character stood when they rolled, not where they stand when the DM
 * gets round to it. DM-only: `filterStateForViewer` sends players none.
 */
export const PendingRevealSchema = z.object({
  id: z.string(),
  clueId: z.string(),
  characterId: z.string(),
  /** The search_attempt this came out of (carries the skill and the hex). */
  attemptId: z.string(),
  direction: z.string().nullable().default(null),
  locates: z.boolean().default(false),
  roll: z.number().int(),
  modifier: z.number().int(),
  total: z.number().int(),
  at: z.number(),
});
export type PendingReveal = z.infer<typeof PendingRevealSchema>;

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
  /** Party visit records; players see them for hexes that aren't fogged out. */
  visits: z.array(HexVisitSchema).default([]),
  /**
   * Search rolls made on this map (issue #107). DM: every character's;
   * players: their own character's only, so the Search UI can grey out the
   * skills they have already spent on a hex.
   */
  searchAttempts: z.array(SearchAttemptSchema).default([]),
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
  /** DM only: search results awaiting the DM's share/withhold call. */
  pendingReveals: z.array(PendingRevealSchema).default([]),
  /** DM only; empty for players. */
  encounterTables: z.array(EncounterTableSchema),
  log: z.array(LogEntrySchema),
});
export type CampaignState = z.infer<typeof CampaignStateSchema>;

export function isFullContent(c: Content | ContentPlayerView): c is Content {
  return 'clues' in c;
}

// ---------------------------------------------------------------------------
// Content footprints (issue #69)
// ---------------------------------------------------------------------------

/** The minimum a footprint helper needs: an anchor hex and optional members. */
export interface ContentFootprint {
  q: number;
  r: number;
  area?: HexCoord[];
}

/**
 * Every hex a content item occupies: the anchor first, then its area members
 * (de-duplicated, so an area that redundantly lists the anchor is harmless).
 */
export function contentCells(content: ContentFootprint): HexCoord[] {
  const cells: HexCoord[] = [{ q: content.q, r: content.r }];
  const seen = new Set([`${content.q},${content.r}`]);
  for (const cell of content.area ?? []) {
    const key = `${cell.q},${cell.r}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ q: cell.q, r: cell.r });
  }
  return cells;
}

/** Does this content occupy the given hex (anchor or any area member)? */
export function contentCoversHex(content: ContentFootprint, hex: HexCoord): boolean {
  if (content.q === hex.q && content.r === hex.r) return true;
  return (content.area ?? []).some((c) => c.q === hex.q && c.r === hex.r);
}

/** The member hex of `content` closest to `from` (the anchor when there's no area). */
export function nearestContentCell(content: ContentFootprint, from: HexCoord): HexCoord {
  let best: HexCoord = { q: content.q, r: content.r };
  let bestDistance = hexDistance(from, best);
  for (const cell of content.area ?? []) {
    const d = hexDistance(from, cell);
    if (d < bestDistance) {
      bestDistance = d;
      best = { q: cell.q, r: cell.r };
    }
  }
  return best;
}

/**
 * Distance from a character to a content item: the MINIMUM distance to any
 * hex of its footprint. This is what makes a multi-hex region behave as one
 * place — standing anywhere inside it counts as being "on" it (distance 0),
 * so auto gates fire and location discoveries upgrade on entering any member.
 */
export function distanceToContent(content: ContentFootprint, from: HexCoord): number {
  return hexDistance(from, nearestContentCell(content, from));
}
