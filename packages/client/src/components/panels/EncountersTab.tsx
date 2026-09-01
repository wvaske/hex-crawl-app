import React, { useState } from 'react';
import {
  CORE_SKILLS,
  TERRAINS,
  TERRAIN_IDS,
  diceBounds,
  parseDice,
  type EncounterTable,
  type TerrainId,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Field, Input, Section, Select, TextArea, cx } from '../../ui/kit.js';

export function EncountersTab() {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  if (!state || !map) return <EmptyNote>No active map.</EmptyNote>;

  return (
    <div>
      <RollPanel mapId={map.id} />
      <CheckPanel />
      <TablesPanel />
    </div>
  );
}

function partyHex(): { q: number; r: number } | null {
  const s = useSession.getState();
  const selected = useUi.getState().selectedHex;
  if (selected) return selected;
  const pc = s.state?.mapState?.tokens.find((t) => t.kind === 'pc');
  return pc ? { q: pc.q, r: pc.r } : null;
}

function RollPanel({ mapId }: { mapId: string }) {
  const state = useSession((s) => s.state);
  const map = activeMap(state)!;
  const selectedHex = useUi((s) => s.selectedHex);
  const hex = selectedHex ?? partyHex();

  const roll = (skipCheck: boolean) =>
    send({
      kind: 'encounter.roll',
      mapId,
      q: hex?.q ?? null,
      r: hex?.r ?? null,
      tableId: null,
      skipCheck,
    });

  return (
    <Section title="Wandering encounter">
      <p className="text-xs text-ink-400 mb-2">
        Check die <span className="text-ink-200">{map.encounterCheck.die}</span>, encounter on{' '}
        <span className="text-ink-200">{map.encounterCheck.threshold}+</span>
        {hex ? (
          <>
            {' '}
            · terrain from hex{' '}
            <span className="text-ink-200">
              {hex.q},{hex.r}
            </span>
          </>
        ) : (
          ' · select a hex or place a party token for terrain matching'
        )}
        . Results appear in the DM log.
      </p>
      <div className="flex gap-2 mb-2">
        <Button variant="primary" size="sm" className="flex-1" onClick={() => roll(false)}>
          🎲 Roll check
        </Button>
        <Button size="sm" className="flex-1" onClick={() => roll(true)} title="Skip the trigger die and roll the table directly">
          Force encounter
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Check die">
          <Input
            defaultValue={map.encounterCheck.die}
            key={map.encounterCheck.die}
            onBlur={(e) => {
              if (parseDice(e.target.value) && e.target.value !== map.encounterCheck.die) {
                send({ kind: 'map.update', mapId, patch: { encounterCheck: { die: e.target.value } } });
              }
            }}
          />
        </Field>
        <Field label="Threshold">
          <Input
            type="number"
            defaultValue={map.encounterCheck.threshold}
            key={map.encounterCheck.threshold}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v) && v !== map.encounterCheck.threshold) {
                send({ kind: 'map.update', mapId, patch: { encounterCheck: { threshold: v } } });
              }
            }}
          />
        </Field>
      </div>
      <div className="mt-2">
        <Field label="Auto-check every N hexes of travel (0 = off)">
          <Input
            type="number"
            min={0}
            max={99}
            defaultValue={map.encounterCheck.autoEvery}
            key={map.encounterCheck.autoEvery}
            onBlur={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v) && v >= 0 && v <= 99 && v !== map.encounterCheck.autoEvery) {
                send({ kind: 'map.update', mapId, patch: { encounterCheck: { autoEvery: v } } });
              }
            }}
          />
        </Field>
        {map.encounterCheck.autoEvery > 0 && (
          <p className="text-[11px] text-ink-400 mt-1">
            Rolling automatically as the party travels — every{' '}
            {map.encounterCheck.autoEvery === 1
              ? 'hex'
              : `${map.encounterCheck.autoEvery} hexes`}
            . Results land in the DM log.
          </p>
        )}
      </div>
    </Section>
  );
}

function CheckPanel() {
  const state = useSession((s) => s.state);
  const [skill, setSkill] = useState<string>('perception');
  const [dc, setDc] = useState('');
  const characters = state?.characters ?? [];
  const customSkills = new Set<string>();
  for (const ch of characters) {
    for (const s of Object.keys(ch.skills)) {
      if (!(CORE_SKILLS as readonly string[]).includes(s)) customSkills.add(s);
    }
  }

  return (
    <Section title="Group skill check">
      <p className="text-xs text-ink-400 mb-2">
        Rolls d20 + modifier for every character with a token on the map. Results are DM-only —
        share what you choose.
      </p>
      <div className="flex gap-1.5">
        <Select value={skill} onChange={(e) => setSkill(e.target.value)}>
          {[...CORE_SKILLS, ...customSkills].map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <Input
          className="!w-16"
          placeholder="DC"
          value={dc}
          onChange={(e) => setDc(e.target.value)}
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const dcNum = Number(dc);
            send({
              kind: 'check.roll',
              skill,
              dc: dc && Number.isFinite(dcNum) ? Math.round(dcNum) : null,
              characterIds: [],
              mapId: null,
              hex: null,
            });
          }}
        >
          Roll
        </Button>
      </div>
    </Section>
  );
}

