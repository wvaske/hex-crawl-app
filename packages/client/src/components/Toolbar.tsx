import React, { useState } from 'react';
import {
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
import { STICKER_CATEGORIES, stickerUrl } from '../stickers.js';

const TOOLS: { tool: Tool; icon: string; name: string; hint: string }[] = [
  { tool: 'select', icon: '➤', name: 'Select (V)', hint: 'Click hexes, drag tokens, pan' },
  { tool: 'paint', icon: '🖌️', name: 'Terrain (B)', hint: 'Paint terrain (drag)' },
  { tool: 'fog', icon: '🌫️', name: 'Fog (F)', hint: 'Reveal / hide hexes' },
  { tool: 'marker', icon: '📍', name: 'Marker (M)', hint: 'Place effect markers' },
  { tool: 'content', icon: '📖', name: 'Content (C)', hint: 'Add hex content' },
  { tool: 'trail', icon: '👣', name: 'Trail (T)', hint: 'Draw a footstep trail cell by cell' },
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
              'px-2.5 py-1.5 rounded-md text-left text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
              ui.tool === t.tool
                ? 'bg-brass-500/25 ring-1 ring-brass-500 text-brass-300'
                : 'hover:bg-ink-700 text-ink-300',
            )}
          >
            {t.name}
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
                    ['visible', '☀️ Visible', 'Players see everything here (light tint; creatures shown)'],
                    ['explored', '🌘 Explored', 'Where the party has been — renders brightest, no creatures shown'],
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

      {ui.tool === 'marker' && <StickerPicker />}

      {ui.tool === 'trail' && <TrailOptions />}

      {ui.tool === 'measure' && (
        <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-44 text-xs text-ink-300">
          Click a hex to set the start point, then hover. Click again to clear.
        </div>
      )}
    </div>
  );
}

/**
 * Marker sticker picker (issue #67): category tabs + a name search over the
 * vendored SVG library, with the legacy emoji set kept as its own category so
 * older markers stay reachable. Picking a sticker stores its id in
 * `ui.markerIcon`; picking an emoji clears the id and stores the glyph — the
 * canvas prefers `icon` when it is set.
 */
