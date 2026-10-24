import React, { useState } from 'react';
import type { Retinue, Token } from '@hexcrawl/shared';
import {
  DEFAULT_NPC_MPH,
  formatDuration,
  hexDistance,
  minutesPerHex,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Field, Input, Section, Select, Toggle, Lbl, cx } from '../../ui/kit.js';
import { SendTokenButton } from '../SendTokenButton.js';
import { TravelToButton } from '../TravelToDialog.js';
import { STICKER_CATEGORIES, stickerUrl } from '../../stickers.js';

/** Build → Tokens: party tokens, NPC/monster tokens, and the retinue roster. */
export function TokensTab() {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const selectedHex = useUi((s) => s.selectedHex);

  if (!state || !map || !state.mapState) return <EmptyNote>No active map.</EmptyNote>;
  const tokens = state.mapState.tokens;
  const spawnAt = selectedHex ?? { q: 0, r: 0 };
  const retinues = state.campaign.settings.retinues;

  const charactersWithoutToken = state.characters.filter(
    (ch) => !tokens.some((t) => t.characterId === ch.id),
  );
  const loose = tokens.filter((t) => !t.retinueId || !retinues.some((r) => r.id === t.retinueId));

  return (
    <div>
      {charactersWithoutToken.length > 0 && (
        <Section title="Party tokens">
          <p className="text-xs text-ink-400 mb-2">
            Drop a token for each character{selectedHex ? ` at hex ${spawnAt.q}, ${spawnAt.r}` : ' (select a hex first to choose where)'}
            .
          </p>
          <div className="space-y-1.5">
            {charactersWithoutToken.map((ch) => (
              <Button
                key={ch.id}
                size="sm"
                className="w-full justify-start"
                onClick={() =>
                  send({
                    kind: 'token.create',
                    mapId: map.id,
                    q: spawnAt.q,
                    r: spawnAt.r,
                    tokenKind: 'pc',
                    characterId: ch.id,
                    label: ch.name,
                    color: ch.color,
                    glyph: ch.glyph,
                    playerVisible: true,
                  })
                }
              >
                <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ background: ch.color }} />
                Place {ch.name}
              </Button>
            ))}
          </div>
        </Section>
      )}

      <NpcCreator mapId={map.id} q={spawnAt.q} r={spawnAt.r} hasHex={!!selectedHex} retinues={retinues} />

      <Section title="Tokens on this map">
        {tokens.length === 0 && <EmptyNote>None yet.</EmptyNote>}
        <div className="space-y-1.5">
          {loose.map((t) => (
            <TokenRow key={t.id} token={t} />
          ))}
        </div>
        {retinues.map((rn) => {
          const members = tokens.filter((t) => t.retinueId === rn.id);
          if (members.length === 0) return null;
          return (
            <div key={rn.id} className="mt-3">
              <RetinueHeading retinue={rn} count={members.length} />
              <div className="space-y-1.5">
                {members.map((t) => (
                  <TokenRow key={t.id} token={t} retinue={rn} />
                ))}
              </div>
            </div>
          );
        })}
      </Section>

      <RetinueManager retinues={retinues} />
    </div>
  );
}

function RetinueHeading({ retinue, count }: { retinue: Retinue; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <Crest retinue={retinue} size="sm" />
      <span className="text-xs font-semibold text-ink-200 truncate">{retinue.name}</span>
      {retinue.holder && <span className="text-[0.6875rem] text-ink-400 truncate">· {retinue.holder}</span>}
      <span className="text-[0.6875rem] text-ink-400 ml-auto">{count}</span>
    </div>
  );
}

/** A retinue's crest on its colour — the same look the map token wears. */
function Crest({ retinue, size }: { retinue: Pick<Retinue, 'color' | 'icon' | 'glyph'>; size: 'sm' | 'md' }) {
  const url = retinue.icon ? stickerUrl(retinue.icon) : undefined;
  const px = size === 'sm' ? 'w-5 h-5' : 'w-8 h-8';
  return (
    <span
      className={cx(px, 'rounded-full shrink-0 border border-white/30 inline-flex items-center justify-center overflow-hidden')}
      style={{ background: retinue.color }}
    >
      {url ? (
        <img src={url} alt="" className="w-[80%] h-[80%] object-contain" draggable={false} />
      ) : (
        <span className={size === 'sm' ? 'text-[0.625rem]' : 'text-sm'}>{retinue.glyph}</span>
      )}
    </span>
  );
}

