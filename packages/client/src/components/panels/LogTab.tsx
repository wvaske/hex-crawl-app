import React, { useEffect, useRef, useState } from 'react';
import {
  computeRecap,
  computeSessions,
  formatClock,
  formatDuration,
  type LogEntry,
  type Recap,
  type SessionBoundary,
} from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Input, cx } from '../../ui/kit.js';

const KIND_META: Record<string, { icon: string; label: string }> = {
  discovery: { icon: '👁️', label: 'Discovery' },
  check: { icon: '🎯', label: 'Check' },
  encounter: { icon: '🎲', label: 'Encounter' },
  narration: { icon: '📜', label: 'Narration' },
  share: { icon: '🤝', label: 'Shared' },
  time: { icon: '🕐', label: 'Time' },
  session: { icon: '🎬', label: 'Session' },
};

const FILTERS = [
  'all',
  'discovery',
  'check',
  'encounter',
  'narration',
  'share',
  'time',
  'session',
] as const;

export function LogTab() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [mode, setMode] = useState<'log' | 'recaps'>('log');
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = state?.log ?? [];
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);

  useEffect(() => {
    if (mode === 'log') scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length, mode]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 mb-2 flex-wrap items-center">
        {role === 'dm' &&
          FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setMode('log');
              }}
              className={cx(
                'px-2 py-0.5 rounded-full text-[11px] capitalize cursor-pointer border',
                mode === 'log' && filter === f
                  ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                  : 'border-ink-700 text-ink-300 hover:bg-ink-700',
              )}
            >
              {f}
            </button>
          ))}
        <button
          onClick={() => setMode(mode === 'recaps' ? 'log' : 'recaps')}
          className={cx(
            'px-2 py-0.5 rounded-full text-[11px] cursor-pointer border ml-auto',
            mode === 'recaps'
              ? 'border-brass-500 bg-brass-500/15 text-brass-300'
              : 'border-ink-700 text-ink-300 hover:bg-ink-700',
          )}
        >
          🎬 Recaps
        </button>
      </div>

      {mode === 'recaps' ? (
        <RecapsView entries={entries} />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
          {filtered.length === 0 && <EmptyNote>Nothing logged yet.</EmptyNote>}
          {filtered.map((entry) => {
            const meta = KIND_META[entry.kind] ?? { icon: '·', label: entry.kind };
            return (
              <div
                key={entry.id}
                className="text-xs bg-ink-850 border border-ink-700 rounded-md px-2.5 py-2"
              >
                <div className="flex items-center gap-1.5 text-ink-400 mb-0.5">
                  <span>{meta.icon}</span>
                  <span className="uppercase tracking-wider text-[10px] font-semibold">
                    {meta.label}
                  </span>
                  {role === 'dm' && entry.visibility === 'dm' && (
                    <span className="text-[10px] text-ember-500/80">DM only</span>
                  )}
                  <span className="ml-auto">{formatTime(entry.at)}</span>
                </div>
                <p className="text-ink-100 whitespace-pre-wrap">{entry.text}</p>
              </div>
            );
          })}
        </div>
      )}

      {role === 'dm' && (
        <div className="pt-2 mt-2 border-t border-ink-700 space-y-1.5 shrink-0">
          <SessionMarkButton entries={entries} />
          <NarrateBox />
        </div>
      )}
    </div>
  );
}

/** Start/End session toggle — shows whichever action makes sense after the last mark. */
function SessionMarkButton({ entries }: { entries: LogEntry[] }) {
  const lastMark = [...entries].reverse().find((e) => e.kind === 'session');
  const lastAction = (lastMark?.data as { action?: string } | undefined)?.action;
  const nextAction: 'start' | 'end' = lastAction === 'start' ? 'end' : 'start';
  return (
    <Button
      size="sm"
      variant={nextAction === 'start' ? 'primary' : 'default'}
      onClick={() => send({ kind: 'session.mark', action: nextAction })}
    >
      {nextAction === 'start' ? '▶ Start session' : '■ End session'}
    </Button>
  );
}

/**
 * Sessions newest first, each expandable into its computed recap. Runs
 * entirely on `entries` — for a player that's already their filtered log
 * (the security boundary in `filterStateForViewer` applied before this ever
 * runs), so a player's recap only ever shows what they were allowed to see.
 */
