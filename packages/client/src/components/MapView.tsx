import { useEffect } from 'react';
import { useMapStore } from '../stores/useMapStore';
import { SidePanel } from './SidePanel';
import { HexMapCanvas } from '../canvas/HexMapCanvas';
import { TerrainLayer } from '../canvas/layers/TerrainLayer';
import { GridLineLayer } from '../canvas/layers/GridLineLayer';
import { generateTerrain } from '../hex/generation';
import type { HexData } from '@hex-crawl/shared';
import { hexKey } from '@hex-crawl/shared';

/**
 * Hook to auto-create a default 15x15 map on first load if no map exists.
 * This is temporary scaffolding; the creation dialog provides proper map creation.
 */
function useInitializeDefaultMap() {
  const hexCount = useMapStore((s) => s.hexes.size);
  const initializeMap = useMapStore((s) => s.initializeMap);

  useEffect(() => {
    if (hexCount > 0) return;

    const width = 15;
    const height = 15;

    // Use the BFS terrain generation algorithm
    const terrainData = generateTerrain(width, height);

    // Convert to HexData map
    const hexes = new Map<string, HexData>();
    for (const [key, data] of terrainData) {
      const parts = key.split(',');
      const q = Number(parts[0]);
      const r = Number(parts[1]);
      hexes.set(hexKey(q, r), {
        q,
        r,
        terrain: data.terrain,
        terrainVariant: data.terrainVariant,
      });
    }

    initializeMap('Default Map', width, height, hexes);
  }, [hexCount, initializeMap]);
}

/**
 * Main layout component combining the hex map canvas and side panel.
 * The canvas area hosts HexMapCanvas with TerrainLayer and GridLineLayer.
 * Side panel provides hex info, terrain palette, and map creation.
 */
export function MapView() {
  useInitializeDefaultMap();

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100">
      {/* Canvas area (flex-1 takes remaining space, full height) */}
      <div className="flex-1 relative">
        <HexMapCanvas>
          <TerrainLayer />
          <GridLineLayer />
        </HexMapCanvas>
      </div>

      {/* Side panel (fixed width, right side) */}
      <SidePanel />
    </div>
  );
}
