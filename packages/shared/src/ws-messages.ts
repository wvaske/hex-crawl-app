import { z } from "zod";

// ---------------------------------------------------------------------------
// Server -> Client messages
// ---------------------------------------------------------------------------

const SessionStateMessage = z.object({
  type: z.literal("session:state"),
  status: z.enum(["waiting", "active", "paused", "ended"]),
  broadcastMode: z.enum(["immediate", "staged"]),
  connectedPlayers: z.array(
    z.object({ userId: z.string(), name: z.string(), online: z.boolean() })
  ),
  revealedHexes: z.array(z.string()),
});

const SessionStatusChangedMessage = z.object({
  type: z.literal("session:statusChanged"),
  status: z.enum(["waiting", "active", "paused", "ended"]),
});

const HexRevealedMessage = z.object({
  type: z.literal("hex:revealed"),
  hexKeys: z.array(z.string()),
  terrain: z.array(z.object({ key: z.string(), terrain: z.string() })),
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

export const ServerMessageSchema = z.discriminatedUnion("type", [
  SessionStateMessage,
  SessionStatusChangedMessage,
  HexRevealedMessage,
  HexUpdatedMessage,
  PlayerJoinedMessage,
  PlayerLeftMessage,
  PlayerPresenceMessage,
  DmPreparingMessage,
  StagedChangesMessage,
  ErrorMessage,
  ConnectedMessage,
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

const StagedUndoMessage = z.object({
  type: z.literal("staged:undo"),
  index: z.number(),
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
  StagedUndoMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