function RecapsView({ entries }: { entries: LogEntry[] }) {
  const sessions = [...computeSessions(entries)].reverse();
  const [expanded, setExpanded] = useState<number | null>(sessions[0]?.index ?? null);

  return (
    <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
      {sessions.length === 0 && <EmptyNote>No sessions yet.</EmptyNote>}
      {sessions.map((session) => (
        <SessionRecapRow
          key={session.index}
          session={session}
          entries={entries}
          isOpen={expanded === session.index}
          onToggle={() => setExpanded(expanded === session.index ? null : session.index)}
        />
      ))}
    </div>
  );
}

function SessionRecapRow({
  session,
  entries,
  isOpen,
  onToggle,
}: {
  session: SessionBoundary;
  entries: LogEntry[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const recap = computeRecap(entries, { fromAt: session.fromAt, toAt: session.toAt });
  const startAtMinutes = (session.startMark?.data as { atMinutes?: number } | undefined)?.atMinutes;
  const endAtMinutes = (session.endMark?.data as { atMinutes?: number } | undefined)?.atMinutes;
  const span =
    startAtMinutes !== undefined
      ? `${formatClock(startAtMinutes)} — ${endAtMinutes !== undefined ? formatClock(endAtMinutes) : 'ongoing'}`
      : null;

  return (
    <div className="bg-ink-850 border border-ink-700 rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer hover:bg-ink-800"
      >
        <span>🎬</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-ink-100">{session.label}</div>
          {span && <div className="text-[11px] text-ink-400">{span}</div>}
        </div>
        <span className="text-[11px] text-ink-400 shrink-0">{recap.entryCount} entries</span>
        <span className="text-ink-400 shrink-0">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-ink-700 pt-2">
          <RecapBody recap={recap} />
        </div>
      )}
    </div>
  );
}

/** Compact rendering of a computed recap, shared by the log's Recaps view and the Journal's teaser. */
export function RecapBody({ recap }: { recap: Recap }) {
  const sections: { label: string; icon: string; texts: string[] }[] = [
    { label: 'Discoveries', icon: '👁️', texts: recap.discoveries.items.map((i) => i.text) },
    {
      label: 'Encounters',
      icon: '🎲',
      texts: [
        ...recap.encounters.triggered.map((i) => i.text),
        ...recap.encounters.quiet.map((i) => `(quiet) ${i.text}`),
      ],
    },
    { label: 'Checks', icon: '🎯', texts: recap.checks.items.map((i) => i.text) },
    { label: 'Shared', icon: '🤝', texts: recap.shares.items.map((i) => i.text) },
    { label: 'Narration', icon: '📜', texts: recap.narrations.items.map((i) => i.text) },
  ];

  return (
    <>
      <div className="text-[11px] text-ink-300">
        Time advanced: {formatDuration(recap.timeAdvancedMinutes)}
        {recap.wallClockMs > 0 && <> · session ran {formatWallClock(recap.wallClockMs)}</>}
      </div>
      {sections.map(
        (s) =>
          s.texts.length > 0 && (
            <div key={s.label}>
              <div className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold mb-0.5 flex items-center gap-1">
                <span>{s.icon}</span>
                <span>
                  {s.label} ({s.texts.length})
                </span>
              </div>
              <ul className="space-y-0.5">
                {s.texts.map((t, i) => (
                  <li key={i} className="text-xs text-ink-100">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      {sections.every((s) => s.texts.length === 0) && (
        <EmptyNote>Nothing notable happened.</EmptyNote>
      )}
    </>
  );
}

function formatWallClock(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

function NarrateBox() {
  const [text, setText] = useState('');
  const [target, setTarget] = useState('all');
  const seats = useSession((s) => s.state?.seats);
  const playerSeats = (seats ?? []).filter((seat) => seat.role === 'player');
  const submit = () => {
    if (!text.trim()) return;
    send({ kind: 'narrate', text: text.trim(), seatIds: target === 'all' ? [] : [target] });
    setText('');
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={target === 'all' ? 'Narrate to all players…' : 'Whisper privately…'}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          maxLength={4000}
        />
        <Button size="sm" variant="primary" onClick={submit} disabled={!text.trim()}>
          ➤
        </Button>
      </div>
      {playerSeats.length > 0 && (
        <select
          className="w-full bg-ink-900 border border-ink-700 rounded px-1.5 py-1 text-[11px] text-ink-300 cursor-pointer focus:outline-none"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="all">To: everyone</option>
          {playerSeats.map((seat) => (
            <option key={seat.id} value={seat.id}>
              To: {seat.name} (private)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function formatTime(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