const CREST_OPTIONS = STICKER_CATEGORIES.filter((c) => c.id === 'crests' || c.id === 'objects' || c.id === 'places' || c.id === 'creatures')
  .flatMap((c) => c.stickers.map((s) => ({ id: s.id, name: `${c.label} · ${s.name}` })));

function NpcCreator({
  mapId,
  q,
  r,
  hasHex,
  retinues,
}: {
  mapId: string;
  q: number;
  r: number;
  hasHex: boolean;
  retinues: Retinue[];
}) {
  const [label, setLabel] = useState('');
  const [visible, setVisible] = useState(true);
  const [retinueId, setRetinueId] = useState<string>('');
  const [note, setNote] = useState('');
  const retinue = retinues.find((rn) => rn.id === retinueId) ?? null;

  const create = () => {
    if (!label.trim()) return;
    send({
      kind: 'token.create',
      mapId,
      q,
      r,
      tokenKind: 'npc',
      characterId: null,
      label: label.trim(),
      color: retinue?.color ?? '#8d4a4a',
      glyph: '',
      playerVisible: visible,
      ...(retinue
        ? { retinueId: retinue.id, visibleThroughFog: true, note: note.trim() }
        : {}),
    });
    setLabel('');
    setNote('');
  };

  return (
    <Section title="New NPC / monster token">
      <div className="space-y-2">
        <div className="flex gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={retinue ? 'Member name' : 'Green dragon'}
            maxLength={60}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <Button size="sm" onClick={create} disabled={!label.trim()}>
            +<Lbl>Add</Lbl>
          </Button>
        </div>
        {retinues.length > 0 && (
          <Field label="Retinue">
            <Select value={retinueId} onChange={(e) => setRetinueId(e.target.value)}>
              <option value="">None — a plain NPC</option>
              {retinues.map((rn) => (
                <option key={rn.id} value={rn.id}>
                  {rn.name}
                  {rn.holder ? ` (${rn.holder})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {retinue && (
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Posting / orders, e.g. Hold Boareskyr Bridge"
            maxLength={300}
          />
        )}
        <Toggle checked={visible} onChange={setVisible} label="Visible to players" />
        {retinue && (
          <p className="text-xs text-ink-400">
            Retinue members wear {retinue.name}'s crest and colour and are shown to players wherever
            they stand (they report their own position).
          </p>
        )}
        {!hasHex && <p className="text-xs text-ink-400">Tip: select a hex first to spawn it there.</p>}
      </div>
    </Section>
  );
}

function TokenRow({ token, retinue }: { token: Token; retinue?: Retinue }) {
  const setUi = useUi((s) => s.set);
  const draft = useUi((s) => s.routeDraft);
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const drafting = draft?.tokenId === token.id;
  const mph = token.mph ?? retinue?.mph ?? DEFAULT_NPC_MPH;
  const perHex = map ? minutesPerHex(map.milesPerHex, mph) : 0;
  const routeMinutes = token.route.length
    ? Math.max(0, token.route.length * perHex - token.travelCredit)
    : 0;
  const hoursPerDay = state?.campaign.settings.npcTravelHoursPerDay ?? 8;
  const routeDays = routeMinutes > 0 ? routeMinutes / (hoursPerDay * 60) : 0;

  return (
    <div className={cx('bg-ink-850 border rounded-md px-2 py-1.5', drafting ? 'border-brass-500' : 'border-ink-700')}>
      <div className="flex items-center gap-2">
        {retinue ? (
          <Crest retinue={{ color: token.color, icon: token.icon, glyph: token.glyph || retinue.glyph }} size="sm" />
        ) : (
          <span
            className="w-4 h-4 rounded-full shrink-0 border border-white/30"
            style={{ background: token.color }}
          />
        )}
        <button
          className="text-sm text-ink-100 truncate flex-1 text-left cursor-pointer hover:text-brass-300"
          onClick={() => {
            setUi('selectedHex', { q: token.q, r: token.r });
            setUi('selectedTokenId', token.id);
            setUi('openPanel', 'information');
          }}
          title="Jump to token"
        >
          {token.label || '(unnamed)'}
          <span className="text-ink-400 text-xs ml-1.5">
            {token.q},{token.r}
          </span>
        </button>
        <input
          type="color"
          className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
          value={token.color}
          title="Token color"
          onChange={(e) =>
            send({ kind: 'token.update', tokenId: token.id, patch: { color: e.target.value } })
          }
        />
        <button
          className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer"
          onClick={() => send({ kind: 'token.delete', tokenId: token.id })}
          title="Remove token"
        >
          ✕<Lbl>Remove</Lbl>
        </button>
      </div>
      {/* Actions on their own line: the name stays readable in a narrow panel. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 mt-0.5 pl-6">
        <SendTokenButton tokenId={token.id} name={token.label || 'token'} />
        {token.kind === 'pc' && <TravelToButton tokenId={token.id} name={token.label || 'token'} />}
        {token.kind === 'npc' && <RouteButton token={token} drafting={drafting} />}
        <button
          className={`text-xs cursor-pointer whitespace-nowrap px-2 py-1 mr-1.5 ${token.partyId ? '' : 'opacity-35 grayscale'}`}
          title={
            token.partyId
              ? 'In the party — moves with the group. Click to detach.'
              : 'Solo — click to add to the party (party members move together).'
          }
          onClick={() =>
            send({
              kind: 'token.update',
              tokenId: token.id,
              patch: { partyId: token.partyId ? null : 'party' },
            })
          }
        >
          🧭<Lbl>{token.partyId ? 'Party' : 'Solo'}</Lbl>
        </button>
        {token.kind === 'npc' && (
          <button
            className="text-xs cursor-pointer px-2 py-1 mr-1.5"
            title={token.playerVisible ? 'Players see this — click to hide' : 'Hidden — click to reveal'}
            onClick={() =>
              send({ kind: 'token.update', tokenId: token.id, patch: { playerVisible: !token.playerVisible } })
            }
          >
            {token.playerVisible ? '👁️' : '🚫'}<Lbl>{token.playerVisible ? 'Shown' : 'Hidden'}</Lbl>
          </button>
        )}
      </div>
      {token.kind === 'npc' && (retinue || token.route.length > 0 || token.note) && (
        <div className="mt-0.5 pl-6 text-[0.6875rem] text-ink-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {token.note && <span className="text-ink-300 truncate max-w-full">{token.note}</span>}
          {token.route.length > 0 && (
            <span className="text-brass-300">
              En route · {token.route.length} hex{token.route.length === 1 ? '' : 'es'} left
              {routeMinutes > 0 && ` · ≈ ${routeDays >= 1 ? `${routeDays.toFixed(1)} days` : formatDuration(routeMinutes)}`}
            </span>
          )}
          {retinue && (
            <label className="inline-flex items-center gap-1 whitespace-nowrap">
              <span>Speed</span>
              <input
                type="number"
                min={0.1}
                max={500}
                step={0.5}
                className="w-12 bg-ink-900 border border-ink-600 rounded px-1 py-0 text-[0.6875rem] text-ink-100"
                value={token.mph ?? ''}
                placeholder={String(retinue.mph ?? DEFAULT_NPC_MPH)}
                title="Travel speed in miles per hour (blank = the retinue's default)"
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  if (v === null || (Number.isFinite(v) && v > 0)) {
                    send({ kind: 'token.update', tokenId: token.id, patch: { mph: v } });
                  }
                }}
              />
              <span>mph</span>
            </label>
          )}
          {retinue && (
            <button
              className="cursor-pointer hover:text-brass-300"
              title={token.visibleThroughFog ? 'Shown to players wherever it stands — click to limit to visible hexes' : 'Shown only on hexes the party can see — click to show anywhere'}
              onClick={() =>
                send({ kind: 'token.update', tokenId: token.id, patch: { visibleThroughFog: !token.visibleThroughFog } })
              }
            >
              {token.visibleThroughFog ? 'Seen anywhere' : 'Seen in sight only'}
            </button>
          )}
        </div>
      )}
      {drafting && draft && <RouteDraftBar token={token} waypoints={draft.waypoints} perHex={perHex} />}
    </div>
  );
}

/**
 * Plan an NPC's journey: arm route drafting (map clicks add waypoints), or
 * cancel a journey already under way.
 */
function RouteButton({ token, drafting }: { token: Token; drafting: boolean }) {
  const setUi = useUi((s) => s.set);
  if (drafting) return null;
  return (
    <>
      <button
        className="shrink-0 px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-brass-300"
        title={`Plan a route for ${token.label || 'this token'}: click waypoints on the map, then Done. It travels as the campaign clock runs.`}
        onClick={(e) => {
          e.stopPropagation();
          setUi('movingTokenId', null);
          setUi('routeDraft', { tokenId: token.id, waypoints: [] });
          useSession.getState().pushToast({
            kind: 'info',
            title: `Route ${token.label || 'token'}`,
            text: 'Click the map to add waypoints in order, then press Done in the Tokens panel. Esc cancels.',
          });
        }}
      >
        🛤️<Lbl>Route</Lbl>
      </button>
      {token.route.length > 0 && (
        <button
          className="shrink-0 px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-ember-500"
          title="Stop here: cancel the planned route"
          onClick={(e) => {
            e.stopPropagation();
            send({ kind: 'token.route', tokenId: token.id, waypoints: [] });
          }}
        >
          ⏹<Lbl>Halt</Lbl>
        </button>
      )}
    </>
  );
}

function RouteDraftBar({ token, waypoints, perHex }: { token: Token; waypoints: { q: number; r: number }[]; perHex: number }) {
  const setUi = useUi((s) => s.set);
  // Straight-line estimate; the server routes each leg through explored ground
  // when the map allows, so the real walk may be a little longer.
  let hexes = 0;
  let cur = { q: token.q, r: token.r };
  for (const wp of waypoints) {
    hexes += hexDistance(cur, wp);
    cur = wp;
  }
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs">
      <span className="text-brass-300 flex-1">
        {waypoints.length === 0
          ? 'Click the map to add waypoints…'
          : `${waypoints.length} waypoint${waypoints.length === 1 ? '' : 's'} · ≥ ${hexes} hex${hexes === 1 ? '' : 'es'}${perHex > 0 ? ` · ≈ ${formatDuration(hexes * perHex)} on the road` : ''}`}
      </span>
      {waypoints.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setUi('routeDraft', { tokenId: token.id, waypoints: waypoints.slice(0, -1) })}
          title="Remove the last waypoint"
        >
          Undo
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setUi('routeDraft', null)}>
        Cancel
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={waypoints.length === 0}
        onClick={() => {
          send({ kind: 'token.route', tokenId: token.id, waypoints });
          setUi('routeDraft', null);
        }}
      >
        Done
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retinues: the roster of faction cells and their colours/crests
// ---------------------------------------------------------------------------

function RetinueManager({ retinues }: { retinues: Retinue[] }) {
  const [open, setOpen] = useState(false);
  const save = (list: Retinue[]) => send({ kind: 'campaign.update', settings: { retinues: list } });
  return (
    <Section title="Retinues">
      <p className="text-xs text-ink-400 mb-2">
        A retinue is a faction cell whose members are NPC tokens that share a colour, a crest and a
        travel speed. Give a member a route and it travels as the campaign clock runs — every party
        move is a tick.
      </p>
      {retinues.length === 0 && !open && <EmptyNote>No retinues yet.</EmptyNote>}
      <div className="space-y-1.5">
        {retinues.map((rn) => (
          <RetinueRow
            key={rn.id}
            retinue={rn}
            onChange={(patch) => save(retinues.map((x) => (x.id === rn.id ? { ...x, ...patch } : x)))}
            onRemove={() => save(retinues.filter((x) => x.id !== rn.id))}
          />
        ))}
      </div>
      {open ? (
        <RetinueForm
          existing={retinues}
          onCancel={() => setOpen(false)}
          onSave={(rn) => {
            save([...retinues, rn]);
            setOpen(false);
          }}
        />
      ) : (
        <Button size="sm" className="mt-2" onClick={() => setOpen(true)}>
          + Add retinue
        </Button>
      )}
    </Section>
  );
}

function RetinueRow({
  retinue,
  onChange,
  onRemove,
}: {
  retinue: Retinue;
  onChange: (patch: Partial<Retinue>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="bg-ink-850 border border-ink-700 rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Crest retinue={retinue} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-100 truncate">{retinue.name}</p>
          <p className="text-[0.6875rem] text-ink-400 truncate">
            {[retinue.holder, retinue.faction].filter(Boolean).join(' · ')}
            {` · ${retinue.mph ?? DEFAULT_NPC_MPH} mph`}
          </p>
        </div>
        <input
          type="color"
          className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
          value={retinue.color}
          title="Retinue colour (new members take it)"
          onChange={(e) => onChange({ color: e.target.value })}
        />
        <button className="text-xs text-ink-400 hover:text-brass-300 cursor-pointer" onClick={() => setEditing((v) => !v)}>
          ✎<Lbl>Edit</Lbl>
        </button>
        <button className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer" onClick={onRemove} title="Remove the retinue (its tokens stay, as plain NPCs)">
          ✕
        </button>
      </div>
      {editing && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Name">
            <Input value={retinue.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value || retinue.name })} />
          </Field>
          <Field label="Held by">
            <Input value={retinue.holder} maxLength={60} onChange={(e) => onChange({ holder: e.target.value })} />
          </Field>
          <Field label="Faction">
            <Input value={retinue.faction} maxLength={60} onChange={(e) => onChange({ faction: e.target.value })} />
          </Field>
          <Field label="Speed (mph)">
            <Input
              type="number"
              min={0.1}
              max={500}
              step={0.5}
              value={retinue.mph ?? ''}
              placeholder={String(DEFAULT_NPC_MPH)}
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                if (v === null || (Number.isFinite(v) && v > 0)) onChange({ mph: v });
              }}
            />
          </Field>
          <Field label="Crest" className="col-span-2">
            <Select value={retinue.icon} onChange={(e) => onChange({ icon: e.target.value })}>
              <option value="">None — use the glyph</option>
              {CREST_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Glyph (fallback)">
            <Input value={retinue.glyph} maxLength={8} onChange={(e) => onChange({ glyph: e.target.value })} />
          </Field>
          <Field label="Wiki page">
            <Input value={retinue.wikiPage} maxLength={300} onChange={(e) => onChange({ wikiPage: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function RetinueForm({
  existing,
  onCancel,
  onSave,
}: {
  existing: Retinue[];
  onCancel: () => void;
  onSave: (r: Retinue) => void;
}) {
  const [name, setName] = useState('');
  const [holder, setHolder] = useState('');
  const [faction, setFaction] = useState('');
  const [color, setColor] = useState('#b08d57');
  const [icon, setIcon] = useState('crests/eagle');
  const [mph, setMph] = useState('3');
  const canSave = name.trim().length > 0;
  const submit = () => {
    if (!canSave) return;
    let id = slugify(name) || 'retinue';
    while (existing.some((r) => r.id === id)) id = `${id}-${Math.floor(Math.random() * 1000)}`;
    const speed = Number(mph);
    onSave({
      id,
      name: name.trim(),
      holder: holder.trim(),
      faction: faction.trim(),
      color,
      icon,
      glyph: '',
      mph: Number.isFinite(speed) && speed > 0 ? speed : null,
      wikiPage: name.trim(),
    });
  };
  return (
    <div className="mt-2 bg-ink-850 border border-brass-500/50 rounded-md p-2 grid grid-cols-2 gap-2">
      <Field label="Name" className="col-span-2">
        <Input value={name} maxLength={60} placeholder="The Anvil" onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Held by">
        <Input value={holder} maxLength={60} placeholder="Xanphina" onChange={(e) => setHolder(e.target.value)} />
      </Field>
      <Field label="Faction">
        <Input value={faction} maxLength={60} placeholder="Order of the Gauntlet" onChange={(e) => setFaction(e.target.value)} />
      </Field>
      <Field label="Colour">
        <input type="color" className="w-full h-8 rounded cursor-pointer bg-transparent border border-ink-600" value={color} onChange={(e) => setColor(e.target.value)} />
      </Field>
      <Field label="Speed (mph)">
        <Input type="number" min={0.1} max={500} step={0.5} value={mph} onChange={(e) => setMph(e.target.value)} />
      </Field>
      <Field label="Crest" className="col-span-2">
        <div className="flex items-center gap-2">
          <Crest retinue={{ color, icon, glyph: '' }} size="md" />
          <Select value={icon} onChange={(e) => setIcon(e.target.value)}>
            <option value="">None</option>
            {CREST_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <div className="col-span-2 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!canSave} onClick={submit}>
          Add retinue
        </Button>
      </div>
    </div>
  );
}
