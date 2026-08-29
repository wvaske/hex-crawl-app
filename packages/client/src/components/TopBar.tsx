import React from 'react';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, Select, cx } from '../ui/kit.js';

export function TopBar({
  campaignId: _campaignId,
  onRecenter,
}: {
  campaignId: string;
  onRecenter: () => void;
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

      {role === 'dm' && state && state.maps.length > 0 && (
        <Select
          className="!w-auto max-w-44"
          value={state.campaign.activeMapId ?? ''}
          onChange={(e) => send({ kind: 'map.setActive', mapId: e.target.value })}
          title="Active map (what everyone sees)"
        >
          {state.maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      )}

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
