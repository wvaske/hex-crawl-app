import { z } from "zod";

// ---------------------------------------------------------------------------
// Server -> Client messages
// ---------------------------------------------------------------------------

const AdjacentHexSchema = z.object({ key: z.string(), terrain: z.string() });

const SessionStateMessage = z.object({
  type: z.literal("session:state"),
  status: z.enum(["waiting", "active", "paused", "ended"]),
  broadcastMode: z.enum(["immediate", "staged"]),
  connectedPlayers: z.array(
    z.object({ userId: z.string(), name: z.string(), online: z.boolean() })
  ),
  revealedHexes: z.array(z.string()),
  adjacentHexes: z.array(AdjacentHexSchema).optional(),
});

const SessionStatusChangedMessage = z.object({
  type: z.literal("session:statusChanged"),
  status: z.enum(["waiting", "active", "paused", "ended"]),
});

const HexRevealedMessage = z.object({
  type: z.literal("hex:revealed"),
  hexKeys: z.array(z.string()),
  terrain: z.array(z.object({ key: z.string(), terrain: z.string() })),
  adjacentHexes: z.array(AdjacentHexSchema).optional(),
});

const HexHiddenMessage = z.object({
  type: z.literal("hex:hidden"),
  hexKeys: z.array(z.string()),
  adjacentHexes: z.array(AdjacentHexSchema).optional(),
});

const HexUpdatedMessage = z.object({
  type: z.literal("hex:updated"),
  changes: z.array(z.object({ key: z.string(), terrain: z.string() })),
});

const PlayerJoinedMessage = z.object({
  type: z.literal("player:joined"),
  userId: z.string(),
  name: z.string(),
});

const PlayerLeftMessage = z.object({
  type: z.literal("player:left"),
  userId: z.string(),
});

const PlayerPresenceMessage = z.object({
  type: z.literal("player:presence"),
  players: z.array(
    z.object({ userId: z.string(), name: z.string(), online: z.boolean() })
  ),
});

const DmPreparingMessage = z.object({
  type: z.literal("dm:preparing"),
  preparing: z.boolean(),
});

const StagedChangesMessage = z.object({
  type: z.literal("staged:changes"),
  changes: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      type: z.string(),
      data: z.unknown(),
    })
  ),
});

const ErrorMessage = z.object({
  type: z.literal("error"),
  message: z.string(),
});

const ConnectedMessage = z.object({
  type: z.literal("connected"),
  userId: z.string(),
  role: z.enum(["dm", "player"]),
});

// ---------------------------------------------------------------------------
// Token schemas (shared between client and server messages)
// ---------------------------------------------------------------------------

const TokenSchema = z.object({
  id: z.string(),
  hexKey: z.string(),
  ownerId: z.string().nullable(),
  label: z.string(),
  icon: z.string(),
  color: z.string(),
  tokenType: z.enum(["pc", "npc"]),
  visible: z.boolean(),
});

const TokenMovedMessage = z.object({
  type: z.literal("token:moved"),
  tokenId: z.string(),
  fromHexKey: z.string(),
  toHexKey: z.string(),
  movedBy: z.string(),
});

const TokenCreatedMessage = z.object({
  type: z.literal("token:created"),
  token: TokenSchema,
});

const TokenUpdatedMessage = z.object({
  type: z.literal("token:updated"),
  tokenId: z.string(),
  updates: z.object({
    icon: z.string().optional(),
    color: z.string().optional(),
    visible: z.boolean().optional(),
    label: z.string().optional(),
  }),
});

const TokenDeletedMessage = z.object({
  type: z.literal("token:deleted"),
  tokenId: z.string(),
});

const TokenStateMessage = z.object({
  type: z.literal("token:state"),
  tokens: z.array(TokenSchema),
});

// ---------------------------------------------------------------------------
// Map image layer schemas
// ---------------------------------------------------------------------------

