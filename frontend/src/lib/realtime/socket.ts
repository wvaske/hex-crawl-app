import { Socket, Channel } from 'phoenix';

export type SubscriptionHandlers = {
  onPlayerMoved?: (payload: { coords: { q: number; r: number }; event?: unknown }) => void;
  onHexReveal?: (payload: { hexes: { q: number; r: number }[]; event?: unknown }) => void;
  onHistoryEvent?: (payload: unknown) => void;
  onItemCreated?: (payload: unknown) => void;
  onItemUpdated?: (payload: unknown) => void;
  onItemDeleted?: (payload: unknown) => void;
};

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const endpoint = import.meta.env.VITE_SOCKET_URL || 'ws://localhost:4000/socket';
    socket = new Socket(endpoint, { params: { token: 'public-player' } });
    socket.connect();
  }
  return socket;
}

export function subscribeToMap(mapId: string, handlers: SubscriptionHandlers): Channel {
  const channel = getSocket().channel(`map:${mapId}`);

  channel.on('player_moved', (payload) => handlers.onPlayerMoved?.(payload));
  channel.on('hexes_revealed', (payload) => handlers.onHexReveal?.(payload));
  channel.on('hex_item_created', (payload) => handlers.onItemCreated?.(payload));
  channel.on('hex_item_updated', (payload) => handlers.onItemUpdated?.(payload));
  channel.on('hex_item_deleted', (payload) => handlers.onItemDeleted?.(payload));

  channel.join().receive('error', (err) => console.error('Failed to join map channel', err));
  return channel;
}

export function subscribeToCampaign(campaignId: string, handlers: SubscriptionHandlers): Channel {
  const channel = getSocket().channel(`campaign:${campaignId}`);
  channel.on('history_event', (payload) => handlers.onHistoryEvent?.(payload));
  channel.join().receive('error', (err) => console.error('Failed to join campaign channel', err));
  return channel;
}
