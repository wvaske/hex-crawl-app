import React from 'react';
import {
  SUPER_SCALE,
  TRAVEL_PACES,
  formatCalendarDate,
  formatTimeOfDay,
  isNight,
  minutesPerHex,
  minutesUntilSunrise,
  resolveTravelMode,
  travelModes,
} from '@hexcrawl/shared';
import type { TravelPace } from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, Input, Select, cx } from '../ui/kit.js';
import { useIsMobile } from '../ui/responsive.js';

/**
 * Secondary top-bar controls. On a phone the bar has room for the campaign,
 * the clock and the one control a player reaches for mid-session ("go to me"),
 * so everything else folds into a ⋯ menu instead of being dropped — the same
 * children, in a popover.
 */
function Overflow({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!mobile) return <>{children}</>;
  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-label="More controls">
        ⋯
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-52 rounded-md border border-ink-700 bg-ink-900 p-1.5 shadow-lg z-40 flex flex-col items-stretch gap-1"
          onClick={() => setOpen(false)}
        >
          {extra}
          {children}
        </div>
      )}
    </div>
  );
}

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

/**
 * The campaign clock. Everyone sees the readout ("Day 3 · 6:40 PM" plus a
 * sun/moon); the DM gets travel mode, pace and time-advance controls in a
 * popover, since the top bar has no room for them inline.
 */
