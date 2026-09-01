import { z } from 'zod';
import {
  CampaignSchema,
  CampaignStateSchema,
  CharacterSchema,
  ContentPlayerViewSchema,
  ContentSchema,
  DiscoverySchema,
  EncounterTableSchema,
  FogStateSchema,
  ImageLayerSchema,
  LogEntrySchema,
  MapInfoSchema,
  MarkerSchema,
  SeatPublicSchema,
  TerrainIdSchema,
  TokenSchema,
} from '../domain.js';

/**
 * Server -> client messages. `snapshot` carries the full role-filtered state;
 * `event` messages are incremental diffs, already filtered per recipient.
 */

export const SnapshotMessage = z.object({
  type: z.literal('snapshot'),
  /** The recipient's own seat id and role, so the client knows who it is. */
  seatId: z.string(),
  role: z.enum(['dm', 'player']),
  state: CampaignStateSchema,
});

export const AckMessage = z.object({
  type: z.literal('ack'),
  commandId: z.string(),
});

export const ErrorMessage = z.object({
  type: z.literal('error'),
  commandId: z.string().nullable(),
  message: z.string(),
});

export const PresenceMessage = z.object({
  type: z.literal('presence'),
  seats: z.array(SeatPublicSchema),
});

const ev = <K extends string, T extends z.ZodRawShape>(kind: K, shape: T) =>
  z.object({ type: z.literal('event'), kind: z.literal(kind), ...shape });

export const ServerEventSchema = z.discriminatedUnion('kind', [
  ev('campaign.updated', { campaign: CampaignSchema }),
  ev('map.created', { map: MapInfoSchema }),
  ev('map.updated', { map: MapInfoSchema }),
  ev('map.deleted', { mapId: z.string() }),
  // Active-map switches are followed by a fresh snapshot per client.
  ev('imageLayer.added', { layer: ImageLayerSchema }),
  ev('imageLayer.updated', { layer: ImageLayerSchema }),
  ev('imageLayer.deleted', { layerId: z.string() }),
  ev('terrain.painted', {
    mapId: z.string(),
    cells: z.array(
      z.object({ q: z.number().int(), r: z.number().int(), terrain: TerrainIdSchema.nullable() }),
    ),
  }),
  ev('fog.changed', {
    mapId: z.string(),
    cells: z.array(
      z.object({
        q: z.number().int(),
        r: z.number().int(),
        state: FogStateSchema,
        /** For players: terrain revealed alongside the fog lifting. */
        terrain: TerrainIdSchema.nullable().optional(),
      }),
    ),
  }),
  ev('token.added', { token: TokenSchema }),
  ev('token.updated', { token: TokenSchema }),
  ev('token.moved', { tokenId: z.string(), q: z.number().int(), r: z.number().int() }),
  ev('token.removed', { tokenId: z.string() }),
  ev('move.requested', {
    tokenId: z.string(),
    label: z.string(),
    q: z.number().int(),
    r: z.number().int(),
  }),
  ev('move.resolved', { tokenId: z.string(), label: z.string(), approved: z.boolean() }),
  ev('marker.added', { marker: MarkerSchema }),
  ev('marker.updated', { marker: MarkerSchema }),
  ev('marker.removed', { markerId: z.string() }),
  ev('character.upserted', { character: CharacterSchema }),
  ev('character.deleted', { characterId: z.string() }),
  ev('seat.updated', { seat: SeatPublicSchema }),
  /** DM receives full content; players receive their view (or removal). */
  ev('content.upserted', { content: z.union([ContentSchema, ContentPlayerViewSchema]) }),
  ev('content.deleted', { contentId: z.string() }),
  ev('discovery.new', {
    discovery: DiscoverySchema,
    contentId: z.string(),
    contentTitle: z.string(),
    clueText: z.string(),
    characterName: z.string(),
  }),
  ev('discovery.revoked', { discoveryId: z.string() }),
  ev('trail.found', {
    trailId: z.string(),
    characterId: z.string(),
    characterName: z.string(),
    q: z.number().int(),
    r: z.number().int(),
    forward: z.string().nullable(),
    backward: z.string().nullable(),
  }),
  /**
   * DM-only nudge (issue #107): a player's hex search turned up clues that
   * are waiting on the DM's share/withhold call in Inspect.
   */
  ev('search.pending', {
    characterName: z.string(),
    skill: z.string(),
    total: z.number().int(),
    q: z.number().int(),
    r: z.number().int(),
    count: z.number().int(),
  }),
  ev('encounterTable.upserted', { table: EncounterTableSchema }),
  ev('encounterTable.deleted', { tableId: z.string() }),
  ev('log.appended', { entry: LogEntrySchema }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ServerEventKind = ServerEvent['kind'];

export const ServerMessageSchema = z.union([
  SnapshotMessage,
  AckMessage,
  ErrorMessage,
  PresenceMessage,
  ServerEventSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type Snapshot = z.infer<typeof SnapshotMessage>;
