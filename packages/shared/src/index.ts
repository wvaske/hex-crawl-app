// Shared types and schemas - barrel export
export type { HexCoord, CubeCoord, HexData } from './hex-types.js';
export { TERRAIN_TYPES, TERRAIN_COLORS, hexKey, parseHexKey } from './hex-types.js';
export type { TerrainType, FogTier, Token } from './hex-types.js';

export { HexDataSchema, MapExportSchema } from './map-schema.js';
export type { MapExport } from './map-schema.js';

// WebSocket message schemas and types
export { ServerMessageSchema, ClientMessageSchema } from './ws-messages.js';
export type { ServerMessage, ClientMessage } from './ws-messages.js';

// Session types
export type {
  SessionStatus,
  ConnectionStatus,
  BroadcastMode,
  PlayerPresence,
  StagedChange,
} from './session-types.js';
