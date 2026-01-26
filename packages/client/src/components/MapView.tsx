import { useMapStore } from '../stores/useMapStore';
import { SidePanel } from './SidePanel';

/**
 * Main layout component combining the hex map canvas area and side panel.
 * The canvas area will host HexMapCanvas from Plan 02.
 * For now it renders a placeholder.
 */
export function MapView() {
  const mapName = useMapStore((s) => s.mapName);
  const gridWidth = useMapStore((s) => s.gridWidth);
  const gridHeight = useMapStore((s) => s.gridHeight);
  const hexCount = useMapStore((s) => s.hexes.size);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Canvas area (flex-1 takes remaining space) */}
      <div className="flex-1 flex items-center justify-center relative">
        {hexCount > 0 ? (
          <div className="text-center">
            <p className="text-gray-400 text-lg">Canvas loading...</p>
            <p className="text-gray-500 text-sm mt-2">
              {mapName} ({gridWidth}x{gridHeight}, {hexCount} hexes)
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-gray-500 text-lg">No map loaded</p>
            <p className="text-gray-600 text-sm mt-2">
              Use the Create tab in the side panel to generate a new map.
            </p>
          </div>
        )}
      </div>

      {/* Side panel (fixed width, right side) */}
      <SidePanel />
    </div>
  );
}