const LayerSchema = z.object({
  id: z.string(),
  mapId: z.string(),
  fileName: z.string(),
  storageKey: z.string(),
  contentType: z.string(),
  fileSize: z.number(),
  offsetX: z.number(),
  offsetY: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  sortOrder: z.number(),
  visible: z.boolean(),
  playerVisible: z.boolean(),
  url: z.string(),
});

const LayerAddedMessage = z.object({
  type: z.literal("layer:added"),
  layer: LayerSchema,
});

const LayerUpdatedMessage = z.object({
  type: z.literal("layer:updated"),
  layerId: z.string(),
  updates: z.record(z.string(), z.unknown()),
});

const LayerRemovedMessage = z.object({
  type: z.literal("layer:removed"),
  layerId: z.string(),
});

const MapUpdatedMessage = z.object({
  type: z.literal("map:updated"),
  mapId: z.string(),
  updates: z.record(z.string(), z.unknown()),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  SessionStateMessage,
  SessionStatusChangedMessage,
  HexRevealedMessage,
  HexHiddenMessage,
  HexUpdatedMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerPresenceMessage,
  DmPreparingMessage,
  StagedChangesMessage,
  ErrorMessage,
  ConnectedMessage,
  TokenMovedMessage,
  TokenCreatedMessage,
  TokenUpdatedMessage,
  TokenDeletedMessage,
  TokenStateMessage,
  LayerAddedMessage,
  LayerUpdatedMessage,
  LayerRemovedMessage,
  MapUpdatedMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ---------------------------------------------------------------------------
// Client -> Server messages
// ---------------------------------------------------------------------------

const SessionStartMessage = z.object({
  type: z.literal("session:start"),
});

const SessionPauseMessage = z.object({
  type: z.literal("session:pause"),
});

const SessionResumeMessage = z.object({
  type: z.literal("session:resume"),
});

const SessionEndMessage = z.object({
  type: z.literal("session:end"),
});

const BroadcastModeMessage = z.object({
  type: z.literal("broadcast:mode"),
  mode: z.enum(["immediate", "staged"]),
});

const BroadcastPublishMessage = z.object({
  type: z.literal("broadcast:publish"),
});

const HexRevealMessage = z.object({
  type: z.literal("hex:reveal"),
  hexKeys: z.array(z.string()),
  targets: z.union([
    z.literal("all"),
    z.object({ playerIds: z.array(z.string()) }),
  ]),
});

const HexUpdateMessage = z.object({
  type: z.literal("hex:update"),
  changes: z.array(z.object({ key: z.string(), terrain: z.string() })),
});

const HexHideMessage = z.object({
  type: z.literal("hex:hide"),
  hexKeys: z.array(z.string()),
  targets: z.union([
    z.literal("all"),
    z.object({ playerIds: z.array(z.string()) }),
  ]),
});

const StagedUndoMessage = z.object({
  type: z.literal("staged:undo"),
  index: z.number(),
});

const TokenMoveMessage = z.object({
  type: z.literal("token:move"),
  tokenId: z.string(),
  toHexKey: z.string(),
});

const TokenCreateMessage = z.object({
  type: z.literal("token:create"),
  hexKey: z.string(),
  label: z.string(),
  icon: z.string(),
  color: z.string(),
  tokenType: z.enum(["pc", "npc"]),
  ownerId: z.string().optional(),
});

const TokenUpdateMessage = z.object({
  type: z.literal("token:update"),
  tokenId: z.string(),
  updates: z.object({
    icon: z.string().optional(),
    color: z.string().optional(),
    visible: z.boolean().optional(),
    label: z.string().optional(),
  }),
});

const TokenDeleteMessage = z.object({
  type: z.literal("token:delete"),
  tokenId: z.string(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  SessionStartMessage,
  SessionPauseMessage,
  SessionResumeMessage,
  SessionEndMessage,
  BroadcastModeMessage,
  BroadcastPublishMessage,
  HexRevealMessage,
  HexUpdateMessage,
  HexHideMessage,
  StagedUndoMessage,
  TokenMoveMessage,
  TokenCreateMessage,
  TokenUpdateMessage,
  TokenDeleteMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