function TablesPanel() {
  const state = useSession((s) => s.state);
  const [editing, setEditing] = useState<EncounterTable | 'new' | null>(null);
  const tables = state?.encounterTables ?? [];

  return (
    <Section
      title="Encounter tables"
      actions={
        <Button size="sm" variant="ghost" onClick={() => setEditing('new')}>
          + New table
        </Button>
      }
    >
      {tables.length === 0 && (
        <EmptyNote>
          Build tables per terrain (forest, swamp…) and the roller picks the right one from the
          party's hex.
        </EmptyNote>
      )}
      <div className="space-y-1.5">
        {tables.map((t) => (
          <div
            key={t.id}
            className={cx(
              'flex items-center bg-ink-850 border border-ink-700 rounded-md hover:border-ink-600',
              !t.enabled && 'opacity-50',
            )}
          >
            <button
              className="flex-1 min-w-0 text-left px-2.5 py-2 cursor-pointer"
              onClick={() => setEditing(t)}
            >
              <span className="text-sm text-ink-100 font-medium">{t.name}</span>
              <span className="block text-xs text-ink-400 mt-0.5">
                {t.die} · {t.entries.length} entries ·{' '}
                {t.terrains.length ? t.terrains.map((x) => TERRAINS[x].label).join(', ') : 'any terrain'}
                {!t.enabled && ' · disabled'}
              </span>
            </button>
            <button
              className="shrink-0 px-2.5 py-2 text-base cursor-pointer"
              title={
                t.enabled
                  ? 'Active — terrain rolls can pick this table. Click to disable for this session.'
                  : 'Disabled — terrain rolls skip this table. Click to enable.'
              }
              onClick={() => send({ kind: 'encounterTable.upsert', table: { ...t, enabled: !t.enabled } })}
            >
              {t.enabled ? '🟢' : '⚪'}
            </button>
          </div>
        ))}
      </div>
      {editing && (
        <TableEditor
          table={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

function TableEditor({ table, onClose }: { table: EncounterTable | null; onClose: () => void }) {
  const [name, setName] = useState(table?.name ?? '');
  const [die, setDie] = useState(table?.die ?? '1d12');
  const [terrains, setTerrains] = useState<TerrainId[]>(table?.terrains ?? []);
  const [entriesText, setEntriesText] = useState(
    (table?.entries ?? [])
      .map((e) => `${e.min}${e.max !== e.min ? `-${e.max}` : ''}: ${e.text}${e.quantity ? ` [${e.quantity}]` : ''}`)
      .join('\n'),
  );
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const parsed = parseEntries(entriesText);
    if (typeof parsed === 'string') {
      setError(parsed);
      return;
    }
    if (!name.trim()) {
      setError('Name the table');
      return;
    }
    if (!parseDice(die)) {
      setError(`"${die}" is not valid dice notation`);
      return;
    }
    const bounds = diceBounds(die)!;
    const uncovered = parsed.some((e) => e.min < bounds.min || e.max > bounds.max);
    if (uncovered) {
      setError(`Entries fall outside ${die} range (${bounds.min}–${bounds.max})`);
      return;
    }
    send({
      kind: 'encounterTable.upsert',
      table: {
        id: table?.id ?? null,
        name: name.trim(),
        die,
        terrains,
        entries: parsed,
        enabled: table?.enabled ?? true,
      },
    });
    onClose();
  };

  return (
    <div className="mt-2 bg-ink-850 border border-brass-500/40 rounded-lg p-3 space-y-2.5">
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <Field label="Table name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dark forest" autoFocus />
        </Field>
        <Field label="Die">
          <Input value={die} onChange={(e) => setDie(e.target.value)} />
        </Field>
      </div>
      <Field label="Terrains (none = any)">
        <div className="flex flex-wrap gap-1">
          {TERRAIN_IDS.map((id) => (
            <button
              key={id}
              onClick={() =>
                setTerrains((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
              className={cx(
                'px-1.5 py-0.5 rounded text-[11px] cursor-pointer border',
                terrains.includes(id)
                  ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                  : 'border-ink-700 text-ink-300 hover:bg-ink-700',
              )}
            >
              {TERRAINS[id].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Entries — one per line: range: text [quantity dice]">
        <TextArea
          rows={7}
          value={entriesText}
          onChange={(e) => setEntriesText(e.target.value)}
          placeholder={'2: Young green dragon\n3-5: Bandit scouts [2d4]\n6-12: No encounter — eerie silence'}
          className="font-mono !text-xs"
        />
      </Field>
      {error && <p className="text-xs text-ember-500">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={save}>
          Save table
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {table && (
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={() => {
              send({ kind: 'encounterTable.delete', tableId: table.id });
              onClose();
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function parseEntries(
  text: string,
): { min: number; max: number; text: string; quantity: string }[] | string {
  const entries: { min: number; max: number; text: string; quantity: string }[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?\s*[:.]\s*(.+)$/.exec(line);
    if (!m) return `Can't parse line: "${line}"`;
    let body = m[3]!.trim();
    let quantity = '';
    const qm = /\[([^\]]+)\]\s*$/.exec(body);
    if (qm) {
      if (!parseDice(qm[1]!)) return `Bad quantity dice in: "${line}"`;
      quantity = qm[1]!;
      body = body.slice(0, qm.index).trim();
    }
    const min = parseInt(m[1]!, 10);
    const max = m[2] ? parseInt(m[2], 10) : min;
    if (max < min) return `Range reversed in: "${line}"`;
    entries.push({ min, max, text: body, quantity });
  }
  if (!entries.length) return 'Add at least one entry';
  return entries;
}
