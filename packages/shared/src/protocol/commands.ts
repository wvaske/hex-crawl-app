import { z } from 'zod';
import {
  CampaignSettingsSchema,
  CharacterSchema,
  ContentTypeSchema,
  ClueSchema,
  EncounterCheckConfigSchema,
  EncounterTableSchema,
  FogStateSchema,
  GridStyleSchema,
  MarkerSchema,
  TerrainIdSchema,
  TokenKindSchema,
} from '../domain.js';

/**
 * Client -> server commands. Every mutation in the app is one of these,
 * sent over the WebSocket. Each carries a client-generated `id` that the
 * server echoes back in an ack or error.
 */

const base = { id: z.string().min(1).max(64) };

const CellsSchema = z
  .array(z.object({ q: z.number().int(), r: z.number().int() }))
  .min(1)
  .max(5000);

// --- campaign ---------------------------------------------------------------

export const CampaignUpdateCommand = z.object({
  ...base,
  kind: z.literal('campaign.update'),
  name: z.string().min(1).max(120).optional(),
  settings: CampaignSettingsSchema.partial().optional(),
});

// --- maps -------------------------------------------------------------------

export const MapCreateCommand = z.object({
  ...base,
  kind: z.literal('map.create'),
  name: z.string().min(1).max(120),
  orientation: z.enum(['pointy', 'flat']).default('flat'),
  hexSize: z.number().min(4).max(512).default(48),
});

export const MapUpdateCommand = z.object({
  ...base,
  kind: z.literal('map.update'),
  mapId: z.string(),
  patch: z
    .object({
      name: z.string().min(1).max(120),
      orientation: z.enum(['pointy', 'flat']),
      hexSize: z.number().min(4).max(512),
      originX: z.number(),
      originY: z.number(),
      gridStyle: GridStyleSchema.partial(),
      sightRadius: z.number().int().min(0).max(10),
      fogMode: z.enum(['manual', 'auto']),
      fogDecay: z.boolean(),
      moveMode: z.enum(['step', 'free']),
      milesPerHex: z.number().min(0).max(1000),
      encounterCheck: EncounterCheckConfigSchema.partial(),
      sortOrder: z.number().int(),
    })
    .partial(),
});

export const MapDeleteCommand = z.object({
  ...base,
  kind: z.literal('map.delete'),
  mapId: z.string(),
});

export const MapSetActiveCommand = z.object({
  ...base,
  kind: z.literal('map.setActive'),
  mapId: z.string(),
});

// --- image layers -----------------------------------------------------------

export const ImageLayerUpdateCommand = z.object({
  ...base,
  kind: z.literal('imageLayer.update'),
  layerId: z.string(),
  patch: z
    .object({
      name: z.string().max(120),
      x: z.number(),
      y: z.number(),
      scale: z.number().min(0.01).max(100),
      opacity: z.number().min(0).max(1),
      z: z.number().int(),
      dmOnly: z.boolean(),
    })
    .partial(),
});

export const ImageLayerDeleteCommand = z.object({
  ...base,
  kind: z.literal('imageLayer.delete'),
  layerId: z.string(),
});

// --- terrain ----------------------------------------------------------------

export const TerrainPaintCommand = z.object({
  ...base,
  kind: z.literal('terrain.paint'),
  mapId: z.string(),
  cells: CellsSchema,
  /** null erases. */
  terrain: TerrainIdSchema.nullable(),
});

// --- fog --------------------------------------------------------------------

export const FogSetCommand = z.object({
  ...base,
  kind: z.literal('fog.set'),
  mapId: z.string(),
  cells: CellsSchema,
  state: FogStateSchema,
});

// --- tokens -----------------------------------------------------------------

export const TokenCreateCommand = z.object({
  ...base,
  kind: z.literal('token.create'),
  mapId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
  tokenKind: TokenKindSchema,
  characterId: z.string().nullable().default(null),
  label: z.string().max(60).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e05555'),
  glyph: z.string().max(8).default(''),
  playerVisible: z.boolean().default(true),
});

export const TokenUpdateCommand = z.object({
  ...base,
  kind: z.literal('token.update'),
  tokenId: z.string(),
  patch: z
    .object({
      label: z.string().max(60),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      glyph: z.string().max(8),
      playerVisible: z.boolean(),
      characterId: z.string().nullable(),
    })
    .partial(),
});

export const TokenMoveCommand = z.object({
  ...base,
  kind: z.literal('token.move'),
  tokenId: z.string(),
  q: z.number().int(),
  r: z.number().int(),
});

export const TokenDeleteCommand = z.object({
  ...base,
  kind: z.literal('token.delete'),
  tokenId: z.string(),
});

// --- markers ----------------------------------------------------------------

export const MarkerPlaceCommand = z.object({
  ...base,
  kind: z.literal('marker.place'),
  marker: MarkerSchema.omit({ id: true }),
});

