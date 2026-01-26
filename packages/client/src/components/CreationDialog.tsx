import { useState } from 'react';
import type { FormEvent } from 'react';
import type { HexData } from '@hex-crawl/shared';
import { hexKey } from '@hex-crawl/shared';
import { useMapStore } from '../stores/useMapStore';
import { useUIStore } from '../stores/useUIStore';
import { generateTerrain } from '../hex/generation';

/**
 * Map creation dialog with name and grid size inputs.
 * Generates terrain using the seed-and-grow BFS algorithm
 * and initializes the map store.
 */
export function CreationDialog() {
  const [mapName, setMapName] = useState('New Map');
  const [gridWidth, setGridWidth] = useState(15);
  const [gridHeight, setGridHeight] = useState(15);
  const [error, setError] = useState<string | null>(null);

  const initializeMap = useMapStore((s) => s.initializeMap);
  const setSidePanel = useUIStore((s) => s.setSidePanel);

  function validate(): string | null {
    if (!mapName.trim()) {
      return 'Map name is required';
    }
    if (!Number.isInteger(gridWidth) || gridWidth < 5 || gridWidth > 100) {
      return 'Width must be an integer between 5 and 100';
    }
    if (!Number.isInteger(gridHeight) || gridHeight < 5 || gridHeight > 100) {
      return 'Height must be an integer between 5 and 100';
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);

    // Generate terrain using BFS algorithm
    const terrainData = generateTerrain(gridWidth, gridHeight);

    // Convert to HexData entries
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

    // Initialize map store
    initializeMap(mapName.trim(), gridWidth, gridHeight, hexes);

    // Switch back to info panel
    setSidePanel('info');
  }

  function handleCancel() {
    setSidePanel('info');
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold text-gray-100 mb-4">
        Create New Map
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Map Name */}
        <div>
          <label
            htmlFor="map-name"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            Map Name
          </label>
          <input
            id="map-name"
            type="text"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded-md border border-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            placeholder="Enter map name..."
          />
        </div>

        {/* Grid Width */}
        <div>
          <label
            htmlFor="grid-width"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            Grid Width (5-100)
          </label>
          <input
            id="grid-width"
            type="number"
            min={5}
            max={100}
            value={gridWidth}
            onChange={(e) => setGridWidth(Number(e.target.value))}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded-md border border-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Grid Height */}
        <div>
          <label
            htmlFor="grid-height"
            className="block text-sm font-medium text-gray-300 mb-1"
          >
            Grid Height (5-100)
          </label>
          <input
            id="grid-height"
            type="number"
            min={5}
            max={100}
            value={gridHeight}
            onChange={(e) => setGridHeight(Number(e.target.value))}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded-md border border-gray-600 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Error message */}
        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium transition-colors"
          >
            Generate Map
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>

      {/* Info */}
      <div className="mt-4 p-3 bg-gray-700/50 rounded-md">
        <p className="text-xs text-gray-400">
          Terrain is generated using a seed-and-grow algorithm that creates
          natural-looking clustered regions. Water forms bodies with coast
          borders, mountains cluster together, and terrain types transition
          smoothly.
        </p>
      </div>
    </div>
  );
}
