import { TERRAIN_TYPES, TERRAIN_COLORS } from '@hex-crawl/shared';
import type { TerrainType } from '@hex-crawl/shared';
import { useUIStore } from '../stores/useUIStore';
import { useMapStore } from '../stores/useMapStore';

/**
 * Grid of terrain type buttons for manual terrain assignment.
 * Shows all 10 terrain types with color swatches.
 * Clicking assigns the terrain to all currently selected hexes.
 */
export function TerrainPalette() {
  const selectedHexes = useUIStore((s) => s.selectedHexes);
  const hexes = useMapStore((s) => s.hexes);
  const setTerrainBatch = useMapStore((s) => s.setTerrainBatch);

  // Determine the active terrain (if all selected hexes share the same terrain)
  let activeTerrain: TerrainType | null = null;
  if (selectedHexes.size > 0) {
    const selectedKeys = [...selectedHexes];
    const terrains = new Set<TerrainType>();
    for (const key of selectedKeys) {
      const hex = hexes.get(key);
      if (hex) {
        terrains.add(hex.terrain);
      }
    }
    if (terrains.size === 1) {
      activeTerrain = [...terrains][0] ?? null;
    }
  }

  function handleTerrainClick(terrain: TerrainType) {
    if (selectedHexes.size === 0) return;
    const keys = [...selectedHexes];
    setTerrainBatch(keys, terrain);
  }

  return (
    <div className="p-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
        Terrain Types
      </h3>

      {selectedHexes.size === 0 ? (
        <p className="text-sm text-gray-500 italic">
          Select hexes on the map first, then click a terrain type to assign it.
        </p>
      ) : (
        <p className="text-sm text-gray-400 mb-3">
          {selectedHexes.size} hex{selectedHexes.size > 1 ? 'es' : ''} selected
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {TERRAIN_TYPES.map((terrain) => {
          const isActive = activeTerrain === terrain;
          return (
            <button
              key={terrain}
              onClick={() => handleTerrainClick(terrain)}
              disabled={selectedHexes.size === 0}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left
                transition-colors duration-150
                ${
                  isActive
                    ? 'bg-gray-600 ring-2 ring-blue-400'
                    : 'bg-gray-700 hover:bg-gray-600'
                }
                ${selectedHexes.size === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span
                className="w-4 h-4 rounded-sm shrink-0 border border-gray-500"
                style={{ backgroundColor: TERRAIN_COLORS[terrain] }}
              />
              <span className="capitalize text-gray-200">{terrain}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