export const MarkerUpdateCommand = z.object({
  ...base,
  kind: z.literal('marker.update'),
  markerId: z.string(),
  patch: z
    .object({
      q: z.number().int(),
      r: z.number().int(),
      glyph: z.string().min(1).max(8),
      label: z.string().max(120),
      dmOnly: z.boolean(),
    })
    .partial(),
});

export const MarkerDeleteCommand = z.object({
  ...base,
  kind: z.literal('marker.delete'),
  markerId: z.string(),
});

// --- characters & seats -----------------------------------------------------

export const CharacterCreateCommand = z.object({
  ...base,
  kind: z.literal('character.create'),
  character: CharacterSchema.omit({ id: true }),
});

export const CharacterUpdateCommand = z.object({
  ...base,
  kind: z.literal('character.update'),
  characterId: z.string(),
  patch: CharacterSchema.omit({ id: true }).partial(),
});

export const CharacterDeleteCommand = z.object({
  ...base,
  kind: z.literal('character.delete'),
  characterId: z.string(),
});

export const SeatClaimCharacterCommand = z.object({
  ...base,
  kind: z.literal('seat.claimCharacter'),
  characterId: z.string().nullable(),
});

export const SeatRenameCommand = z.object({
  ...base,
  kind: z.literal('seat.rename'),
  name: z.string().min(1).max(60),
});

// --- content & clues --------------------------------------------------------

export const ContentUpsertCommand = z.object({
  ...base,
  kind: z.literal('content.upsert'),
  content: z.object({
    id: z.string().nullable(), // null = create
    mapId: z.string(),
    q: z.number().int(),
    r: z.number().int(),
    type: ContentTypeSchema,
    title: z.string().min(1).max(120),
    dmNotes: z.string().max(10000).default(''),
    glyph: z.string().max(8).default(''),
    clues: z.array(
      ClueSchema.omit({ id: true, contentId: true }).extend({
        id: z.string().nullable().default(null),
      }),
    ),
  }),
});

export const ContentDeleteCommand = z.object({
  ...base,
  kind: z.literal('content.delete'),
  contentId: z.string(),
});

export const ClueRevealCommand = z.object({
  ...base,
  kind: z.literal('clue.reveal'),
  clueId: z.string(),
  /** Empty array = all characters. */
  characterIds: z.array(z.string()),
});

export const DiscoveryRevokeCommand = z.object({
  ...base,
  kind: z.literal('discovery.revoke'),
  discoveryId: z.string(),
});

// --- checks, encounters, narration ------------------------------------------

export const CheckRollCommand = z.object({
  ...base,
  kind: z.literal('check.roll'),
  skill: z.string().min(1),
  dc: z.number().int().min(1).max(40).nullable().default(null),
  /** Explicit character targets; empty = every character with a token on the active map. */
  characterIds: z.array(z.string()),
});

export const EncounterRollCommand = z.object({
  ...base,
  kind: z.literal('encounter.roll'),
  mapId: z.string(),
  /** Hex to resolve terrain from (usually the party's hex). */
  q: z.number().int().nullable().default(null),
  r: z.number().int().nullable().default(null),
  /** Force a specific table; null = choose by terrain. */
  tableId: z.string().nullable().default(null),
  /** Skip the trigger die and roll the table directly. */
  skipCheck: z.boolean().default(false),
});

export const EncounterTableUpsertCommand = z.object({
  ...base,
  kind: z.literal('encounterTable.upsert'),
  table: EncounterTableSchema.extend({ id: z.string().nullable() }),
});

export const EncounterTableDeleteCommand = z.object({
  ...base,
  kind: z.literal('encounterTable.delete'),
  tableId: z.string(),
});

export const NarrateCommand = z.object({
  ...base,
  kind: z.literal('narrate'),
  text: z.string().min(1).max(4000),
  /** Empty = all players. */
  seatIds: z.array(z.string()),
});

// ---------------------------------------------------------------------------

export const ClientCommandSchema = z.discriminatedUnion('kind', [
  CampaignUpdateCommand,
  MapCreateCommand,
  MapUpdateCommand,
  MapDeleteCommand,
  MapSetActiveCommand,
  ImageLayerUpdateCommand,
  ImageLayerDeleteCommand,
  TerrainPaintCommand,
  FogSetCommand,
  TokenCreateCommand,
  TokenUpdateCommand,
  TokenMoveCommand,
  TokenDeleteCommand,
  MarkerPlaceCommand,
  MarkerUpdateCommand,
  MarkerDeleteCommand,
  CharacterCreateCommand,
  CharacterUpdateCommand,
  CharacterDeleteCommand,
  SeatClaimCharacterCommand,
  SeatRenameCommand,
  ContentUpsertCommand,
  ContentDeleteCommand,
  ClueRevealCommand,
  DiscoveryRevokeCommand,
  CheckRollCommand,
  EncounterRollCommand,
  EncounterTableUpsertCommand,
  EncounterTableDeleteCommand,
  NarrateCommand,
]);

export type ClientCommand = z.infer<typeof ClientCommandSchema>;
export type ClientCommandKind = ClientCommand['kind'];
