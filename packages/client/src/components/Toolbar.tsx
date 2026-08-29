import React, { useState } from 'react';
import {
  MARKER_LIBRARY,
  TERRAINS,
  TERRAIN_IDS,
  hexKey,
  hexesInPixelRect,
  type FogState,
  type HexCoord,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi, type Tool } from '../stores/ui.js';
import { send } from '../ws.js';
import { cx } from '../ui/kit.js';

const TOOLS: { tool: Tool; icon: string; name: string; hint: string }[] = [
  { tool: 'select', icon: '➤', name: 'Select (V)', hint: 'Click hexes, drag tokens, pan' },
  { tool: 'paint', icon: '🖌️', name: 'Terrain (B)', hint: 'Paint terrain (drag)' },
  { tool: 'fog', icon: '🌫️', name: 'Fog (F)', hint: 'Reveal / hide hexes' },
  { tool: 'marker', icon: '📍', name: 'Marker (M)', hint: 'Place effect markers' },
  { tool: 'content', icon: '📖', name: 'Content (C)', hint: 'Add hex content' },
  { tool: 'measure', icon: '📏', name: 'Measure (R)', hint: 'Measure distances' },
];

export function Toolbar() {
  const ui = useUi();

  return (
    <div className="absolute left-3 top-3 z-30 flex flex-col gap-2 max-h-[calc(100%-1.5rem)]">
      <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-1.5 flex flex-col gap-1 shadow-xl backdrop-blur">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            onClick={() => ui.setTool(t.tool)}
            title={`${t.name} — ${t.hint}`}
            className={cx(
              'w-9 h-9 rounded-md flex items-center justify-center text-base transition-colors cursor-pointer',
              ui.tool === t.tool
                ? 'bg-brass-500/25 ring-1 ring-brass-500 text-brass-300'
                : 'hover:bg-ink-700 text-ink-300',
            )}
          >
            {t.icon}
          </button>
        ))}
      </div>

      {(ui.tool === 'paint' || ui.tool === 'fog') && (
        <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-44 overflow-y-auto">
          {ui.tool === 'paint' && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1.5">
                Terrain
              </p>
              <div className="grid grid-cols-4 gap-1 mb-2">
                {TERRAIN_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => ui.set('paintTerrain', id)}
                    title={TERRAINS[id].label}
                    className={cx(
                      'h-8 rounded cursor-pointer border transition-transform hover:scale-105',
                      ui.paintTerrain === id ? 'border-white ring-1 ring-white' : 'border-ink-600',
                    )}
                    style={{ background: TERRAINS[id].color }}
                  />
                ))}
                <button
                  onClick={() => ui.set('paintTerrain', null)}
                  title="Eraser"
                  className={cx(
                    'h-8 rounded cursor-pointer border flex items-center justify-center text-xs bg-ink-800',
                    ui.paintTerrain === null ? 'border-white ring-1 ring-white' : 'border-ink-600',
                  )}
                >
                  ⌫
                </button>
              </div>
              {ui.paintTerrain && (
                <p className="text-xs text-ink-300 mb-2">{TERRAINS[ui.paintTerrain].label}</p>
              )}
            </>
          )}
          {ui.tool === 'fog' && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1.5">
                Set hexes to
              </p>
              <div className="flex flex-col gap-1 mb-2">
                {(
                  [
                    ['visible', '☀️ Visible', 'Players see everything here'],
                    ['explored', '🌘 Explored', 'Seen before — dimmed, no creatures'],
                    ['hidden', '⬛ Hidden', 'Players see nothing'],
                  ] as [FogState, string, string][]
                ).map(([state, label, hint]) => (
                  <button
                    key={state}
                    onClick={() => ui.set('fogTarget', state)}
                    title={hint}
                    className={cx(
                      'text-left text-xs px-2 py-1.5 rounded cursor-pointer border',
                      ui.fogTarget === state
                        ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                        : 'border-ink-700 hover:bg-ink-700 text-ink-200',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ApplyFogToAll />
            </>
          )}
          <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
            Brush size
          </p>
          <div className="flex gap-1">
            {([0, 1, 2] as const).map((r) => (
              <button
                key={r}
                onClick={() => ui.set('brushRadius', r)}
                className={cx(
                  'flex-1 py-1 rounded text-xs cursor-pointer border',
                  ui.brushRadius === r
                    ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                    : 'border-ink-700 hover:bg-ink-700 text-ink-200',
                )}
              >
                {r === 0 ? '1' : r === 1 ? '7' : '19'}
              </button>
            ))}
          </div>
        </div>
      )}

      {ui.tool === 'marker' && (
        <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-52 overflow-y-auto">
          {MARKER_LIBRARY.map((group) => (
            <div key={group.group} className="mb-2">
              <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
                {group.group}
              </p>
              <div className="grid grid-cols-6 gap-0.5">
                {group.glyphs.map((g) => (
                  <button
                    key={g.glyph}
                    onClick={() => ui.set('markerGlyph', g.glyph)}
                    title={g.name}
                    className={cx(
                      'h-7 rounded flex items-center justify-center cursor-pointer text-sm',
                      ui.markerGlyph === g.glyph ? 'bg-brass-500/25 ring-1 ring-brass-500' : 'hover:bg-ink-700',
                    )}
                  >
                    {g.glyph}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <label className="flex items-center gap-2 text-xs text-ink-200 cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={ui.markerDmOnly}
              onChange={(e) => ui.set('markerDmOnly', e.target.checked)}
            />
            DM-only marker
          </label>
        </div>
      )}

      {ui.tool === 'measure' && (
        <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-44 text-xs text-ink-300">
          Click a hex to set the start point, then hover. Click again to clear.
        </div>
      )}
    </div>
  );
}

/**
 * Apply the selected fog state to every hex on the map: painted terrain,
 * cells that already have a fog state, and the full footprint of any map
 * images. Commands are chunked to respect the per-command cell limit.
 */
function ApplyFogToAll() {
  const fogTarget = useUi((s) => s.fogTarget);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    const session = useSession.getState();
    const state = session.state;
    const map = activeMap(state);
    if (!state?.mapState || !map || busy) return;
    setBusy(true);
    try {
      const layout = {
        orientation: map.orientation,
        size: map.hexSize,
        origin: { x: map.originX, y: map.originY },
      };
      const cells = new Map<string, HexCoord>();
      const add = (c: HexCoord) => cells.set(hexKey(c.q, c.r), { q: c.q, r: c.r });
      for (const h of state.mapState.hexes) add(h);
      for (const f of state.mapState.fog) add(f);
      for (const layer of state.mapState.imageLayers) {
        try {
          const size = await imageNaturalSize(layer.path);
          for (const c of hexesInPixelRect(
            layout,
            layer.x,
            layer.y,
            layer.x + size.width * layer.scale,
            layer.y + size.height * layer.scale,
          )) {
            add(c);
            if (cells.size > 60000) throw new Error('too-large');
          }
        } catch (err) {
          if (err instanceof Error && err.message === 'too-large') {
            session.pushToast({
              kind: 'error',
              title: 'Map too large',
              text: 'That image spans over 60,000 hexes — fog the areas you need with the brush instead.',
            });
            return;
          }
          // Image failed to load; skip its footprint.
        }
      }
      if (cells.size === 0) {
        session.pushToast({
          kind: 'info',
          title: 'Nothing to fog',
          text: 'Paint terrain or upload a map image first.',
        });
        return;
      }
      const all = [...cells.values()];
      session.optimisticFog(map.id, all, fogTarget);
      for (let i = 0; i < all.length; i += 5000) {
        send({ kind: 'fog.set', mapId: map.id, cells: all.slice(i, i + 5000), state: fogTarget });
      }
      session.pushToast({
        kind: 'info',
        title: 'Fog updated',
        text: `Set ${all.length.toLocaleString()} hex${all.length === 1 ? '' : 'es'} to ${fogTarget}.`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => void apply()}
      disabled={busy}
      className="w-full mb-2 px-2 py-1.5 rounded text-xs cursor-pointer border border-ink-600 bg-ink-800 hover:bg-ink-700 text-ink-100 disabled:opacity-50"
      title="Set every hex on this map (terrain, fogged cells, and map-image area) to the selected state"
    >
      {busy ? 'Applying…' : '⬢ Apply to entire map'}
    </button>
  );
}

const imageSizeCache = new Map<string, { width: number; height: number }>();

function imageNaturalSize(path: string): Promise<{ width: number; height: number }> {
  const cached = imageSizeCache.get(path);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      imageSizeCache.set(path, size);
      resolve(size);
    };
    img.onerror = () => reject(new Error(`Failed to load ${path}`));
    img.src = path;
  });
}
