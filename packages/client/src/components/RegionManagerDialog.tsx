import React, { useMemo, useState } from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  TERRAINS,
  TERRAIN_IDS,
  contentCells,
  hexKey,
  isFullContent,
  type Content,
  type HexCoord,
  type HexLayout,
  type MapInfo,
  type TerrainId,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, EmptyNote, Input, Select, cx } from '../ui/kit.js';
import { baseImageLayer, detectByImage, detectByTerrain } from '../engine/regionDetect.js';

/**
 * DM region manager (issue #113): every region on the map in one place, with
 * the two bulk operations hand-painting can't do — recommend a footprint from
 * the map itself, and paint one terrain across a footprint.
 *
 * The preview flow mirrors the content dialog's paint bar: running a
 * detection collapses this dialog to a floating Accept/Cancel bar so the DM
 * can actually see the proposal on the map, and the component stays mounted
 * so the settings that produced it survive a Cancel.
 */

/** `content.area` accepts 5000 cells per message; a huge accept is chunked. */
const AREA_CHUNK = 5000;

/**
 * The auto-detect settings. They live in the dialog root rather than in the
 * detail pane because the detail pane unmounts while the proposal bar is up —
 * a tolerance the DM tuned to 60 must still be 60 after a Cancel.
 */
interface DetectSettings {
  mode: 'terrain' | 'color';
  terrains: TerrainId[];
  tolerance: number;
  maxCells: number;
}