function StickerPicker() {
  const ui = useUi();
  const [category, setCategory] = useState(STICKER_CATEGORIES[0]!.id);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  // A search spans every category; otherwise show just the selected tab.
  const groups = q
    ? STICKER_CATEGORIES.map((c) => ({
        ...c,
        stickers: c.stickers.filter((s) => s.name.toLowerCase().includes(q)),
        glyphs: (c.glyphs ?? []).filter((g) => g.name.toLowerCase().includes(q)),
      })).filter((c) => c.stickers.length > 0 || (c.glyphs ?? []).length > 0)
    : STICKER_CATEGORIES.filter((c) => c.id === category);

  return (
    <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-60 overflow-y-auto">
      <div className="flex flex-wrap gap-0.5 mb-1.5">
        {STICKER_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setCategory(c.id);
              setQuery('');
            }}
            className={cx(
              'px-1.5 py-0.5 rounded text-[10px] cursor-pointer border',
              !q && category === c.id
                ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                : 'border-ink-700 hover:bg-ink-700 text-ink-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        className="w-full bg-ink-950 border border-ink-600 rounded px-2 py-1 text-xs text-ink-100 mb-1.5"
        placeholder="Search stickers…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length === 0 && <p className="text-[11px] text-ink-400 mb-2">No sticker matches.</p>}
      {groups.map((group) => (
        <div key={group.id} className="mb-2">
          {q && (
            <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
              {group.label}
            </p>
          )}
          <div className="grid grid-cols-6 gap-0.5">
            {group.stickers.map((s) => (
              <button
                key={s.id}
                onClick={() => ui.set('markerIcon', s.id)}
                title={s.name}
                className={cx(
                  'h-8 rounded flex items-center justify-center cursor-pointer p-1',
                  ui.markerIcon === s.id
                    ? 'bg-brass-500/25 ring-1 ring-brass-500'
                    : 'hover:bg-ink-700',
                )}
              >
                <img
                  src={stickerUrl(s.id)}
                  alt={s.name}
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              </button>
            ))}
            {(group.glyphs ?? []).map((g) => (
              <button
                key={g.glyph}
                onClick={() => {
                  ui.set('markerIcon', '');
                  ui.set('markerGlyph', g.glyph);
                }}
                title={g.name}
                className={cx(
                  'h-8 rounded flex items-center justify-center cursor-pointer text-sm',
                  !ui.markerIcon && ui.markerGlyph === g.glyph
                    ? 'bg-brass-500/25 ring-1 ring-brass-500'
                    : 'hover:bg-ink-700',
                )}
              >
                {g.glyph}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="block text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-1">
        Size — {ui.markerScale.toFixed(1)}×
      </label>
      <input
        type="range"
        min={0.5}
        max={3}
        step={0.1}
        value={ui.markerScale}
        onChange={(e) => ui.set('markerScale', Number(e.target.value))}
        className="w-full cursor-pointer accent-brass-500 mb-1"
      />
      <label className="flex items-center gap-2 text-xs text-ink-200 cursor-pointer mt-1">
        <input
          type="checkbox"
          checked={ui.markerDmOnly}
          onChange={(e) => ui.set('markerDmOnly', e.target.checked)}
        />
        DM-only marker
      </label>
    </div>
  );
}

/**
 * Trail tool options: click cells in order to draw the path, then save.
 * A saved trail "pushes": each walked cell tells its finder the way onward
 * and back, never the whole route.
 */
const TRAIL_SKILLS = ['survival', 'nature', 'perception', 'investigation'] as const;

function TrailOptions() {
  const draft = useUi((s) => s.trailDraft);
  const editingTrailId = useUi((s) => s.editingTrailId);
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const trails = state?.mapState?.trails ?? [];
  const [name, setName] = useState('');
  const [skill, setSkill] = useState<'auto' | (typeof TRAIL_SKILLS)[number]>('auto');
  const [dc, setDc] = useState('12');

  if (!map) return null;
  const editing = editingTrailId ? trails.find((t) => t.id === editingTrailId) : undefined;

  const reset = () => {
    useUi.getState().set('trailDraft', []);
    useUi.getState().set('editingTrailId', null);
    setName('');
    setSkill('auto');
    setDc('12');
  };

  const startEdit = (trailId: string) => {
    const t = trails.find((x) => x.id === trailId);
    if (!t) return;
    useUi.getState().set('editingTrailId', t.id);
    useUi.getState().set('trailDraft', [...t.cells]);
    setName(t.name);
    if (t.gate.kind === 'skill') {
      setSkill((TRAIL_SKILLS as readonly string[]).includes(t.gate.skill) ? (t.gate.skill as (typeof TRAIL_SKILLS)[number]) : 'survival');
      setDc(String(t.gate.dc));
    } else {
      setSkill('auto');
    }
  };

  const save = () => {
    if (draft.length < 2 || !name.trim()) return;
    const dcNum = Math.min(40, Math.max(1, Math.round(Number(dc) || 12)));
    send({
      kind: 'trail.upsert',
      trail: {
        id: editingTrailId,
        mapId: map.id,
        name: name.trim(),
        glyph: editing?.glyph ?? '👣',
        dmNotes: editing?.dmNotes ?? '',
        gate:
          skill === 'auto'
            ? { kind: 'auto' }
            : { kind: 'skill', skill, dc: dcNum, maxDistance: 0, mode: 'passive' },
        cells: draft,
      },
    });
    reset();
  };

  return (
    <div className="bg-ink-900/95 border border-ink-700 rounded-lg p-2 shadow-xl backdrop-blur w-52 overflow-y-auto space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold">
        {editing ? `Editing: ${editing.name}` : 'New trail'} — {draft.length} cell
        {draft.length === 1 ? '' : 's'}
      </p>
      <p className="text-[11px] text-ink-400">
        Click hexes in order; click the last cell again to step back. Walkers learn only the
        direction onward and back.
      </p>
      <input
        className="w-full bg-ink-950 border border-ink-600 rounded px-2 py-1 text-xs text-ink-100"
        placeholder="Trail name…"
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex items-center gap-1.5 text-[11px] text-ink-300">
        <select
          className="flex-1 bg-ink-950 border border-ink-600 rounded px-1 py-0.5 cursor-pointer capitalize"
          value={skill}
          onChange={(e) => setSkill(e.target.value as typeof skill)}
          title="How each cell is noticed: obvious (walking on it), or a passive skill DC"
        >
          <option value="auto">Obvious (auto)</option>
          {TRAIL_SKILLS.map((s) => (
            <option key={s} value={s}>
              {s} check
            </option>
          ))}
        </select>
        {skill !== 'auto' && (
          <input
            type="number"
            min={1}
            max={40}
            className="w-12 bg-ink-950 border border-ink-600 rounded px-1 py-0.5"
            value={dc}
            onChange={(e) => setDc(e.target.value)}
            title={`Passive ${skill} DC to notice each cell (searchable via Search this hex too)`}
          />
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          className="flex-1 py-1 rounded text-xs cursor-pointer bg-brass-500/20 text-brass-300 border border-brass-500/50 disabled:opacity-40"
          disabled={draft.length < 2 || !name.trim()}
          onClick={save}
        >
          {editing ? 'Save changes' : 'Save trail'}
        </button>
        <button
          className="px-2 py-1 rounded text-xs cursor-pointer text-ink-300 border border-ink-600 hover:bg-ink-700"
          onClick={reset}
        >
          {editing ? 'Cancel' : 'Clear'}
        </button>
      </div>
      {trails.length > 0 && (
        <div className="border-t border-ink-700 pt-1.5 space-y-1">
          {trails.map((t) => (
            <div key={t.id} className="flex items-center gap-1.5 text-xs text-ink-200">
              <span className="truncate flex-1">
                {t.glyph} {t.name}
                <span className="text-ink-400">
                  {' '}
                  · {t.cells.length} ·{' '}
                  {t.gate.kind === 'skill' ? `${t.gate.skill} ${t.gate.dc}` : 'auto'}
                </span>
              </span>
              <button
                className="text-ink-400 hover:text-brass-300 cursor-pointer"
                title="Edit this trail: nodes load into the draft; adjust, then Save changes"
                onClick={() => startEdit(t.id)}
              >
                ✎
              </button>
              <button
                className="text-ink-400 hover:text-ember-500 cursor-pointer"
                title="Delete trail"
                onClick={() => send({ kind: 'trail.delete', trailId: t.id })}
              >
                ✕
              </button>
            </div>
          ))}
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
      if (
        cells.size > 0 &&
        !confirm(
          `Set ${cells.size.toLocaleString()} hexes to "${fogTarget}"? This replaces the fog state of the whole map (you can Undo afterwards).`,
        )
      ) {
        return;
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
      // One command = one undo step (the server accepts large cell batches).
      send({ kind: 'fog.set', mapId: map.id, cells: all, state: fogTarget });
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
