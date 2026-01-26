import { SidePanel } from './SidePanel';
import { HexMapCanvas } from '../canvas/HexMapCanvas';
import { TerrainLayer } from '../canvas/layers/TerrainLayer';
import { GridLineLayer } from '../canvas/layers/GridLineLayer';
import { HighlightLayer } from '../canvas/layers/HighlightLayer';
import { UIOverlayLayer } from '../canvas/layers/UIOverlayLayer';
import { HexInteraction } from '../canvas/HexInteraction';
import { useMapStore } from '../stores/useMapStore';

/**
 * Main layout component combining the hex map canvas and side panel.
 *
 * Layout: flex h-screen
 * - Left/main area (flex-1): HexMapCanvas with all layers
 * - Right side (w-[300px]): SidePanel with tabs
 *
 * Layer order inside the viewport:
 *   z:0 - TerrainLayer (hex terrain sprites)
 *   z:1 - GridLineLayer (hex border outlines)
 *   z:2 - HighlightLayer (hover/selection highlights)
 *   z:3 - UIOverlayLayer (coordinate text on hover)
 *   HexInteraction (non-visual, handles mouse events)
 */
export function MapView() {
  const hasMap = useMapStore((s) => s.hexes.size > 0);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Canvas area (flex-1 takes remaining space, full height) */}
      <div className="flex-1 relative">
        {hasMap ? (
          <HexMapCanvas>
            <TerrainLayer />
            <GridLineLayer />
            <HighlightLayer />
            <UIOverlayLayer />
            <HexInteraction />
          </HexMapCanvas>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-lg">
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
