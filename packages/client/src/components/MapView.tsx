import { SidePanel } from './SidePanel';
import { HexMapCanvas } from '../canvas/HexMapCanvas';
import { ImageLayer } from '../canvas/layers/ImageLayer';
import { TerrainLayer } from '../canvas/layers/TerrainLayer';
import { GridLineLayer } from '../canvas/layers/GridLineLayer';
import { FogLayer } from '../canvas/layers/FogLayer';
import { TokenLayer } from '../canvas/layers/TokenLayer';
import { HighlightLayer } from '../canvas/layers/HighlightLayer';
import { UIOverlayLayer } from '../canvas/layers/UIOverlayLayer';
import { HexInteraction } from '../canvas/HexInteraction';
import { GridContainer } from '../canvas/GridContainer';
import { AlignmentControls } from './AlignmentControls';
import { useMapStore } from '../stores/useMapStore';

/**
 * Main layout component combining the hex map canvas and side panel.
 *
 * Layout: flex h-screen
 * - Left/main area (flex-1): HexMapCanvas with all layers
 * - Right side (w-[300px]): SidePanel with tabs
 *
 * Layer order inside the viewport:
 *   z:0 - ImageLayer (uploaded map background images)
 *   z:1 - TerrainLayer (hex terrain sprites)
 *   z:2 - GridLineLayer (hex border outlines)
 *   z:3 - FogLayer (two-tier fog of war overlays)
 *   z:4 - TokenLayer (token sprites with colored rings)
 *   z:5 - HighlightLayer (hover/selection highlights)
 *   z:6 - UIOverlayLayer (coordinate text on hover)
 *   HexInteraction (non-visual, handles mouse events)
 */
export function MapView() {
  const hasMap = useMapStore((s) => s.hexes.size > 0 || s.mapName !== '');

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Canvas area (flex-1 takes remaining space, full height) */}
      <div className="flex-1 relative">
        <AlignmentControls />
        {hasMap ? (
          <HexMapCanvas>
            <ImageLayer />
            <GridContainer>
              <TerrainLayer />
              <GridLineLayer />
              <FogLayer />
              <TokenLayer />
              <HighlightLayer />
              <UIOverlayLayer />
            </GridContainer>
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
