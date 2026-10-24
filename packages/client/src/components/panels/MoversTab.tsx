import React, { useState } from 'react';
import type { MoverSummary, Retinue } from '@hexcrawl/shared';
import { GROUP_KIND_LABEL, PACE_LABEL, formatDuration, journeyMph, minutesPerHex, resolveTravelMode } from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Section, cx, Lbl } from '../../ui/kit.js';
import { Crest, RouteDraftBar, TravelPicker } from './TokensTab.js';

/**
 * Movers (DM only): every NPC token on every map — retinue members, armies,
 * bands, roaming beasts — with where it stands, where it is going and how
 * long that takes. Build → Tokens is where movers are created; this is where
 * they are run. Rows for the viewed map act directly; a row on another map
 * switches the view first.
 */
export function MoversTab() {
  const state = useSession((s) => s.state);
  const focusToken = useUi((s) => s.focusToken);
  const draft = useUi((s) => s.routeDraft);
  const [filter, setFilter] = useState<'all' | 'moving' | 'posted'>('all');
  if (!state) return null;
  const movers = state.movers.filter((m) =>
    filter === 'all' ? true : filter === 'moving' ? m.routeLeft > 0 : m.routeLeft === 0,
  );
  const groups = state.campaign.settings.retinues;
  const activeMapId = state.campaign.activeMapId;
  const custom = state.campaign.settings.customTravelModes;
  const hoursPerDay = state.campaign.settings.npcTravelHoursPerDay;
  const moving = state.movers.filter((m) => m.routeLeft > 0).length;

  const byGroup: { group: Retinue | null; rows: MoverSummary[] }[] = [
    ...groups.map((g) => ({ group: g, rows: movers.filter((m) => m.retinueId === g.id) })),
    { group: null, rows: movers.filter((m) => !m.retinueId || !groups.some((g) => g.id === m.retinueId)) },
  ].filter((b) => b.rows.length > 0);

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 text-xs">
        {(['all', 'moving', 'posted'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cx(
              'px-2 py-0.5 rounded border cursor-pointer capitalize',
              filter === f
                ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                : 'border-ink-700 hover:bg-ink-700 text-ink-300',
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-ink-400">
          {state.movers.length} mover{state.movers.length === 1 ? '' : 's'} · {moving} on the road
        </span>
      </div>
      {state.movers.length === 0 && (
        <EmptyNote>
          No movers yet. Create NPC tokens in Build → Tokens; give one a route and it travels as the
          campaign clock runs.
        </EmptyNote>
      )}
      {byGroup.map(({ group, rows }) => (
        <Section key={group?.id ?? '__loose'} title={group ? group.name : 'Ungrouped'}>
          {group && (
            <p className="text-[0.6875rem] text-ink-400 mb-1.5 flex items-center gap-2">
              <Crest retinue={group} size="sm" />
              {[GROUP_KIND_LABEL[group.kind], group.holder, group.faction].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="space-y-1.5">
            {rows.map((m) => (
              <MoverRow
                key={m.tokenId}
                mover={m}
                group={group}
                onActiveMap={m.mapId === activeMapId}
                drafting={draft?.tokenId === m.tokenId}
                custom={custom}
                hoursPerDay={hoursPerDay}
                focus={() => {
                  if (m.mapId !== activeMapId) send({ kind: 'view.map', mapId: m.mapId });
                  focusToken({ id: m.tokenId, q: m.q, r: m.r });
                }}
              />
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

function MoverRow({
  mover: m,
  group,
  onActiveMap,
  drafting,
  custom,
  hoursPerDay,
  focus,
}: {
  mover: MoverSummary;
  group: Retinue | null;
  onActiveMap: boolean;
  drafting: boolean;
  custom: Parameters<typeof TravelPicker>[0]['custom'];
  hoursPerDay: number;
  focus: () => void;
}) {
  const setUi = useUi((s) => s.set);
  const selected = useUi((s) => s.selectedTokenId === m.tokenId);
  const [note, setNote] = useState<string | null>(null);
  const [cadence, setCadence] = useState<string | null>(null);
  const days = m.etaMinutes !== null ? m.etaMinutes / (hoursPerDay * 60) : 0;
  const eta =
    m.etaMinutes === null ? null : days >= 1 ? `${days.toFixed(1)} days` : formatDuration(m.etaMinutes);
  // Which mode/pace the row's own values resolve to, for the picker's inherit label.
  const inherit = group
    ? `${resolveTravelMode(group.travelMode ?? 'foot', custom).label}, ${PACE_LABEL[group.pace ?? 'normal']} (group)`
    : 'On foot, Normal';
  const token = useSession((s) => s.state?.mapState?.tokens.find((t) => t.id === m.tokenId) ?? null);
  const map = useSession((s) => activeMap(s.state));
  const draft = useUi((s) => s.routeDraft);

  return (
    <div
      className={cx(
        'bg-ink-850 border rounded-md px-2 py-1.5',
        drafting ? 'border-brass-500' : selected ? 'border-brass-500/60 bg-brass-500/5' : 'border-ink-700',
      )}
    >
      <div className="flex items-center gap-2">
        <Crest retinue={{ color: m.color, icon: m.icon, glyph: m.glyph || group?.glyph || '' }} size="sm" />
        <button
          className="text-sm text-ink-100 truncate flex-1 text-left cursor-pointer hover:text-brass-300"
          onClick={focus}
          title={onActiveMap ? 'Select and fly the map to it' : `On ${m.mapName}: switch map and fly to it`}
        >
          {m.label || '(unnamed)'}
          <span className="text-ink-400 text-xs ml-1.5">
            {m.where ?? `${m.q},${m.r}`}
            {!onActiveMap && ` · ${m.mapName}`}
          </span>
        </button>
        {!m.playerVisible && (
          <span className="text-[0.6875rem] text-ember-500" title="Hidden from players">
            hidden
          </span>
        )}
      </div>
      <div className="mt-0.5 pl-7 text-[0.6875rem] text-ink-400 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {m.routeLeft > 0 ? (
          <span className="text-brass-300">
            {m.loop ? '↻ Patrol' : 'En route'} · {m.routeLeft} hex{m.routeLeft === 1 ? '' : 'es'} left
            {eta ? ` · ≈ ${eta}` : ''}
          </span>
        ) : (
          <span>Posted</span>
        )}
        <span>
          {resolveTravelMode(m.travelMode, custom).label}, {PACE_LABEL[m.pace]} · {m.mph.toFixed(1).replace(/\.0$/, '')} mph
        </span>
        {m.encounterEveryMiles && <span>🎲 every {m.encounterEveryMiles} mi</span>}
      </div>
      <div className="mt-0.5 pl-7 flex flex-wrap items-center gap-x-1 gap-y-0.5">
        {!drafting && (
          <button
            className="px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-brass-300"
            title={`Plan a route for ${m.label}: click waypoints on the map, then Done in Build → Tokens or here.`}
            onClick={() => {
              if (!onActiveMap) send({ kind: 'view.map', mapId: m.mapId });
              setUi('movingTokenId', null);
              setUi('routeDraft', { tokenId: m.tokenId, waypoints: [] });
              useSession.getState().pushToast({
                kind: 'info',
                title: `Route ${m.label}`,
                text: 'Click the map to add waypoints in order, then press Done. Esc cancels.',
              });
            }}
          >
            🛤️<Lbl>Route</Lbl>
          </button>
        )}
        {m.routeLeft > 0 && (
          <button
            className="px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-ember-500"
            title="Stop here: cancel the planned route"
            onClick={() => send({ kind: 'token.route', tokenId: m.tokenId, waypoints: [] })}
          >
            ⏹<Lbl>Halt</Lbl>
          </button>
        )}
        <button
          className={cx('px-2 py-1 mr-1.5 rounded text-sm cursor-pointer', m.loop ? 'text-brass-300' : 'text-ink-400 hover:text-brass-300')}
          title={m.loop ? 'Patrolling: routes through its waypoints again at the end. Click to stop after this pass.' : 'Patrol: route through the waypoints again at the end'}
          onClick={() => send({ kind: 'token.update', tokenId: m.tokenId, patch: { loop: !m.loop } })}
        >
          ↻<Lbl>{m.loop ? 'Looping' : 'Loop'}</Lbl>
        </button>
        <button
          className="px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-brass-300"
          title={m.playerVisible ? 'Players see this — click to hide' : 'Hidden — click to reveal'}
          onClick={() => send({ kind: 'token.update', tokenId: m.tokenId, patch: { playerVisible: !m.playerVisible } })}
        >
          {m.playerVisible ? '👁️' : '🚫'}<Lbl>{m.playerVisible ? 'Shown' : 'Hidden'}</Lbl>
        </button>
      </div>
      <div className="mt-0.5 pl-7 text-[0.6875rem] text-ink-400 flex flex-wrap items-center gap-x-3 gap-y-1">
        {token ? (
          <TravelPicker
            mode={token.travelMode}
            pace={token.pace}
            inheritLabel={inherit}
            custom={custom}
            onChange={(patch) => send({ kind: 'token.update', tokenId: m.tokenId, patch })}
          />
        ) : (
          <span className="italic">Mode and pace: open its map to change</span>
        )}
        <label className="inline-flex items-center gap-1" title="Roll on the terrain's encounter table every this many miles of travel (blank = never)">
          <span>🎲 every</span>
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            className="w-14 bg-ink-900 border border-ink-600 rounded px-1 py-0 text-[0.6875rem] text-ink-100"
            value={cadence ?? (m.encounterEveryMiles ?? '')}
            placeholder="never"
            onChange={(e) => setCadence(e.target.value)}
            onBlur={() => {
              if (cadence === null) return;
              const v = cadence === '' ? null : Number(cadence);
              if (v === null || (Number.isFinite(v) && v > 0)) {
                send({ kind: 'token.update', tokenId: m.tokenId, patch: { encounterEveryMiles: v } });
              }
              setCadence(null);
            }}
          />
          <span>mi</span>
        </label>
      </div>
      <div className="mt-0.5 pl-7">
        <input
          className="w-full bg-transparent border-b border-transparent focus:border-ink-600 px-0 py-0 text-[0.6875rem] text-ink-300 placeholder:text-ink-500"
          placeholder="Posting / orders…"
          maxLength={300}
          value={note ?? m.note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== null && note !== m.note) {
              send({ kind: 'token.update', tokenId: m.tokenId, patch: { note } });
            }
            setNote(null);
          }}
        />
      </div>
      {drafting && token && draft && (
        <RouteDraftBar
          token={token}
          waypoints={draft.waypoints}
          perHex={map ? minutesPerHex(map.milesPerHex, journeyMph(resolveTravelMode(m.travelMode, custom), m.pace)) : 0}
        />
      )}
      {drafting && !token && (
        <div className="mt-1 text-[0.6875rem] text-brass-300">Switching to {m.mapName}…</div>
      )}
    </div>
  );
}
