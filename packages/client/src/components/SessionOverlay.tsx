import { useSessionStore } from '../stores/useSessionStore';

/**
 * Full-screen overlays for session lifecycle states.
 *
 * - 'waiting' (player only): "Waiting for DM to start the session..."
 * - 'paused' (all roles): "Session Paused" with grey overlay
 * - 'ended' (player only): top banner "Session ended. Map is read-only."
 * - 'active': null (no overlay)
 *
 * Also renders a subtle "DM is preparing..." pill badge for players
 * when the DM is in staged mode and preparing changes.
 */
export function SessionOverlay() {
  const sessionStatus = useSessionStore((s) => s.sessionStatus);
  const userRole = useSessionStore((s) => s.userRole);
  const dmPreparing = useSessionStore((s) => s.dmPreparing);

  // 'waiting' -- players see a full-screen waiting overlay
  if (sessionStatus === 'waiting' && userRole === 'player') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
        <div className="bg-gray-800 text-gray-200 border border-gray-700 rounded-lg p-8 text-center max-w-sm">
          <p className="text-lg font-medium animate-pulse">
            Waiting for DM to start the session...
          </p>
        </div>
      </div>
    );
  }

  // 'paused' -- players see a full-screen pause overlay; DM uses dashboard controls
  if (sessionStatus === 'paused' && userRole === 'player') {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/70 backdrop-blur-sm">
        <div className="bg-gray-800 text-gray-200 border border-gray-700 rounded-lg p-8 text-center max-w-sm">
          <p className="text-xl font-semibold">Session Paused</p>
          <p className="mt-2 text-sm text-gray-400">
            The DM has paused the session. Please wait...
          </p>
        </div>
      </div>
    );
  }

  // 'ended' -- players see a top banner, DM sees nothing
  if (sessionStatus === 'ended' && userRole === 'player') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[90] bg-gray-700/90 py-2 px-4 text-center text-sm text-gray-300">
        Session ended. Map is read-only.
      </div>
    );
  }

  // 'active' -- DM preparing indicator (subtle pill for players)
  if (
    sessionStatus === 'active' &&
    userRole === 'player' &&
    dmPreparing
  ) {
    return (
      <div className="fixed bottom-4 right-4 z-[80] bg-gray-800/80 text-gray-400 text-xs px-3 py-1.5 rounded-full border border-gray-700 animate-pulse">
        DM is preparing...
      </div>
    );
  }

  return null;
}