export function RegionManagerDialog() {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const setUi = useUi((s) => s.set);
  const areaHighlight = useUi((s) => s.areaHighlight);
  const areaProposal = useUi((s) => s.areaProposal);

  // Regions are contents typed 'region' plus anything else that has grown an
  // area — any content type can carry a footprint, and a 40-hex "landmark"
  // is a region in every way that matters here.
  const regions = (state?.mapState?.contents ?? [])
    .filter(isFullContent)
    .filter((c) => c.type === 'region' || c.area.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title)) as Content[];

  const [selectedId, setSelectedId] = useState<string | null>(
    useUi.getState().regionTargetId ?? regions[0]?.id ?? null,
  );
  const selected = regions.find((r) => r.id === selectedId) ?? regions[0] ?? null;

  const terrainAt = useMemo(() => {
    const m = new Map<string, TerrainId>();
    for (const cell of state?.mapState?.hexes ?? []) m.set(hexKey(cell.q, cell.r), cell.terrain);
    return m;
  }, [state?.mapState?.hexes]);

  const [detect, setDetect] = useState<DetectSettings>({
    mode: 'terrain',
    terrains: [],
    tolerance: 25,
    maxCells: 800,
  });
  // The terrain chips default to the selected region's own terrain; the rest
  // of the settings deliberately carry across regions.
  const [defaultsFor, setDefaultsFor] = useState<string | null>(null);
  if (selected && defaultsFor !== selected.id) {
    const anchorTerrain = terrainAt.get(hexKey(selected.q, selected.r)) ?? null;
    setDefaultsFor(selected.id);
    setDetect((d) => ({ ...d, terrains: anchorTerrain ? [anchorTerrain] : [] }));
  }

  const close = () => {
    setUi('areaProposal', null);
    setUi('areaHighlight', null);
    setUi('regionManagerOpen', false);
  };

  if (!map) return null;

  // Collapsed: a proposal is on the map and the dialog is in the way.
  if (areaProposal) {
    return <ProposalBar proposal={areaProposal} regions={regions} />;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-ink-850 border border-ink-600 rounded-xl shadow-2xl w-full min-w-0 max-w-5xl h-[85dvh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <h2 className="font-semibold text-ink-100">Regions</h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close">
            ✕
          </Button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="w-44 sm:w-64 shrink-0 border-r border-ink-700 overflow-y-auto p-2 space-y-1.5">
            {regions.length === 0 && (
              <EmptyNote>
                No regions on this map yet. Create one with the Content tool (C) — anything with an
                area shows up here.
              </EmptyNote>
            )}
            {regions.map((r) => (
              <RegionCard
                key={r.id}
                region={r}
                terrainAt={terrainAt}
                selected={r.id === selected?.id}
                onSelect={() => setSelectedId(r.id)}
              />
            ))}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {selected ? (
              <RegionDetail
                key={selected.id}
                region={selected}
                map={map}
                terrainAt={terrainAt}
                regions={regions}
                detect={detect}
                setDetect={setDetect}
                highlighted={
                  areaHighlight?.contentId === selected.id && !areaHighlight.proposal
                }
                onClose={close}
              />
            ) : (
              <EmptyNote>Pick a region on the left.</EmptyNote>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Terrain histogram over a footprint, most common first. */
function terrainSummary(
  region: Content,
  terrainAt: Map<string, TerrainId>,
): { terrain: TerrainId | null; count: number }[] {
  const counts = new Map<TerrainId | null, number>();
  for (const cell of contentCells(region)) {
    const t = terrainAt.get(hexKey(cell.q, cell.r)) ?? null;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([terrain, count]) => ({ terrain, count }))
    .sort((a, b) => b.count - a.count);
}

function summaryText(rows: { terrain: TerrainId | null; count: number }[]): string {
  return rows
    .slice(0, 3)
    .map((row) => `${row.terrain ? TERRAINS[row.terrain].label : 'unpainted'} ${row.count}`)
    .join(' · ');
}

function RegionCard({
  region,
  terrainAt,
  selected,
  onSelect,
}: {
  region: Content;
  terrainAt: Map<string, TerrainId>;
  selected: boolean;
  onSelect: () => void;
}) {
  const size = contentCells(region).length;
  const rows = terrainSummary(region, terrainAt);
  return (
    <button
      onClick={onSelect}
      className={cx(
        'w-full text-left rounded-lg border px-2 py-1.5 cursor-pointer',
        selected ? 'border-brass-500 bg-brass-500/10' : 'border-ink-700 hover:bg-ink-800',
      )}
    >
      <div className={cx('text-sm truncate', selected ? 'text-brass-300' : 'text-ink-200')}>
        {region.glyph || CONTENT_TYPE_GLYPHS[region.type]} {region.title}
      </div>
      <div className="text-[11px] text-ink-400">
        {size} hex{size === 1 ? '' : 'es'}
      </div>
      <div className="text-[10px] text-ink-500 truncate" title={summaryText(rows)}>
        {summaryText(rows)}
      </div>
    </button>
  );
}

function layoutOf(map: MapInfo): HexLayout {
  return {
    orientation: map.orientation,
    size: map.hexSize,
    origin: { x: map.originX, y: map.originY },
  };
}

function RegionDetail({
  region,
  map,
  terrainAt,
  regions,
  detect,
  setDetect,
  highlighted,
  onClose,
}: {
  region: Content;
  map: MapInfo;
  terrainAt: Map<string, TerrainId>;
  regions: Content[];
  detect: DetectSettings;
  setDetect: React.Dispatch<React.SetStateAction<DetectSettings>>;
  highlighted: boolean;
  onClose: () => void;
}) {
  const setUi = useUi((s) => s.set);
  const imageLayers = useSession((s) => s.state?.mapState?.imageLayers) ?? [];
  const baseLayer = baseImageLayer(imageLayers);
  const anchorTerrain = terrainAt.get(hexKey(region.q, region.r)) ?? null;
  const rows = terrainSummary(region, terrainAt);
  const size = contentCells(region).length;

  const { mode, terrains, tolerance, maxCells } = detect;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fill, setFill] = useState<TerrainId | 'erase'>(
    (rows[0]?.terrain ?? anchorTerrain ?? 'plains') as TerrainId,
  );
  const [skipOtherRegions, setSkipOtherRegions] = useState(true);

  const toggleTerrain = (id: TerrainId) =>
    setDetect((d) => ({
      ...d,
      terrains: d.terrains.includes(id)
        ? d.terrains.filter((t) => t !== id)
        : [...d.terrains, id],
    }));

  const preview = async () => {
    setError(null);
    setBusy(true);
    try {
      const anchor: HexCoord = { q: region.q, r: region.r };
      const detected =
        mode === 'terrain'
          ? detectByTerrain({
              hexes: useSession.getState().state?.mapState?.hexes ?? [],
              anchor,
              terrains: new Set(terrains),
              limits: { maxCells },
            })
          : await detectByImage({
              layer: baseLayer!,
              layout: layoutOf(map),
              anchor,
              tolerance,
              limits: { maxCells },
            });
      const cells = [anchor, ...detected];
      setUi('areaProposal', { contentId: region.id, cells });
      setUi('areaHighlight', { contentId: region.id, cells, proposal: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setBusy(false);
    }
  };

  const applyFill = () => {
    const overlapping = countOverlap(region, regions);
    if (!skipOtherRegions && overlapping > 0) {
      const ok = confirm(
        `Overwrite terrain on ${overlapping} hex${overlapping === 1 ? '' : 'es'} that belong to another region?`,
      );
      if (!ok) return;
    }
    send({
      kind: 'content.applyTerrain',
      contentId: region.id,
      terrain: fill === 'erase' ? null : fill,
      skipOtherRegions,
    });
  };

  const rename = (title: string) => {
    const next = title.trim();
    if (!next || next === region.title) return;
    // `content.upsert` sets exactly what it is sent (clues included), so a
    // rename has to resend the whole item — dropping `clues` would wipe them.
    send({
      kind: 'content.upsert',
      content: {
        id: region.id,
        mapId: region.mapId,
        q: region.q,
        r: region.r,
        area: region.area,
        type: region.type,
        title: next,
        dmNotes: region.dmNotes,
        glyph: region.glyph,
        showLabel: region.showLabel,
        scaleVisibility: region.scaleVisibility,
        wikiPage: region.wikiPage,
        enabled: region.enabled,
        knownLocation: region.knownLocation,
        quest: region.quest,
        clues: region.clues.map((c) => ({
          id: c.id,
          text: c.text,
          gate: c.gate,
          sortOrder: c.sortOrder,
          indicatesDirection: c.indicatesDirection,
          revealsLocation: c.revealsLocation,
        })),
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          key={`name-${region.id}-${region.title}`}
          defaultValue={region.title}
          maxLength={120}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <Button
          size="sm"
          variant={highlighted ? 'primary' : 'ghost'}
          title="Wash this footprint over the map"
          onClick={() =>
            setUi(
              'areaHighlight',
              highlighted ? null : { contentId: region.id, cells: contentCells(region) },
            )
          }
        >
          {highlighted ? '◉ Highlighted' : '◎ Highlight'}
        </Button>
      </div>
      <p className="text-xs text-ink-400">
        Anchor {region.q}, {region.r} · {size} hex{size === 1 ? '' : 'es'} ·{' '}
        {summaryText(rows) || 'unpainted'}
      </p>

      <section className="border border-ink-700 rounded-lg p-3 space-y-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
          Auto-detect the area
        </h3>
        <div className="flex items-center gap-2">
          <Select
            value={mode}
            onChange={(e) =>
              setDetect((d) => ({ ...d, mode: e.target.value as 'terrain' | 'color' }))
            }
            className="!w-44"
          >
            <option value="terrain">Terrain match</option>
            <option value="color" disabled={!baseLayer}>
              Map colours{baseLayer ? '' : ' (no map image)'}
            </option>
          </Select>
          {!baseLayer && (
            <span className="text-[11px] text-ink-500">
              Add a map image layer to detect against the art.
            </span>
          )}
        </div>

        {mode === 'terrain' ? (
          <div>
            <p className="text-[11px] text-ink-400 mb-1">
              Grow from the anchor across these terrains (unpainted hexes always stop the fill):
            </p>
            <div className="flex flex-wrap gap-1">
              {TERRAIN_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => toggleTerrain(id)}
                  className={cx(
                    'px-2 py-0.5 rounded-full text-[11px] cursor-pointer border',
                    terrains.includes(id)
                      ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                      : 'border-ink-700 text-ink-300 hover:bg-ink-700',
                  )}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
                    style={{ background: TERRAINS[id].color }}
                  />
                  {TERRAINS[id].label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[11px] text-ink-400 flex items-center gap-2">
              Colour tolerance
              <input
                type="range"
                min={5}
                max={80}
                value={tolerance}
                onChange={(e) => setDetect((d) => ({ ...d, tolerance: Number(e.target.value) }))}
                className="flex-1"
              />
              <span className="w-8 text-right text-ink-200">{tolerance}</span>
            </label>
            <p className="text-[11px] text-ink-500 mt-1">
              Every hex is compared against the anchor's colour on{' '}
              {baseLayer ? baseLayer.name : 'the base image'} — low values hug one flat colour,
              high values cross shading.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-ink-400 flex items-center gap-1.5">
            Max hexes
            <Input
              type="number"
              min={1}
              max={3000}
              className="!w-24"
              value={maxCells}
              onChange={(e) =>
                setDetect((d) => ({
                  ...d,
                  maxCells: Math.min(3000, Math.max(1, Math.round(Number(e.target.value) || 1))),
                }))
              }
            />
          </label>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || (mode === 'color' && !baseLayer)}
            onClick={() => void preview()}
          >
            {busy ? 'Detecting…' : '🔍 Preview'}
          </Button>
          {error && <span className="text-[11px] text-ember-500">{error}</span>}
        </div>
      </section>

      <section className="border border-ink-700 rounded-lg p-3 space-y-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">
          Terrain fill
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={fill}
            onChange={(e) => setFill(e.target.value as TerrainId | 'erase')}
            className="!w-44"
          >
            {TERRAIN_IDS.map((id) => (
              <option key={id} value={id}>
                {TERRAINS[id].label}
              </option>
            ))}
            <option value="erase">⌫ Erase terrain</option>
          </Select>
          <Button size="sm" variant="primary" onClick={applyFill}>
            Apply to {size} hex{size === 1 ? '' : 'es'}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
          <input
            type="checkbox"
            checked={skipOtherRegions}
            onChange={(e) => setSkipOtherRegions(e.target.checked)}
          />
          Skip hexes in other regions
          <span className="text-[11px] text-ink-400">
            ({countOverlap(region, regions)} shared)
          </span>
        </label>
      </section>

      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setUi('contentDialogHex', { q: region.q, r: region.r });
            setUi('editingContentId', region.id);
            onClose();
          }}
        >
          Open full editor
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          disabled={region.area.length === 0}
          onClick={() => {
            if (confirm(`Clear the ${region.area.length}-hex area of "${region.title}"?`)) {
              send({ kind: 'content.area', contentId: region.id, remove: region.area });
            }
          }}
        >
          Clear area
        </Button>
      </div>
    </div>
  );
}

/** How many of this region's hexes another region also claims. */
function countOverlap(region: Content, regions: Content[]): number {
  const others = new Set<string>();
  for (const other of regions) {
    if (other.id === region.id || other.area.length === 0) continue;
    for (const cell of contentCells(other)) others.add(hexKey(cell.q, cell.r));
  }
  return contentCells(region).filter((c) => others.has(hexKey(c.q, c.r))).length;
}

/**
 * The collapsed state: the proposal is drawn on the map (amber, through the
 * area-highlight layer) and this bar is all that's left of the dialog.
 */
function ProposalBar({
  proposal,
  regions,
}: {
  proposal: { contentId: string; cells: HexCoord[] };
  regions: Content[];
}) {
  const setUi = useUi((s) => s.set);
  const region = regions.find((r) => r.id === proposal.contentId) ?? null;

  const cancel = () => {
    setUi('areaProposal', null);
    setUi('areaHighlight', null);
  };

  // What Accept would actually send: the proposal minus what the footprint
  // already holds (the anchor included — the server ignores it either way).
  const existing = new Set(region ? contentCells(region).map((c) => hexKey(c.q, c.r)) : []);
  const add = proposal.cells.filter((c) => !existing.has(hexKey(c.q, c.r)));

  const accept = () => {
    if (region) {
      for (let i = 0; i < add.length; i += AREA_CHUNK) {
        send({
          kind: 'content.area',
          contentId: region.id,
          add: add.slice(i, i + AREA_CHUNK),
        });
      }
    }
    cancel();
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 flex-wrap justify-center max-w-[calc(100vw-1.5rem)] bg-ink-850/95 border border-brass-500/60 rounded-xl shadow-2xl px-4 py-2.5 backdrop-blur">
      <span className="text-sm text-ink-100">
        {proposal.cells.length} hex{proposal.cells.length === 1 ? '' : 'es'} proposed for{' '}
        <span className="font-medium">{region?.title ?? 'this region'}</span>
      </span>
      <span className="text-xs text-ink-400">
        {add.length} new hex{add.length === 1 ? '' : 'es'} would be added
      </span>
      <Button size="sm" variant="primary" onClick={accept} disabled={add.length === 0}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" onClick={cancel}>
        Cancel
      </Button>
    </div>
  );
}
