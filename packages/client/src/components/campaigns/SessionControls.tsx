import { useState } from 'react';
import { useSessionStore } from '../../stores/useSessionStore';

/**
 * DM session lifecycle controls: start, pause, resume, end, and broadcast mode toggle.
 *
 * Only rendered when the current user is a DM. Reads session status and broadcast
 * mode from the session store, and sends client-to-server messages via sendMessage.
 */
export function SessionControls() {
  const sessionStatus = useSessionStore((s) => s.sessionStatus);
  const broadcastMode = useSessionStore((s) => s.broadcastMode);
  const userRole = useSessionStore((s) => s.userRole);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const stagedChanges = useSessionStore((s) => s.stagedChanges);

  const [confirmEnd, setConfirmEnd] = useState(false);

  // Only DMs see session controls
  if (userRole !== 'dm') return null;

  const send = sendMessage;

  const handleStart = () => {
    send?.({ type: 'session:start' });
  };

  const handlePause = () => {
    send?.({ type: 'session:pause' });
  };

  const handleResume = () => {
    send?.({ type: 'session:resume' });
  };

  const handleEnd = () => {
    if (!confirmEnd) {
      setConfirmEnd(true);
      return;
    }
    send?.({ type: 'session:end' });
    setConfirmEnd(false);
  };

  const handleCancelEnd = () => {
    setConfirmEnd(false);
  };

  const handleBroadcastMode = (mode: 'immediate' | 'staged') => {
    send?.({ type: 'broadcast:mode', mode });
  };

  const handleUndoStaged = (index: number) => {
    send?.({ type: 'staged:undo', index });
  };

  const handlePublishAll = () => {
    send?.({ type: 'broadcast:publish' });
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Session Controls
      </h3>

      {/* Session lifecycle buttons */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(sessionStatus === 'waiting' || sessionStatus === 'ended') && (
          <button
            type="button"
            onClick={handleStart}
            className="bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
          >
            {sessionStatus === 'ended' ? 'Start New Session' : 'Start Session'}
          </button>
        )}

        {sessionStatus === 'active' && (
          <>
            <button
              type="button"
              onClick={handlePause}
              className="bg-yellow-600 hover:bg-yellow-700 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
            >
              Pause Session
            </button>
            {!confirmEnd ? (
              <button
                type="button"
                onClick={handleEnd}
                className="bg-red-600 hover:bg-red-700 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
              >
                End Session
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEnd}
                  className="bg-red-700 hover:bg-red-800 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
                >
                  Confirm End
                </button>
                <button
                  type="button"
                  onClick={handleCancelEnd}
                  className="bg-gray-600 hover:bg-gray-500 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {sessionStatus === 'paused' && (
          <>
            <button
              type="button"
              onClick={handleResume}
              className="bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
            >
              Resume Session
            </button>
            {!confirmEnd ? (
              <button
                type="button"
                onClick={handleEnd}
                className="bg-red-600 hover:bg-red-700 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
              >
                End Session
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEnd}
                  className="bg-red-700 hover:bg-red-800 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
                >
                  Confirm End
                </button>
                <button
                  type="button"
                  onClick={handleCancelEnd}
                  className="bg-gray-600 hover:bg-gray-500 text-white font-medium text-sm rounded px-4 py-2 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Broadcast mode toggle (only when session is active) */}
      {sessionStatus === 'active' && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 mb-2">Broadcast Mode</p>
          <div className="flex rounded overflow-hidden border border-gray-600">
            <button
              type="button"
              onClick={() => handleBroadcastMode('immediate')}
              className={`flex-1 text-sm py-1.5 px-3 transition-colors ${
                broadcastMode === 'immediate'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Immediate
            </button>
            <button
              type="button"
              onClick={() => handleBroadcastMode('staged')}
              className={`flex-1 text-sm py-1.5 px-3 transition-colors ${
                broadcastMode === 'staged'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              Staged
            </button>
          </div>
        </div>
      )}

      {/* Staged changes panel (only when broadcastMode is 'staged') */}
      {broadcastMode === 'staged' && sessionStatus === 'active' && (
        <div>
          <p className="text-xs text-gray-400 mb-2">
            Pending Changes ({stagedChanges.length})
          </p>
          {stagedChanges.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No staged changes</p>
          ) : (
            <>
              <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                {stagedChanges.map((change, index) => (
                  <div
                    key={change.id}
                    className="flex items-center justify-between bg-gray-700/50 border border-gray-600 rounded px-3 py-1.5"
                  >
                    <span className="text-xs text-gray-300 truncate flex-1">
                      {change.description}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUndoStaged(index)}
                      className="text-xs text-red-400 hover:text-red-300 ml-2 shrink-0"
                    >
                      Undo
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handlePublishAll}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2 transition-colors"
              >
                Publish All
              </button>
            </>
          )}
        </div>
      )}

      {/* Session status indicator */}
      <div className="mt-3 pt-3 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              sessionStatus === 'active'
                ? 'bg-green-400'
                : sessionStatus === 'paused'
                  ? 'bg-yellow-400'
                  : sessionStatus === 'waiting'
                    ? 'bg-gray-400'
                    : 'bg-red-400'
            }`}
          />
          <span className="text-xs text-gray-400 capitalize">
            {sessionStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
