/** Status of a game session */
export type SessionStatus = "waiting" | "active" | "paused" | "ended";

/** WebSocket connection status */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

/** DM broadcast mode -- immediate pushes changes live, staged queues them */
export type BroadcastMode = "immediate" | "staged";

/** A connected player's presence info */
export type PlayerPresence = {
  userId: string;
  name: string;
  online: boolean;
};

/** A staged change waiting for DM to publish */
export type StagedChange = {
  id: string;
  description: string;
  type: string;
  data: unknown;
};
