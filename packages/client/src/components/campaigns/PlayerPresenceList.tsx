import { useSessionStore } from '../../stores/useSessionStore';

/**
 * Online/offline player presence list for the campaign dashboard sidebar.
 *
 * Reads connectedPlayers from the session store (populated via WebSocket
 * player:presence and player:joined/left messages). Shows a green dot for
 * online players and a gray dot for offline players.
 */
export function PlayerPresenceList() {
  const connectedPlayers = useSessionStore((s) => s.connectedPlayers);

  const players = Array.from(connectedPlayers.values());

  // Sort: online first, then alphabetical by name
  const sortedPlayers = players.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (players.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Players
        </h3>
        <p className="text-xs text-gray-500 italic">No players connected</p>
      </div>
    );
  }

  const onlineCount = players.filter((p) => p.online).length;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Players ({onlineCount}/{players.length} online)
      </h3>
      <div className="space-y-2">
        {sortedPlayers.map((player) => (
          <div
            key={player.userId}
            className="flex items-center gap-2 px-2 py-1.5"
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                player.online ? 'bg-green-400' : 'bg-gray-500'
              }`}
            />
            <span
              className={`text-sm truncate ${
                player.online ? 'text-gray-200' : 'text-gray-500'
              }`}
            >
              {player.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
