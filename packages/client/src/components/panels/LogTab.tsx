import React, { useEffect, useRef, useState } from 'react';
import { useSession } from '../../stores/session.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Input, cx } from '../../ui/kit.js';

const KIND_META: Record<string, { icon: string; label: string }> = {
  discovery: { icon: '👁️', label: 'Discovery' },
  check: { icon: '🎯', label: 'Check' },
  encounter: { icon: '🎲', label: 'Encounter' },
  narration: { icon: '📜', label: 'Narration' },
};

const FILTERS = ['all', 'discovery', 'check', 'encounter', 'narration'] as const;

export function LogTab() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = state?.log ?? [];
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length]);

  return (
    <div className="flex flex-col h-full">
      {role === 'dm' && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cx(
                'px-2 py-0.5 rounded-full text-[11px] capitalize cursor-pointer border',
                filter === f
                  ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                  : 'border-ink-700 text-ink-300 hover:bg-ink-700',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {filtered.length === 0 && <EmptyNote>Nothing logged yet.</EmptyNote>}
        {filtered.map((entry) => {
          const meta = KIND_META[entry.kind] ?? { icon: '·', label: entry.kind };
          return (
            <div key={entry.id} className="text-xs bg-ink-850 border border-ink-700 rounded-md px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-ink-400 mb-0.5">
                <span>{meta.icon}</span>
                <span className="uppercase tracking-wider text-[10px] font-semibold">{meta.label}</span>
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
      {role === 'dm' && <NarrateBox />}
    </div>
  );
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
    <div className="pt-2 mt-2 border-t border-ink-700 space-y-1.5 shrink-0">
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
