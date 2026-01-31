import { useCallback, useEffect, useState } from 'react';
import { useImageLayerStore } from '../stores/useImageLayerStore';
import { useSessionStore } from '../stores/useSessionStore';

const API_URL = import.meta.env.VITE_API_URL || '';

interface GridSettings {
  gridOffsetX: number;
  gridOffsetY: number;
  hexSizeX: number;
  hexSizeY: number;
  gridLineColor: string;
  gridLineThickness: number;
  gridLineOpacity: number;
  terrainOverlayEnabled: boolean;
  terrainOverlayOpacity: number;
}

const DEFAULTS: GridSettings = {
  gridOffsetX: 0,
  gridOffsetY: 0,
  hexSizeX: 40,
  hexSizeY: 40,
  gridLineColor: '#ffffff',
  gridLineThickness: 1,
  gridLineOpacity: 0.4,
  terrainOverlayEnabled: false,
  terrainOverlayOpacity: 0.3,
};

/**
 * Floating overlay panel for grid alignment controls.
 * Appears when alignmentMode is true in useImageLayerStore.
 * Provides numeric inputs for grid offset, hex size, line style, and terrain overlay.
 */
export function AlignmentControls() {
  const alignmentMode = useImageLayerStore((s) => s.alignmentMode);
  const exitAlignmentMode = useImageLayerStore((s) => s.exitAlignmentMode);
  const campaignId = useSessionStore((s) => s.campaignId);

  const [settings, setSettings] = useState<GridSettings>(DEFAULTS);
  const [mapId, setMapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch current map settings when entering alignment mode
  useEffect(() => {
    if (!alignmentMode || !campaignId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/maps`, {
          credentials: 'include',
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { maps: Array<GridSettings & { id: string }> };
        if (data.maps.length > 0 && !cancelled) {
          const map = data.maps[0]!;
          setMapId(map.id);
          setSettings({
            gridOffsetX: map.gridOffsetX ?? DEFAULTS.gridOffsetX,
            gridOffsetY: map.gridOffsetY ?? DEFAULTS.gridOffsetY,
            hexSizeX: map.hexSizeX ?? DEFAULTS.hexSizeX,
            hexSizeY: map.hexSizeY ?? DEFAULTS.hexSizeY,
            gridLineColor: map.gridLineColor ?? DEFAULTS.gridLineColor,
            gridLineThickness: map.gridLineThickness ?? DEFAULTS.gridLineThickness,
            gridLineOpacity: map.gridLineOpacity ?? DEFAULTS.gridLineOpacity,
            terrainOverlayEnabled: map.terrainOverlayEnabled ?? DEFAULTS.terrainOverlayEnabled,
            terrainOverlayOpacity: map.terrainOverlayOpacity ?? DEFAULTS.terrainOverlayOpacity,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [alignmentMode, campaignId]);

  const updateField = useCallback(<K extends keyof GridSettings>(key: K, value: GridSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleDone = useCallback(async () => {
    if (campaignId && mapId) {
      await fetch(`${API_URL}/api/campaigns/${campaignId}/maps/${mapId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    }
    exitAlignmentMode();
  }, [campaignId, mapId, settings, exitAlignmentMode]);

  if (!alignmentMode) return null;

  return (
    <div className="absolute top-4 left-4 z-50 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
          Grid Alignment
        </h3>
        <button
          onClick={handleDone}
          className="px-3 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-500 text-white"
        >
          Done
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : (
        <>
          {/* Grid Offset */}
          <fieldset className="space-y-2">
            <legend className="text-xs text-gray-400 font-medium">Grid Offset</legend>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-[10px] text-gray-500 block">X</span>
                <input
                  type="number"
                  step={1}
                  value={settings.gridOffsetX}
                  onChange={(e) => updateField('gridOffsetX', Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </label>
              <label className="flex-1">
                <span className="text-[10px] text-gray-500 block">Y</span>
                <input
                  type="number"
                  step={1}
                  value={settings.gridOffsetY}
                  onChange={(e) => updateField('gridOffsetY', Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </label>
            </div>
          </fieldset>

          {/* Hex Size */}
          <fieldset className="space-y-2">
            <legend className="text-xs text-gray-400 font-medium">Hex Size</legend>
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-[10px] text-gray-500 block">Width</span>
                <input
                  type="number"
                  step={1}
                  min={10}
                  value={settings.hexSizeX}
                  onChange={(e) => updateField('hexSizeX', Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </label>
              <label className="flex-1">
                <span className="text-[10px] text-gray-500 block">Height</span>
                <input
                  type="number"
                  step={1}
                  min={10}
                  value={settings.hexSizeY}
                  onChange={(e) => updateField('hexSizeY', Number(e.target.value))}
                  className="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </label>
            </div>
          </fieldset>

          {/* Grid Line Style */}
          <fieldset className="space-y-2">
            <legend className="text-xs text-gray-400 font-medium">Grid Lines</legend>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="text-[10px] text-gray-500">Color</span>
                <input
                  type="color"
                  value={settings.gridLineColor}
                  onChange={(e) => updateField('gridLineColor', e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] text-gray-500 block">
                Thickness ({settings.gridLineThickness.toFixed(1)})
              </span>
              <input
                type="range"
                min={0.5}
                max={5}
                step={0.5}
                value={settings.gridLineThickness}
                onChange={(e) => updateField('gridLineThickness', Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500 block">
                Opacity ({settings.gridLineOpacity.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.gridLineOpacity}
                onChange={(e) => updateField('gridLineOpacity', Number(e.target.value))}
                className="w-full"
              />
            </label>
          </fieldset>

          {/* Terrain Overlay */}
          <fieldset className="space-y-2">
            <legend className="text-xs text-gray-400 font-medium">Terrain Overlay</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.terrainOverlayEnabled}
                onChange={(e) => updateField('terrainOverlayEnabled', e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              <span className="text-xs text-gray-300">Show terrain overlay</span>
            </label>
            {settings.terrainOverlayEnabled && (
              <label className="block">
                <span className="text-[10px] text-gray-500 block">
                  Opacity ({settings.terrainOverlayOpacity.toFixed(2)})
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.terrainOverlayOpacity}
                  onChange={(e) => updateField('terrainOverlayOpacity', Number(e.target.value))}
                  className="w-full"
                />
              </label>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}
