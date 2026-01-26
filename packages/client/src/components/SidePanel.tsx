import { TERRAIN_COLORS, parseHexKey } from '@hex-crawl/shared';
import type { TerrainType } from '@hex-crawl/shared';
import { useUIStore } from '../stores/useUIStore';
import type { SidePanelTab } from '../stores/useUIStore';
import { useMapStore } from '../stores/useMapStore';
import { TerrainPalette } from './TerrainPalette';
import { CreationDialog } from './CreationDialog';
import { ImportExportDialog } from './ImportExportDialog';

const TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'create', label: 'Create' },
  { id: 'import-export', label: 'Import/Export' },
];

/**
 * Hex info display when one or more hexes are selected.
 */
function HexInfoContent() {
  const selectedHexes = useUIStore((s) => s.selectedHexes);
  const hexes = useMapStore((s) => s.hexes);
  const mapName = useMapStore((s) => s.mapName);

  if (selectedHexes.size === 0) {
    return (
      <div className="p-4">
        {mapName ? (
          <>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
              Map: {mapName}
            </h3>
            <p className="text-sm text-gray-500 italic">
              Click a hex to select it.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No map loaded. Use the Create tab to generate a new map.
          </p>
        )}
      </div>
    );
  }

  if (selectedHexes.size === 1) {
    const key = [...selectedHexes][0]!;
    const hex = hexes.get(key);
    if (!hex) {
      return (
        <div className="p-4">
          <p className="text-sm text-gray-500">Hex data not found.</p>
        </div>
      );
    }
    const coord = parseHexKey(key);
    return (
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Hex Info
        </h3>

        {/* Coordinates */}
        <div>
          <span className="text-xs text-gray-500">Coordinates</span>
          <p className="text-gray-200 font-mono">
            q: {coord.q}, r: {coord.r}
          </p>
        </div>

        {/* Terrain type with color swatch */}
        <div>
          <span className="text-xs text-gray-500">Terrain</span>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="w-5 h-5 rounded-sm border border-gray-500"
              style={{ backgroundColor: TERRAIN_COLORS[hex.terrain] }}
            />
            <span className="text-gray-200 capitalize">{hex.terrain}</span>
          </div>
        </div>

        {/* Terrain variant */}
        <div>
          <span className="text-xs text-gray-500">Variant</span>
          <p className="text-gray-200">{hex.terrainVariant}</p>
        </div>
      </div>
    );
  }

  // Multiple hexes selected
  const terrainCounts = new Map<TerrainType, number>();
  for (const key of selectedHexes) {
    const hex = hexes.get(key);
    if (hex) {
      terrainCounts.set(hex.terrain, (terrainCounts.get(hex.terrain) ?? 0) + 1);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Selection
      </h3>
      <p className="text-gray-200">
        {selectedHexes.size} hexes selected
      </p>

      <div>
        <span className="text-xs text-gray-500">Terrain Breakdown</span>
        <ul className="mt-1 space-y-1">
          {[...terrainCounts.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([terrain, count]) => (
              <li key={terrain} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm border border-gray-500"
                  style={{ backgroundColor: TERRAIN_COLORS[terrain] }}
                />
                <span className="text-gray-300 capitalize text-sm">
                  {terrain}: {count}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Right-side panel showing hex info, terrain palette, creation dialog,
 * and import/export functionality. Always visible with tab navigation.
 */
export function SidePanel() {
  const activeTab = useUIStore((s) => s.sidePanel);
  const setSidePanel = useUIStore((s) => s.setSidePanel);

  return (
    <div className="w-[300px] h-full bg-gray-800 border-l border-gray-700 flex flex-col shrink-0">
      {/* Tab buttons */}
      <div className="flex border-b border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidePanel(tab.id)}
            className={`
              flex-1 px-2 py-2.5 text-xs font-medium transition-colors
              ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-750'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info' && <HexInfoContent />}
        {activeTab === 'terrain' && <TerrainPalette />}
        {activeTab === 'create' && <CreationDialog />}
        {activeTab === 'import-export' && <ImportExportDialog />}
      </div>
    </div>
  );
}
