import { useState } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import { useUIStore } from '../stores/useUIStore';
import { useFogActions } from '../hooks/useFogActions';

type TargetMode = 'all' | 'specific';

/**
 * DM fog of war controls panel.
 *
 * Sections:
 * - Selected Hex Actions (reveal/hide selected)
 * - Target Selector (all players or specific)
 * - Bulk Actions (reveal all / hide all with type-to-confirm)
 * - Map Sync (save map to server)
 */
export function FogControls() {
  const userRole = useSessionStore((s) => s.userRole);
  const connectedPlayers = useSessionStore((s) => s.connectedPlayers);
  const selectedHexes = useUIStore((s) => s.selectedHexes);

  const { revealSelected, hideSelected, revealAll, hideAll, uploadMapToServer } =
    useFogActions();

  // Target selection
  const [targetMode, setTargetMode] = useState<TargetMode>('all');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());

  // Bulk action confirmations
  const [revealAllConfirm, setRevealAllConfirm] = useState('');
  const [hideAllConfirm, setHideAllConfirm] = useState('');
  const [showRevealAllInput, setShowRevealAllInput] = useState(false);
  const [showHideAllInput, setShowHideAllInput] = useState(false);

  // Map sync state
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (userRole !== 'dm') return null;

  const hexCount = selectedHexes.size;
  const targets =
    targetMode === 'all' ? ('all' as const) : { playerIds: [...selectedPlayerIds] };

  const handleRevealSelected = () => {
    revealSelected([...selectedHexes], targets);
  };

  const handleHideSelected = () => {
    hideSelected([...selectedHexes], targets);
  };

  const handleRevealAllConfirm = () => {
    if (revealAllConfirm.trim().toLowerCase() === 'reveal all') {
      revealAll();
      setRevealAllConfirm('');
      setShowRevealAllInput(false);
    }
  };

  const handleHideAllConfirm = () => {
    if (hideAllConfirm.trim().toLowerCase() === 'hide all') {
      hideAll();
      setHideAllConfirm('');
      setShowHideAllInput(false);
    }
  };

  const handleUpload = async () => {
    setUploadStatus('uploading');
    setUploadError(null);
    const result = await uploadMapToServer();
    if (result.ok) {
      setUploadStatus('success');
      setTimeout(() => setUploadStatus('idle'), 3000);
    } else {
      setUploadStatus('error');
      setUploadError(result.error ?? 'Unknown error');
    }
  };

  const togglePlayer = (playerId: string) => {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  };

  const players = [...connectedPlayers.values()];

  return (
    <div className="p-4 space-y-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Fog of War Controls
      </h3>

      {/* Selected Hex Actions */}
      <section className="space-y-2">
        <h4 className="text-xs text-gray-500 uppercase tracking-wide">Selected Hexes</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRevealSelected}
            disabled={hexCount === 0}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reveal {hexCount > 0 ? `${hexCount} hex${hexCount !== 1 ? 'es' : ''}` : 'Selected'}
          </button>
          <button
            type="button"
            onClick={handleHideSelected}
            disabled={hexCount === 0}
            className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Hide {hexCount > 0 ? `${hexCount} hex${hexCount !== 1 ? 'es' : ''}` : 'Selected'}
          </button>
        </div>
        {hexCount === 0 && (
          <p className="text-xs text-gray-500 italic">Select hexes on the map first.</p>
        )}
      </section>

      {/* Target Selector */}
      <section className="space-y-2">
        <h4 className="text-xs text-gray-500 uppercase tracking-wide">Target</h4>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="radio"
              name="fog-target"
              checked={targetMode === 'all'}
              onChange={() => setTargetMode('all')}
              className="accent-blue-500"
            />
            All Players
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input
              type="radio"
              name="fog-target"
              checked={targetMode === 'specific'}
              onChange={() => setTargetMode('specific')}
              className="accent-blue-500"
            />
            Specific Players
          </label>
        </div>
        {targetMode === 'specific' && (
          <div className="ml-5 space-y-1">
            {players.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No players connected.</p>
            ) : (
              players.map((p) => (
                <label
                  key={p.userId}
                  className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.has(p.userId)}
                    onChange={() => togglePlayer(p.userId)}
                    className="accent-blue-500"
                  />
                  <span className={p.online ? '' : 'opacity-50'}>
                    {p.name}{!p.online && ' (offline)'}
                  </span>
                </label>
              ))
            )}
          </div>
        )}
      </section>

      {/* Bulk Actions */}
      <section className="space-y-2">
        <h4 className="text-xs text-gray-500 uppercase tracking-wide">Bulk Actions</h4>

        {/* Reveal All */}
        {!showRevealAllInput ? (
          <button
            type="button"
            onClick={() => setShowRevealAllInput(true)}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
          >
            Reveal All Hexes
          </button>
        ) : (
          <div className="p-3 bg-blue-900/30 border border-blue-700 rounded-md space-y-2">
            <p className="text-xs text-blue-300 font-medium">
              Type "REVEAL ALL" to confirm revealing all hexes.
            </p>
            <input
              type="text"
              value={revealAllConfirm}
              onChange={(e) => setRevealAllConfirm(e.target.value)}
              placeholder="REVEAL ALL"
              className="w-full px-2 py-1.5 text-sm bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRevealAllConfirm}
                disabled={revealAllConfirm.trim().toLowerCase() !== 'reveal all'}
                className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => { setShowRevealAllInput(false); setRevealAllConfirm(''); }}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Hide All */}
        {!showHideAllInput ? (
          <button
            type="button"
            onClick={() => setShowHideAllInput(true)}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-md transition-colors"
          >
            Hide All Hexes
          </button>
        ) : (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-md space-y-2">
            <p className="text-xs text-red-300 font-medium">
              Type "HIDE ALL" to confirm hiding all hexes.
            </p>
            <input
              type="text"
              value={hideAllConfirm}
              onChange={(e) => setHideAllConfirm(e.target.value)}
              placeholder="HIDE ALL"
              className="w-full px-2 py-1.5 text-sm bg-gray-700 text-white rounded border border-gray-600 focus:border-red-400 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleHideAllConfirm}
                disabled={hideAllConfirm.trim().toLowerCase() !== 'hide all'}
                className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => { setShowHideAllInput(false); setHideAllConfirm(''); }}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Map Sync */}
      <section className="space-y-2">
        <h4 className="text-xs text-gray-500 uppercase tracking-wide">Map Sync</h4>
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploadStatus === 'uploading'}
          className="w-full px-3 py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploadStatus === 'uploading' ? 'Saving...' : 'Save Map to Server'}
        </button>
        {uploadStatus === 'success' && (
          <p className="text-xs text-green-400">Map saved successfully.</p>
        )}
        {uploadStatus === 'error' && (
          <p className="text-xs text-red-400">{uploadError}</p>
        )}
      </section>
    </div>
  );
}
