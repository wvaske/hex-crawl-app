import { useCallback } from 'react';
import { useSessionStore } from '../stores/useSessionStore';
import { useMapStore } from '../stores/useMapStore';
import { apiFetch } from '../lib/api';

type FogTargets = 'all' | { playerIds: string[] };

/**
 * Hook providing fog of war actions for DM controls.
 *
 * All reveal/hide actions send WebSocket messages.
 * Map upload POSTs hex data to the REST API.
 */
export function useFogActions() {
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const campaignId = useSessionStore((s) => s.campaignId);

  const revealSelected = useCallback(
    (hexKeys: string[], targets: FogTargets = 'all') => {
      if (!sendMessage || hexKeys.length === 0) return;
      sendMessage({
        type: 'hex:reveal',
        hexKeys,
        targets,
      });
    },
    [sendMessage],
  );

  const hideSelected = useCallback(
    (hexKeys: string[], targets: FogTargets = 'all') => {
      if (!sendMessage || hexKeys.length === 0) return;
      sendMessage({
        type: 'hex:hide',
        hexKeys,
        targets,
      });
    },
    [sendMessage],
  );

  const revealAll = useCallback(() => {
    if (!sendMessage) return;
    const allKeys = [...useMapStore.getState().hexes.keys()];
    if (allKeys.length === 0) return;
    sendMessage({
      type: 'hex:reveal',
      hexKeys: allKeys,
      targets: 'all',
    });
  }, [sendMessage]);

  const hideAll = useCallback(() => {
    if (!sendMessage) return;
    const revealed = [...useSessionStore.getState().revealedHexKeys];
    if (revealed.length === 0) return;
    sendMessage({
      type: 'hex:hide',
      hexKeys: revealed,
      targets: 'all',
    });
  }, [sendMessage]);

  const uploadMapToServer = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!campaignId) return { ok: false, error: 'No campaign selected' };
    const hexes = useMapStore.getState().hexes;
    if (hexes.size === 0) return { ok: false, error: 'No map data to upload' };

    const hexArray = [...hexes.entries()].map(([key, data]) => ({
      key,
      terrain: data.terrain,
      terrainVariant: data.terrainVariant,
    }));

    try {
      await apiFetch(`/api/campaigns/${campaignId}/map`, {
        method: 'POST',
        body: JSON.stringify({ hexes: hexArray }),
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return { ok: false, error: message };
    }
  }, [campaignId]);

  return {
    revealSelected,
    hideSelected,
    revealAll,
    hideAll,
    uploadMapToServer,
  };
}
