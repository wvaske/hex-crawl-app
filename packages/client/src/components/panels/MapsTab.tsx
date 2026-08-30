import React, { useRef, useState } from 'react';
import type { ImageLayer, MapInfo } from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { uploadMapImage } from '../../api.js';
import { Button, EmptyNote, Field, Input, Section, Select, Toggle, cx } from '../../ui/kit.js';

export function MapsTab({ campaignId }: { campaignId: string }) {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const [newName, setNewName] = useState('');

  if (!state) return null;

  const createMap = () => {
    const name = newName.trim() || `Map ${state.maps.length + 1}`;
    send({ kind: 'map.create', name, orientation: 'flat', hexSize: 48 });
    setNewName('');
  };

  return (
    <div>
      <Section title="Maps">
        <ul className="space-y-1 mb-2">
          {state.maps.map((m) => (
            <li
              key={m.id}
              className={cx(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer border',
                m.id === state.campaign.activeMapId
                  ? 'border-brass-500/50 bg-brass-500/10 text-brass-300'
                  : 'border-transparent hover:bg-ink-850 text-ink-200',
              )}
              onClick={() => send({ kind: 'map.setActive', mapId: m.id })}
            >
              <span className="flex-1 truncate">{m.name}</span>
              {m.id === state.campaign.activeMapId && <span className="text-[10px]">ACTIVE</span>}
              {state.maps.length > 1 && (
                <button
                  className="text-ink-400 hover:text-ember-500 text-xs cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete map "${m.name}" and everything on it?`)) {
                      send({ kind: 'map.delete', mapId: m.id });
                    }
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New map name"
            onKeyDown={(e) => e.key === 'Enter' && createMap()}
          />
          <Button size="sm" onClick={createMap}>
            +
          </Button>
        </div>
      </Section>

      {map ? <MapSettings key={map.id} map={map} campaignId={campaignId} /> : <EmptyNote>Create a map to begin.</EmptyNote>}
    </div>
  );
}

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function MapSettings({ map, campaignId }: { map: MapInfo; campaignId: string }) {
  const patch = (p: Record<string, unknown>) =>
    send({ kind: 'map.update', mapId: map.id, patch: p });

  return (
    <>
      <Section title="Map settings">
        <div className="space-y-2.5">
          <Field label="Name">
            <Input
              defaultValue={map.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== map.name && patch({ name: e.target.value.trim() })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Orientation">
              <Select
                value={map.orientation}
                onChange={(e) => patch({ orientation: e.target.value })}
              >
                <option value="flat">Flat-top</option>
                <option value="pointy">Pointy-top</option>
              </Select>
            </Field>
            <Field label="Hex size (px)">
              <Input
                type="number"
                min={4}
                max={512}
                defaultValue={map.hexSize}
                onBlur={(e) => patch({ hexSize: Math.min(512, Math.max(4, num(e.target.value, map.hexSize))) })}
              />
            </Field>
            <Field label="Miles per hex">
              <Input
                type="number"
                defaultValue={map.milesPerHex}
                onBlur={(e) => patch({ milesPerHex: Math.max(0, num(e.target.value, map.milesPerHex)) })}
              />
            </Field>
            <Field label="Movement">
              <Select value={map.moveMode} onChange={(e) => patch({ moveMode: e.target.value })}>
                <option value="free">Free drag</option>
                <option value="step">One hex/step</option>
              </Select>
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Fog & sight">
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fog mode">
              <Select value={map.fogMode} onChange={(e) => patch({ fogMode: e.target.value })}>
                <option value="auto">Auto-reveal</option>
                <option value="manual">Manual only</option>
              </Select>
            </Field>
            <Field label="Sight radius">
              <Input
                type="number"
                min={0}
                max={10}
                defaultValue={map.sightRadius}
                onBlur={(e) => patch({ sightRadius: Math.min(10, Math.max(0, Math.round(num(e.target.value, map.sightRadius)))) })}
              />
            </Field>
          </div>
          <Toggle
            checked={map.fogDecay}
            onChange={(v) => patch({ fogDecay: v })}
            label="Fade to explored when out of sight"
          />
          <Toggle
            checked={map.moveApproval}
            onChange={(v) => patch({ moveApproval: v })}
            label="DM approves player movement (turn-based travel)"
          />
          <Button
            size="sm"
            variant="ghost"
            className="w-full"
            title="Add smoke/din/smell clues (with auto compass bearings) to every settlement on this map that doesn't have them. Safe to run again."
            onClick={() => send({ kind: 'clues.generateSettlements', mapId: map.id })}
          >
            🏘️ Generate settlement sensory clues
          </Button>
        </div>
      </Section>

      <Section title="Grid style">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Line color">
              <input
                type="color"
                className="w-full h-8 rounded cursor-pointer bg-ink-900 border border-ink-600"
                value={map.gridStyle.lineColor}
                onChange={(e) => patch({ gridStyle: { lineColor: e.target.value } })}
              />
            </Field>
            <Field label="Line width">
              <Input
                type="number"
                step={0.5}
                min={0.5}
                max={8}
                defaultValue={map.gridStyle.lineWidth}
                onBlur={(e) => patch({ gridStyle: { lineWidth: Math.min(8, Math.max(0.5, num(e.target.value, map.gridStyle.lineWidth))) } })}
              />
            </Field>
          </div>
          <SliderField
            label={`Grid opacity — ${Math.round(map.gridStyle.lineOpacity * 100)}%`}
            value={map.gridStyle.lineOpacity}
            onCommit={(v) => patch({ gridStyle: { lineOpacity: v } })}
          />
          <SliderField
            label={`Terrain opacity — ${Math.round(map.gridStyle.terrainOpacity * 100)}%`}
            value={map.gridStyle.terrainOpacity}
            onCommit={(v) => patch({ gridStyle: { terrainOpacity: v } })}
          />
        </div>
      </Section>

      <Section title="Grid alignment">
        <p className="text-xs text-ink-400 mb-2">
          Nudge the grid origin to line hexes up with a map image.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Origin X">
            <Input
              type="number"
              defaultValue={map.originX}
              key={`ox-${map.originX}`}
              onBlur={(e) => patch({ originX: num(e.target.value, map.originX) })}
            />
          </Field>
          <Field label="Origin Y">
            <Input
              type="number"
              defaultValue={map.originY}
              key={`oy-${map.originY}`}
              onBlur={(e) => patch({ originY: num(e.target.value, map.originY) })}
            />
          </Field>
        </div>
        <div className="flex gap-1 mt-2">
          {(
            [
              ['←', -5, 0],
              ['→', 5, 0],
              ['↑', 0, -5],
              ['↓', 0, 5],
            ] as [string, number, number][]
          ).map(([label, dx, dy]) => (
            <Button
              key={label}
              size="sm"
              onClick={() => patch({ originX: map.originX + dx, originY: map.originY + dy })}
            >
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <ImageLayers map={map} campaignId={campaignId} />
    </>
  );
}

function SliderField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wider text-ink-400 mb-1">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        defaultValue={value}
        className="w-full accent-[#c9a24b]"
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

function ImageLayers({ map, campaignId }: { map: MapInfo; campaignId: string }) {
  const state = useSession((s) => s.state);
  const pushToast = useSession((s) => s.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const layers = state?.mapState?.imageLayers ?? [];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadMapImage(campaignId, map.id, file);
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Upload failed',
        text: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Section
      title="Map images"
      actions={
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : '+ Upload'}
        </Button>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {layers.length === 0 && (
        <EmptyNote>Upload a hand-drawn or exported map to sit under the grid.</EmptyNote>
      )}
      <div className="space-y-2">
        {layers.map((layer) => (
          <ImageLayerCard key={layer.id} layer={layer} />
        ))}
      </div>
    </Section>
  );
}

function ImageLayerCard({ layer }: { layer: ImageLayer }) {
  const patch = (p: Record<string, unknown>) =>
    send({ kind: 'imageLayer.update', layerId: layer.id, patch: p });

  return (
    <div className="bg-ink-850 border border-ink-700 rounded-lg p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <button
          className={`text-xs cursor-pointer ${layer.visible ? '' : 'opacity-40'}`}
          title={layer.visible ? 'Shown — click to hide this overlay for everyone' : 'Hidden — click to show'}
          onClick={() => patch({ visible: !layer.visible })}
        >
          {layer.visible ? '🟢' : '⚫'}
        </button>
        <span className={`text-sm truncate flex-1 ${layer.visible ? 'text-ink-100' : 'text-ink-400'}`}>
          {layer.name}
        </span>
        <button
          className="text-xs cursor-pointer"
          title={layer.dmOnly ? 'DM-only — click to share' : 'Players see this — click to hide'}
          onClick={() => patch({ dmOnly: !layer.dmOnly })}
        >
          {layer.dmOnly ? '🚫' : '👁️'}
        </button>
        <button
          className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer"
          onClick={() => send({ kind: 'imageLayer.delete', layerId: layer.id })}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <MiniNum label="X" value={layer.x} onCommit={(v) => patch({ x: v })} />
        <MiniNum label="Y" value={layer.y} onCommit={(v) => patch({ y: v })} />
        <MiniNum label="Scale" value={layer.scale} step={0.01} onCommit={(v) => patch({ scale: Math.max(0.01, v) })} />
      </div>
      <SliderField
        label={`Opacity — ${Math.round(layer.opacity * 100)}%`}
        value={layer.opacity}
        onCommit={(v) => patch({ opacity: v })}
      />
    </div>
  );
}

function MiniNum({
  label,
  value,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] text-ink-400">{label}</span>
      <input
        type="number"
        step={step}
        key={value}
        defaultValue={value}
        className="w-full rounded bg-ink-900 border border-ink-600 px-1.5 py-1 text-xs text-ink-100 focus:outline-none focus:border-brass-500"
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
      />
    </label>
  );
}
