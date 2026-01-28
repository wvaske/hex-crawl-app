import { useSessionStore } from '../stores/useSessionStore';

/**
 * Persistent top banner showing WebSocket connection status.
 *
 * - 'connecting': yellow banner "Connecting..."
 * - 'reconnecting': red banner "Connection lost. Reconnecting..."
 * - 'connected' / 'disconnected': hidden (returns null)
 *
 * Fixed position overlay -- does not push content down.
 */
export function ConnectionBanner() {
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  if (connectionStatus === 'connected' || connectionStatus === 'disconnected') {
    return null;
  }

  const isReconnecting = connectionStatus === 'reconnecting';

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] py-2 px-4 text-center text-sm text-white ${
        isReconnecting ? 'bg-red-600/90' : 'bg-yellow-600/90'
      }`}
    >
      <span className="inline-flex items-center gap-2 animate-pulse">
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        {isReconnecting
          ? 'Connection lost. Reconnecting...'
          : 'Connecting...'}
      </span>
    </div>
  );
}
