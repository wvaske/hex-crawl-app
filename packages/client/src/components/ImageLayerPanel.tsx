import { useCallback, useEffect, useRef, useState } from 'react';
import { useImageLayerStore } from '../stores/useImageLayerStore';
import type { ImageLayerData } from '../stores/useImageLayerStore';
import { useSessionStore } from '../stores/useSessionStore';

const API_URL = import.meta.env.VITE_API_URL || '';

/**
 * Resolve the active mapId for a campaign.
 * Lists existing maps; if none exist, creates one named "Default".
 */
async function resolveMapId(campaignId: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/campaigns/${campaignId}/maps`, {
    credentials: 'include',
  });
  if (res.ok) {
    const data = (await res.json()) as { maps: Array<{ id: string }> };
    if (data.maps.length > 0) return data.maps[0]!.id;
  }
  // Create a default map
  const createRes = await fetch(`${API_URL}/api/campaigns/${campaignId}/maps`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Default' }),
  });
  if (!createRes.ok) throw new Error('Failed to create map');
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * DM-only panel for managing image layers: upload, list, reorder,
 * toggle visibility, enter alignment mode, and delete.
 */
export function ImageLayerPanel() {
  const campaignId = useSessionStore((s) => s.campaignId);
  const layers = useImageLayerStore((s) => s.layers);
  const setLayers = useImageLayerStore((s) => s.setLayers);
  const addLayer = useImageLayerStore((s) => s.addLayer);
  const updateLayer = useImageLayerStore((s) => s.updateLayer);
  const removeLayer = useImageLayerStore((s) => s.removeLayer);
  const reorderLayers = useImageLayerStore((s) => s.reorderLayers);
  const enterAlignmentMode = useImageLayerStore((s) => s.enterAlignmentMode);

  const [mapId, setMapId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragItemRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  // Resolve mapId and fetch layers on mount
  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;

    (async () => {
      try {
        const id = await resolveMapId(campaignId);
        if (cancelled) return;
        setMapId(id);

        const res = await fetch(
          `${API_URL}/api/campaigns/${campaignId}/maps/${id}/images`,
          { credentials: 'include' },
        );
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { layers: ImageLayerData[] };
          setLayers(data.layers);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [campaignId, setLayers]);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !campaignId || !mapId) return;
    e.target.value = '';

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(
        `${API_URL}/api/campaigns/${campaignId}/maps/${mapId}/images`,
        {
          method: 'POST',
          credentials: 'include',
          body: formData,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Upload failed: ${res.status}`);
      }
      const layer = (await res.json()) as ImageLayerData;
      addLayer(layer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [campaignId, mapId, addLayer]);

  const handleToggleVisible = useCallback(async (layer: ImageLayerData) => {
    if (!campaignId || !mapId) return;
    const newVal = !layer.visible;
    updateLayer(layer.id, { visible: newVal });
    await fetch(
      `${API_URL}/api/campaigns/${campaignId}/maps/${mapId}/images/${layer.id}`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: newVal }),
      },
    );
  }, [campaignId, mapId, updateLayer]);

  const handleTogglePlayerVisible = useCallback(async (layer: ImageLayerData) => {
    if (!campaignId || !mapId) return;
    const newVal = !layer.playerVisible;
    updateLayer(layer.id, { playerVisible: newVal });
    await fetch(
      `${API_URL}/api/campaigns/${campaignId}/maps/${mapId}/images/${layer.id}`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerVisible: newVal }),
      },
    );
  }, [campaignId, mapId, updateLayer]);

  const handleDelete = useCallback(async (layer: ImageLayerData) => {
    if (!campaignId || !mapId) return;
    removeLayer(layer.id);
    await fetch(
      `${API_URL}/api/campaigns/${campaignId}/maps/${mapId}/images/${layer.id}`,
      { method: 'DELETE', credentials: 'include' },
    );
  }, [campaignId, mapId, removeLayer]);

  const handleDragStart = (index: number) => {
    dragItemRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverRef.current = index;
  };

  const handleDrop = useCallback(async () => {
    const from = dragItemRef.current;
    const to = dragOverRef.current;
    dragItemRef.current = null;
    dragOverRef.current = null;

    if (from === null || to === null || from === to) return;
    if (!campaignId || !mapId) return;

    // Compute new order
    const ids = layers.map((l) => l.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);

    reorderLayers(ids);

    // PATCH each changed layer's sortOrder
    for (let i = 0; i < ids.length; i++) {
      const layerId = ids[i];
      if (!layerId) continue;
      const original = layers.find((l) => l.id === layerId);
      if (original && original.sortOrder !== i) {
        fetch(
          `${API_URL}/api/campaigns/${campaignId}/maps/${mapId}/images/${layerId}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sortOrder: i }),
          },
        );
      }
    }
  }, [campaignId, mapId, layers, reorderLayers]);

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Image Layers
      </h3>

      {/* Upload button */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !mapId}
          className="w-full px-3 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading...' : 'Upload Image'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Layer list */}
      {layers.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No image layers yet.</p>
      ) : (
        <div className="space-y-1">
          {layers.map((layer, index) => (
            <div
              key={layer.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={handleDrop}
              className="flex items-center gap-2 px-2 py-1.5 bg-gray-700/50 rounded text-sm cursor-grab active:cursor-grabbing"
            >
              {/* Drag handle */}
              <span className="text-gray-500 text-xs select-none">::</span>

              {/* Filename */}
              <span className="text-gray-200 truncate flex-1" title={layer.fileName}>
                {layer.fileName}
              </span>

              {/* DM visibility toggle */}
              <button
                onClick={() => handleToggleVisible(layer)}
                className={`text-xs px-1 ${
                  layer.visible
                    ? 'text-gray-300 hover:text-gray-100'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? 'V' : 'H'}
              </button>

              {/* Player visibility toggle */}
              <button
                onClick={() => handleTogglePlayerVisible(layer)}
                className={`text-xs px-1 ${
                  layer.playerVisible
                    ? 'text-green-400 hover:text-green-300'
                    : 'text-gray-600 hover:text-gray-400'
                }`}
                title={layer.playerVisible ? 'Visible to players' : 'Hidden from players'}
              >
                P
              </button>

              {/* Align button */}
              <button
                onClick={() => enterAlignmentMode(layer.id)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50"
                title="Align grid to image"
              >
                Align
              </button>

              {/* Delete button */}
              <button
                onClick={() => handleDelete(layer)}
                className="text-xs text-red-500 hover:text-red-400 px-1"
                title="Delete layer"
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