function TimeControl() {
  const time = useSession((s) => s.state?.campaign.time);
  const settings = useSession((s) => s.state?.campaign.settings);
  const role = useSession((s) => s.role);
  const map = activeMap(useSession((s) => s.state));
  const [open, setOpen] = React.useState(false);
  const [custom, setCustom] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!time) return null;
  const night = isNight(time.minutes, settings);
  const modes = travelModes(settings?.customTravelModes ?? []);
  const mode = resolveTravelMode(time.travelMode, settings?.customTravelModes ?? []);
  const perHex = map ? Math.round(minutesPerHex(map.milesPerHex, mode, time.pace)) : null;

  const advance = (minutes: number, note?: string) => {
    if (minutes > 0) send({ kind: 'time.advance', minutes, note });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => role === 'dm' && setOpen((o) => !o)}
        className={cx(
          'flex items-center gap-1.5 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-ink-200',
          role === 'dm' ? 'cursor-pointer hover:bg-ink-700' : 'cursor-default',
        )}
        title={
          role === 'dm'
            ? 'Campaign clock — travel mode, pace, and time advance'
            : 'Campaign clock'
        }
      >
        <span>{night ? '🌙' : '☀️'}</span>
        <span className="whitespace-nowrap">
          {formatCalendarDate(time.minutes, settings?.calendar)} · {formatTimeOfDay(time.minutes)}
        </span>
      </button>

      {open && role === 'dm' && (
        <div className="absolute left-0 top-full mt-1 w-60 rounded-md border border-ink-700 bg-ink-900 p-2.5 shadow-lg space-y-2 z-40">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-ink-400 mb-1">
              Travel mode
            </span>
            <Select
              value={time.travelMode}
              onChange={(e) => send({ kind: 'time.config', travelMode: e.target.value })}
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.mph} mph)
                </option>
              ))}
            </Select>
          </div>

          <div>
            <span className="block text-[10px] uppercase tracking-wider text-ink-400 mb-1">
              Pace
            </span>
            <div className="flex items-center rounded-md border border-ink-600 overflow-hidden text-[11px]">
              {TRAVEL_PACES.map((p: TravelPace) => (
                <button
                  key={p}
                  onClick={() => send({ kind: 'time.config', pace: p })}
                  className={cx(
                    'flex-1 px-2 py-1 capitalize cursor-pointer transition-colors',
                    time.pace === p
                      ? 'bg-brass-500/25 text-brass-300'
                      : 'text-ink-400 hover:bg-ink-700',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {perHex !== null && (
            <p className="text-[11px] text-ink-400">
              {perHex} min per hex at {map!.milesPerHex} mi/hex
            </p>
          )}

          <div>
            <span className="block text-[10px] uppercase tracking-wider text-ink-400 mb-1">
              Advance time
            </span>
            <div className="flex gap-1">
              {(
                [
                  ['+1h', 60],
                  ['+8h', 8 * 60],
                  ['+1 day', 24 * 60],
                ] as const
              ).map(([label, minutes]) => (
                <Button
                  key={label}
                  variant="ghost"
                  size="sm"
                  className="flex-1 !px-1 border border-ink-600"
                  onClick={() => advance(minutes)}
                  title={label === '+8h' ? 'Long rest' : `Advance ${label}`}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 !px-1 border border-ink-600"
                onClick={() => advance(60, 'short rest')}
                title="Short rest — advance the clock 1 hour"
              >
                Short rest (+1h)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 !px-1 border border-ink-600"
                onClick={() => advance(minutesUntilSunrise(time.minutes, settings), 'camp')}
                title="Camp — advance the clock to the next sunrise"
              >
                Camp until dawn
              </Button>
            </div>
            <form
              className="flex gap-1 mt-1"
              onSubmit={(e) => {
                e.preventDefault();
                const minutes = Math.floor(Number(custom));
                if (Number.isFinite(minutes) && minutes > 0) advance(minutes);
                setCustom('');
              }}
            >
              <Input
                type="number"
                min={1}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="minutes"
                className="!py-1 text-[11px]"
              />
              <Button type="submit" variant="ghost" size="sm" className="border border-ink-600">
                Add
              </Button>
            </form>
          </div>

          <div>
            <span className="block text-[10px] uppercase tracking-wider text-ink-400 mb-1">
              Weather
            </span>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] text-ink-200 truncate">
                {time.weather ? `${time.weather.icon} ${time.weather.text}` : 'Not yet rolled'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="!px-1 border border-ink-600"
                onClick={() => send({ kind: 'weather.roll' })}
                title="Roll a fresh sky from the campaign weather table (it rerolls on its own each new day)"
              >
                Reroll
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One row of the ⋯ menu: the same control the desktop bar shows inline, with
 * the label its `title` tooltip used to carry — a phone has no hover, and an
 * unlabelled glyph in a menu is a guess (#75). Renders nothing extra on
 * desktop, where the control goes straight back into the bar.
 */
function MenuRow({ label, children }: { label: string; children: React.ReactNode }) {
  const mobile = useIsMobile();
  if (!mobile) return <>{children}</>;
  return (
    <div className="flex items-center gap-2">
      {children}
      <span className="text-xs text-ink-300">{label}</span>
    </div>
  );
}

/**
 * Today's weather, next to the clock. Everyone sees it — the sky is not a DM
 * secret — and the DM rerolls it from the clock popover.
 */
function WeatherReadout() {
  const weather = useSession((s) => s.state?.campaign.time.weather);
  if (!weather) return null;
  return (
    <span
      className="hidden md:flex items-center gap-1 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-ink-200 max-w-40"
      title={`Weather: ${weather.text}`}
    >
      <span>{weather.icon}</span>
      <span className="truncate">{weather.text}</span>
    </span>
  );
}

/** Toggle the map's day/night tint overlay — cosmetic, both roles. */
function DayNightToggle() {
  const enabled = useUi((s) => s.dayNightTint);
  const setUi = useUi((s) => s.set);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setUi('dayNightTint', !enabled)}
      className={enabled ? '!text-brass-300' : ''}
      title={
        enabled
          ? 'Day/night map tint is on — the map dims at night and warms at dusk/dawn. Click to turn off.'
          : 'Day/night map tint is off — click to tint the map for the current time of day'
      }
    >
      🌗
    </Button>
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
  const map = activeMap(state);
  const mobile = useIsMobile();

  const online = state?.seats.filter((s) => s.online) ?? [];

  // On a phone the bar has room for the campaign, the clock and "go to me";
  // the map picker moves into the ⋯ menu rather than squeezing the title to
  // two letters. Same element either way — just a different home.
  const mapPicker = state && state.maps.length > 0 && (
    <span className="flex items-center gap-0.5 min-w-0">
      <Select
        className="!w-auto max-w-28 md:max-w-44 shrink"
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
      {role === 'dm' && (
        <Button
          variant="ghost"
          size="sm"
          className="!px-1.5 shrink-0"
          onClick={() => useUi.getState().set('mapManagerOpen', true)}
          title="Manage maps — thumbnails, per-map settings, campaign defaults"
        >
          🗺️
        </Button>
      )}
    </span>
  );

  return (
    <header className="h-12 shrink-0 bg-ink-900 border-b border-ink-700 flex items-center gap-1.5 md:gap-3 px-2 md:px-3 z-30">
      <span className="text-brass-500 text-xl leading-none shrink-0">⬡</span>
      <div className="min-w-0 flex-1">
        <h1 className="text-xs md:text-sm font-semibold text-ink-100 truncate leading-tight">
          {state?.campaign.name ?? '…'}
        </h1>
        {/* The map picker beside this already names the map — on a phone the
            subline is redundant, and the width is worth more to the title. */}
        {map && (
          <p className="hidden md:block text-[11px] text-ink-400 leading-tight truncate">
            {map.name} · {map.milesPerHex} mi/hex
          </p>
        )}
      </div>

      {!mobile && mapPicker}

      {map && <ScaleControl baseMiles={map.milesPerHex} />}
      <TimeControl />
      <WeatherReadout />

      <div className="hidden md:block flex-1" />

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
        role="status"
        aria-label={status === 'open' ? 'Connected' : `Connection ${status}`}
      />

      {role === 'player' && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onGoToMe}
          title="Go to me — center the view on your token"
          aria-label="Go to me — center the view on your token"
        >
          🎯 Me
        </Button>
      )}
      {/*
        No panel show/hide button here any more (#61): the pop-out headings
        live on the rail down the right edge, and clicking the open one closes
        it — one affordance instead of two competing ones.
      */}
      <Overflow extra={mapPicker}>
        <MenuRow label="Day/night tint">
          <DayNightToggle />
        </MenuRow>
        {role === 'dm' && (
          <MenuRow label="Undo last change">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => send({ kind: 'undo' })}
              title="Undo the last change (fog, terrain, moves, deletes) — or press Ctrl/Cmd+Z"
            >
              ↶
            </Button>
          </MenuRow>
        )}
        {role === 'dm' && (
          <MenuRow label="Dim unexplored">
            <DimToggle />
          </MenuRow>
        )}
        {role === 'dm' && (
          <MenuRow label="Prep mode (pause sync)">
            <PauseSyncToggle />
          </MenuRow>
        )}
        <MenuRow label="Re-center map">
          <Button variant="ghost" size="sm" onClick={onRecenter} title="Re-center map">
            ⌖
          </Button>
        </MenuRow>
      </Overflow>
    </header>
  );
}
