import React from 'react';
import { SUPER_SCALE } from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, Select, cx } from '../ui/kit.js';

function ScaleControl({ baseMiles }: { baseMiles: number }) {
  const scaleLock = useUi((s) => s.scaleLock);
  const currentScale = useUi((s) => s.currentScale);
  const setUi = useUi((s) => s.set);
  const labels = [0, 1, 2].map((l) => `${Math.round(baseMiles * Math.pow(SUPER_SCALE, l))}mi`);
  return (
    <div
      className="hidden md:flex items-center rounded-md border border-ink-600 overflow-hidden text-[11px]"
      title="Hex scale: Auto follows zoom; lock a scale for travel or searching"
    >
      {(['auto', 0, 1, 2] as const).map((opt) => {
        const active = scaleLock === opt;
        const isCurrent = opt !== 'auto' && currentScale === opt;
        return (
          <button
            key={String(opt)}
            onClick={() => setUi('scaleLock', opt)}
            className={cx(
              'px-2 py-1 cursor-pointer transition-colors',
              active
                ? 'bg-brass-500/25 text-brass-300'
                : isCurrent && scaleLock === 'auto'
                  ? 'bg-ink-700 text-ink-100'
                  : 'text-ink-400 hover:bg-ink-700',
            )}
          >
            {opt === 'auto' ? 'Auto' : labels[opt]}
          </button>
        );
      })}
    </div>
  );
}

function DimToggle() {
  const dim = useUi((s) => s.dimUnexplored);
  const setUi = useUi((s) => s.set);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setUi('dimUnexplored', !dim)}
      className={dim ? '!text-brass-300' : ''}
      title={
        dim
          ? "Dimming what players can't see — full-strength pins are the party's knowledge. Click to disable."
          : "See what the players see: dim undiscovered locations and hidden markers"
      }
    >
      {dim ? '◐' : '○'}
    </Button>
  );
}

/** DM prep mode: pause/resume live map updates for players. */
function PauseSyncToggle() {
  const paused = useSession((s) => s.state?.campaign.settings.pausePlayerMapSync ?? false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => send({ kind: 'campaign.update', settings: { pausePlayerMapSync: !paused } })}
      className={paused ? '!text-ember-500' : ''}
      title={
        paused
          ? 'Prep mode: players see the map as it was when you paused — click to push your edits live'
          : 'Players see map edits live — click to pause updates while you prep'
      }
    >
      {paused ? '▶' : '⏸'}
    </Button>
  );
}

export function TopBar({
  campaignId: _campaignId,
  onRecenter,
  onGoToMe,
}: {
  campaignId: string;
  onRecenter: () => void;
  onGoToMe: () => void;
}) {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const status = useSession((s) => s.status);
  const panelOpen = useUi((s) => s.panelOpen);
  const setUi = useUi((s) => s.set);
  const map = activeMap(state);

  const online = state?.seats.filter((s) => s.online) ?? [];

  return (
    <header className="h-12 shrink-0 bg-ink-900 border-b border-ink-700 flex items-center gap-3 px-3 z-30">
      <span className="text-brass-500 text-xl leading-none">⬡</span>
      <div className="min-w-0">
        <h1 className="text-sm font-semibold text-ink-100 truncate leading-tight">
          {state?.campaign.name ?? '…'}
        </h1>
        {map && (
          <p className="text-[11px] text-ink-400 leading-tight truncate">
            {map.name} · {map.milesPerHex} mi/hex
          </p>
        )}
      </div>

      {state && state.maps.length > 0 && (
        <Select
          className="!w-auto max-w-44"
          value={state.campaign.activeMapId ?? ''}
          onChange={(e) =>
            role === 'dm'
              ? send({ kind: 'map.setActive', mapId: e.target.value })
              : send({ kind: 'view.map', mapId: e.target.value })
          }
          title={role === 'dm' ? 'Active map (the party default)' : 'Browse another map'}
        >
          {state.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      )}

      {map && <ScaleControl baseMiles={map.milesPerHex} />}

      <div className="flex-1" />

      <div className="hidden sm:flex items-center -space-x-1.5" title={online.map((s) => s.name).join(', ')}>
        {online.slice(0, 6).map((seat) => {
          const character = state?.characters.find((c) => c.id === seat.characterId);
          return (
            <span
              key={seat.id}
              className="w-6 h-6 rounded-full border-2 border-ink-900 flex items-center justify-center text-[10px] font-bold text-ink-950"
              style={{ background: character?.color ?? (seat.role === 'dm' ? '#c9a24b' : '#7b86a5') }}
              title={`${seat.name}${seat.role === 'dm' ? ' (DM)' : character ? ` — ${character.name}` : ''}`}
            >
              {seat.role === 'dm' ? '★' : (character?.name ?? seat.name).slice(0, 1).toUpperCase()}
            </span>
          );
        })}
      </div>

      <span
        className={cx(
          'w-2 h-2 rounded-full',
          status === 'open' ? 'bg-moss-500' : status === 'connecting' ? 'bg-brass-500 animate-pulse' : 'bg-ember-500',
        )}
        title={status === 'open' ? 'Connected' : status}
      />

      {role === 'dm' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => send({ kind: 'undo' })}
          title="Undo the last change (fog, terrain, moves, deletes) — or press Ctrl/Cmd+Z"
        >
          ↶
        </Button>
      )}
      {role === 'dm' && <DimToggle />}
      {role === 'dm' && <PauseSyncToggle />}
      {role === 'player' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onGoToMe}
          title="Go to me — center the view on your token"
        >
          🎯 Me
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onRecenter} title="Re-center map">
        ⌖
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setUi('panelOpen', !panelOpen)}
        title={panelOpen ? 'Hide panel' : 'Show panel'}
      >
        {panelOpen ? '⇥' : '⇤'}
      </Button>
    </header>
  );
}
