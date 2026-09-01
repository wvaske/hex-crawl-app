import React, { useEffect, useState } from 'react';
import type { InheritableMapField, MapInfo } from '@hexcrawl/shared';
import { fetchMapThumbs, type MapThumb } from '../api.js';
import { useSession } from '../stores/session.js';
import { send } from '../ws.js';
import { Button, EmptyNote, Input, Select, cx } from '../ui/kit.js';

/**
 * DM map manager (issue #60): every map in one place, with thumbnails, and
 * per-setting "linked to the campaign default" vs "map-specific".
 *
 * Inheritance is resolved server-side on write — a map's values are always
 * concrete, `inheritedFields` only records which ones follow the campaign
 * default. So this dialog reads plain map values and toggles links.
 */
export function MapManagerDialog({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const state = useSession((s) => s.state);
  const maps = state?.maps ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    state?.campaign.activeMapId ?? maps[0]?.id ?? null,
  );
  const [thumbs, setThumbs] = useState<Record<string, MapThumb>>({});
  const [showDefaults, setShowDefaults] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Snapshots only carry the viewed map's image layers, so per-map summaries
  // come from a small DM-only endpoint. Refetch when the map set changes.
  const mapIds = maps.map((m) => m.id).join(',');
  useEffect(() => {
    let live = true;
    void fetchMapThumbs(campaignId)
      .then((rows) => {
        if (!live) return;
        setThumbs(Object.fromEntries(rows.map((r) => [r.mapId, r])));
      })
      .catch(() => {
        /* thumbnails are cosmetic — a failure just leaves placeholders */
      });
    return () => {
      live = false;
    };
  }, [campaignId, mapIds]);

  const selected = maps.find((m) => m.id === selectedId) ?? maps[0] ?? null;

  const move = (map: MapInfo, delta: number) => {
    const ordered = [...maps].sort((a, b) => a.sortOrder - b.sortOrder);
    const i = ordered.findIndex((m) => m.id === map.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const other = ordered[j]!;
    send({ kind: 'map.update', mapId: map.id, patch: { sortOrder: other.sortOrder } });
    send({ kind: 'map.update', mapId: other.id, patch: { sortOrder: map.sortOrder } });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-ink-850 border border-ink-600 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700 shrink-0">
          <h2 className="font-semibold text-ink-100">Maps</h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={showDefaults ? 'primary' : 'ghost'}
              onClick={() => setShowDefaults((v) => !v)}
              title="Settings every linked map follows"
            >
              🔗 Campaign defaults
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="w-64 shrink-0 border-r border-ink-700 overflow-y-auto p-2 space-y-1.5">
            {maps.length === 0 && <EmptyNote>No maps yet.</EmptyNote>}
            {[...maps]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((m, i, arr) => (
                <MapCard
                  key={m.id}
                  map={m}
                  thumb={thumbs[m.id]}
                  active={m.id === state?.campaign.activeMapId}
                  selected={m.id === selected?.id}
                  first={i === 0}
                  last={i === arr.length - 1}
                  onSelect={() => setSelectedId(m.id)}
                  onMove={(d) => move(m, d)}
                />
              ))}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {showDefaults && <CampaignDefaults />}
            {selected ? (
              <MapSettingsForm key={selected.id} map={selected} canDelete={maps.length > 1} />
            ) : (
              <EmptyNote>Create a map in the Maps panel to configure it here.</EmptyNote>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MapCard({
  map,
  thumb,
  active,
  selected,
  first,
  last,
  onSelect,
  onMove,
}: {
  map: MapInfo;
  thumb: MapThumb | undefined;
  active: boolean;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onMove: (delta: number) => void;
}) {
  return (
    <div
      className={cx(
        'rounded-lg border cursor-pointer overflow-hidden',
        selected ? 'border-brass-500 bg-brass-500/10' : 'border-ink-700 hover:bg-ink-800',
      )}
      onClick={onSelect}
    >
      <Thumbnail map={map} thumb={thumb} />
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span
          className={cx('flex-1 min-w-0 truncate text-sm', selected ? 'text-brass-300' : 'text-ink-200')}
        >
          {map.name}
        </span>
        {active && <span className="text-[10px] text-brass-300">ACTIVE</span>}
        <button
          className="text-ink-400 hover:text-ink-100 text-xs cursor-pointer disabled:opacity-25"
          disabled={first}
          title="Move up"
          onClick={(e) => {
            e.stopPropagation();
            onMove(-1);
          }}
        >
          ▲
        </button>
        <button
          className="text-ink-400 hover:text-ink-100 text-xs cursor-pointer disabled:opacity-25"
          disabled={last}
          title="Move down"
          onClick={(e) => {
            e.stopPropagation();
            onMove(1);
          }}
        >
          ▼
        </button>
      </div>
    </div>
  );
}

/** v1 thumbnail: the first visible image layer, else a placeholder tile. */
function Thumbnail({ map, thumb }: { map: MapInfo; thumb: MapThumb | undefined }) {
  if (thumb?.image) {
    return (
      <img
        src={thumb.image}
        alt=""
        className="w-full h-20 object-cover bg-ink-900"
        draggable={false}
      />
    );
  }
  return (
    <div className="w-full h-20 bg-ink-900 flex flex-col items-center justify-center gap-0.5">
      <span
        className="text-lg text-ink-500 leading-none"
        style={map.orientation === 'flat' ? { transform: 'rotate(90deg)' } : undefined}
        title={map.orientation === 'flat' ? 'Flat-top hexes' : 'Pointy-top hexes'}
      >
        ⬡
      </span>
      <span className="text-[10px] text-ink-400">
        {thumb ? `${thumb.hexCount} hex${thumb.hexCount === 1 ? '' : 'es'} painted` : 'no image'}
      </span>
    </div>
  );
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * One settings row with its link toggle. When linked, the control is disabled
 * and the value shown is whatever the campaign default last wrote.
 */
function Row({
  label,
  field,
  map,
  children,
  hint,
}: {
  label: string;
  field: InheritableMapField | null;
  map: MapInfo;
  children: (disabled: boolean) => React.ReactNode;
  hint?: string;
}) {
  const inherited = field !== null && map.inheritedFields.includes(field);
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-wider text-ink-400" title={hint}>
        {label}
      </span>
      <div className={cx('flex-1 min-w-0', inherited && 'opacity-60')}>{children(inherited)}</div>
      {field && (
        <button
          className={cx(
            'text-xs w-7 shrink-0 cursor-pointer',
            inherited ? 'text-brass-300' : 'text-ink-500 hover:text-ink-200',
          )}
          title={
            inherited
              ? 'Linked to the campaign default — click to make it map-specific'
              : 'Map-specific — click to link it to the campaign default'
          }
          onClick={() => send({ kind: 'map.setInherit', mapId: map.id, field, inherit: !inherited })}
        >
          {inherited ? '🔗' : '✎'}
        </button>
      )}
      {!field && <span className="w-7 shrink-0" />}
    </div>
  );
}

function MapSettingsForm({ map, canDelete }: { map: MapInfo; canDelete: boolean }) {
  const patch = (p: Record<string, unknown>) =>
    send({ kind: 'map.update', mapId: map.id, patch: p });
  const active = useSession((s) => s.state?.campaign.activeMapId) === map.id;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-3">
        <Input
          key={`name-${map.name}`}
          defaultValue={map.name}
          onBlur={(e) =>
            e.target.value.trim() && e.target.value !== map.name && patch({ name: e.target.value.trim() })
          }
        />
        <Button
          size="sm"
          variant={active ? 'ghost' : 'primary'}
          disabled={active}
          onClick={() => send({ kind: 'map.setActive', mapId: map.id })}
        >
          {active ? 'Active' : 'Set active'}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={!canDelete}
          title={canDelete ? undefined : 'A campaign needs at least one map'}
          onClick={() => {
            if (confirm(`Delete map "${map.name}" and everything on it?`)) {
              send({ kind: 'map.delete', mapId: map.id });
            }
          }}
        >
          Delete
        </Button>
      </div>

      <Row label="Orientation" field={null} map={map}>
        {() => (
          <Select value={map.orientation} onChange={(e) => patch({ orientation: e.target.value })}>
            <option value="flat">Flat-top</option>
            <option value="pointy">Pointy-top</option>
          </Select>
        )}
      </Row>
      <Row label="Hex size (px)" field={null} map={map}>
        {() => (
          <Input
            type="number"
            min={4}
            max={512}
            key={`hs-${map.hexSize}`}
            defaultValue={map.hexSize}
            onBlur={(e) => patch({ hexSize: Math.min(512, Math.max(4, num(e.target.value, map.hexSize))) })}
          />
        )}
      </Row>
      <Row label="Miles per hex" field="milesPerHex" map={map}>
        {(disabled) => (
          <Input
            type="number"
            disabled={disabled}
            key={`mph-${map.milesPerHex}`}
            defaultValue={map.milesPerHex}
            onBlur={(e) => patch({ milesPerHex: Math.max(0, num(e.target.value, map.milesPerHex)) })}
          />
        )}
      </Row>
      <Row label="Sight radius" field="sightRadius" map={map}>
        {(disabled) => (
          <Input
            type="number"
            min={0}
            max={10}
            disabled={disabled}
            key={`sr-${map.sightRadius}`}
            defaultValue={map.sightRadius}
            onBlur={(e) =>
              patch({ sightRadius: Math.min(10, Math.max(0, Math.round(num(e.target.value, map.sightRadius)))) })
            }
          />
        )}
      </Row>
      <Row label="Fog mode" field="fogMode" map={map}>
        {(disabled) => (
          <Select disabled={disabled} value={map.fogMode} onChange={(e) => patch({ fogMode: e.target.value })}>
            <option value="auto">Auto-reveal</option>
            <option value="manual">Manual only</option>
          </Select>
        )}
      </Row>
      <Row label="Fog decay" field="fogDecay" map={map} hint="Fade to explored when out of sight">
        {(disabled) => (
          <CheckLine
            disabled={disabled}
            checked={map.fogDecay}
            label="Fade to explored when out of sight"
            onChange={(v) => patch({ fogDecay: v })}
          />
        )}
      </Row>
      <Row label="Movement" field="moveMode" map={map}>
        {(disabled) => (
          <Select disabled={disabled} value={map.moveMode} onChange={(e) => patch({ moveMode: e.target.value })}>
            <option value="free">Free drag</option>
            <option value="step">One hex/step</option>
          </Select>
        )}
      </Row>
      <Row label="Move approval" field="moveApproval" map={map}>
        {(disabled) => (
          <CheckLine
            disabled={disabled}
            checked={map.moveApproval}
            label="DM approves player movement"
            onChange={(v) => patch({ moveApproval: v })}
          />
        )}
      </Row>
      <Row label="Encounter check" field="encounterCheck" map={map} hint="Die, threshold, and auto-check cadence">
        {(disabled) => (
          <EncounterFields
            disabled={disabled}
            value={map.encounterCheck}
            onChange={(p) => patch({ encounterCheck: p })}
          />
        )}
      </Row>
    </div>
  );
}

function CheckLine({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={cx('flex items-center gap-2 text-sm', disabled ? 'text-ink-400' : 'text-ink-200 cursor-pointer')}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function EncounterFields({
  value,
  disabled,
  onChange,
}: {
  value: { die: string; threshold: number; autoEvery: number };
  disabled: boolean;
  onChange: (patch: { die?: string; threshold?: number; autoEvery?: number }) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <Input
        disabled={disabled}
        key={`die-${value.die}`}
        defaultValue={value.die}
        title="Die rolled for the encounter check"
        onBlur={(e) => e.target.value.trim() && e.target.value !== value.die && onChange({ die: e.target.value.trim() })}
      />
      <Input
        type="number"
        disabled={disabled}
        key={`th-${value.threshold}`}
        defaultValue={value.threshold}
        title="An encounter occurs on a roll at or above this"
        onBlur={(e) => onChange({ threshold: Math.round(num(e.target.value, value.threshold)) })}
      />
      <Input
        type="number"
        min={0}
        max={99}
        disabled={disabled}
        key={`ae-${value.autoEvery}`}
        defaultValue={value.autoEvery}
        title="Auto-roll a check every N hexes travelled (0 = off)"
        onBlur={(e) =>
          onChange({ autoEvery: Math.min(99, Math.max(0, Math.round(num(e.target.value, value.autoEvery)))) })
        }
      />
    </div>
  );
}

/**
 * The campaign-wide defaults. Saving one pushes it straight into every map
 * that still has that field linked.
 */
function CampaignDefaults() {
  const defaults = useSession((s) => s.state?.campaign.settings.mapDefaults);
  const maps = useSession((s) => s.state?.maps) ?? [];
  if (!defaults) return null;
  const set = (p: Record<string, unknown>) =>
    send({ kind: 'campaign.update', settings: { mapDefaults: p } });
  const linked = (field: InheritableMapField) =>
    maps.filter((m) => m.inheritedFields.includes(field)).length;

  return (
    <div className="mb-4 rounded-lg border border-brass-500/40 bg-brass-500/5 p-3">
      <p className="text-[11px] uppercase tracking-wider text-brass-300 font-semibold mb-1">
        Campaign defaults
      </p>
      <p className="text-xs text-ink-400 mb-2">
        Changing one of these updates every map with that setting linked ({maps.length} map
        {maps.length === 1 ? '' : 's'} total).
      </p>
      <div className="space-y-1">
        <DefaultRow label="Miles per hex" count={linked('milesPerHex')}>
          <Input
            type="number"
            key={`d-mph-${defaults.milesPerHex}`}
            defaultValue={defaults.milesPerHex}
            onBlur={(e) => set({ milesPerHex: Math.max(0, num(e.target.value, defaults.milesPerHex)) })}
          />
        </DefaultRow>
        <DefaultRow label="Sight radius" count={linked('sightRadius')}>
          <Input
            type="number"
            min={0}
            max={10}
            key={`d-sr-${defaults.sightRadius}`}
            defaultValue={defaults.sightRadius}
            onBlur={(e) =>
              set({ sightRadius: Math.min(10, Math.max(0, Math.round(num(e.target.value, defaults.sightRadius)))) })
            }
          />
        </DefaultRow>
        <DefaultRow label="Fog mode" count={linked('fogMode')}>
          <Select value={defaults.fogMode} onChange={(e) => set({ fogMode: e.target.value })}>
            <option value="auto">Auto-reveal</option>
            <option value="manual">Manual only</option>
          </Select>
        </DefaultRow>
        <DefaultRow label="Fog decay" count={linked('fogDecay')}>
          <CheckLine
            disabled={false}
            checked={defaults.fogDecay}
            label="Fade to explored when out of sight"
            onChange={(v) => set({ fogDecay: v })}
          />
        </DefaultRow>
        <DefaultRow label="Movement" count={linked('moveMode')}>
          <Select value={defaults.moveMode} onChange={(e) => set({ moveMode: e.target.value })}>
            <option value="free">Free drag</option>
            <option value="step">One hex/step</option>
          </Select>
        </DefaultRow>
        <DefaultRow label="Move approval" count={linked('moveApproval')}>
          <CheckLine
            disabled={false}
            checked={defaults.moveApproval}
            label="DM approves player movement"
            onChange={(v) => set({ moveApproval: v })}
          />
        </DefaultRow>
        <DefaultRow label="Encounter check" count={linked('encounterCheck')}>
          <EncounterFields
            disabled={false}
            value={defaults.encounterCheck}
            onChange={(p) => set({ encounterCheck: p })}
          />
        </DefaultRow>
      </div>
    </div>
  );
}

function DefaultRow({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-40 shrink-0 text-[11px] uppercase tracking-wider text-ink-400">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
      <span className="w-16 shrink-0 text-right text-[10px] text-ink-500" title="Maps following this default">
        🔗 {count}
      </span>
    </div>
  );
}
