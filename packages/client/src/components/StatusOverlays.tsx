import React from 'react';
import { TERRAINS, hexDistance, hexKey } from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';

/** Bottom-left readout: hovered hex, terrain, and measure distances. */
export function HexReadout() {
  const state = useSession((s) => s.state);
  const hover = useUi((s) => s.hoverHex);
  const measureStart = useUi((s) => s.measureStart);
  const tool = useUi((s) => s.tool);
  const map = activeMap(state);
  if (!map || !hover || !state?.mapState) return null;

  const terrain = state.mapState.hexes.find((h) => hexKey(h.q, h.r) === hexKey(hover.q, hover.r))
    ?.terrain;
  const measuring = tool === 'measure' && measureStart;
  const dist = measuring ? hexDistance(measureStart, hover) : null;

  return (
    <div className="absolute bottom-3 left-3 z-30 bg-ink-900/90 border border-ink-700 rounded-md px-2.5 py-1.5 text-xs text-ink-300 backdrop-blur pointer-events-none">
      <span className="text-ink-100 font-medium">
        {hover.q}, {hover.r}
      </span>
      {terrain && <span> · {TERRAINS[terrain].label}</span>}
      {dist !== null && (
        <span className="text-arcane-500 font-medium">
          {' '}
          · {dist} hex{dist === 1 ? '' : 'es'} ≈ {dist * map.milesPerHex} mi
        </span>
      )}
    </div>
  );
}

/** First-run hint for a DM staring at an empty map. */
export function EmptyMapHint() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  if (role !== 'dm' || !state?.mapState) return null;
  const ms = state.mapState;
  if (ms.hexes.length > 0 || ms.imageLayers.length > 0) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="bg-ink-900/85 border border-ink-700 rounded-xl px-6 py-5 text-center backdrop-blur max-w-sm">
        <div className="text-3xl mb-2">🗺️</div>
        <p className="text-sm text-ink-100 font-medium mb-1">Your map awaits</p>
        <p className="text-xs text-ink-400">
          Paint terrain with the 🖌️ tool, or upload a map image from the Maps tab. Scroll to zoom,
          drag to pan.
        </p>
      </div>
    </div>
  );
}
