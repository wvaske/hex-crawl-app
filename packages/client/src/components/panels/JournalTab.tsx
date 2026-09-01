import React from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  computeRecap,
  computeSessions,
  isFullContent,
  recapHighlights,
  type ContentPlayerView,
} from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { EmptyNote, Section, cx } from '../../ui/kit.js';

/** Player-side journal: everything their character has learned, grouped by place. */
export function JournalTab() {
  const state = useSession((s) => s.state);
  const selectHex = useUi((s) => s.selectHex);
  if (!state) return null;

  const contents = (state.mapState?.contents ?? []).filter(
    (c): c is ContentPlayerView => !isFullContent(c),
  );
  const narrations = state.log.filter((l) => l.kind === 'narration');
  // Party notes the players pinned themselves (issue #74) — findable without
  // scanning the map.
  const partyNotes = (state.mapState?.markers ?? []).filter((m) => m.playerPlaced);
  const trailSigns = state.mapState?.trailSigns ?? [];
  const trails: { trailId: string; glyph: string; cells: { q: number; r: number }[] }[] = [];
  for (const s of trailSigns) {
    let entry = trails.find((t) => t.trailId === s.trailId);
    if (!entry) {
      entry = { trailId: s.trailId, glyph: s.glyph, cells: [] };
      trails.push(entry);
    }
    entry.cells.push({ q: s.q, r: s.r });
  }

  return (
    <div>
      <PreviouslyOnCard />

      <Section title="Discoveries">
        {contents.length === 0 && (
          <EmptyNote>
            Nothing discovered on this map yet. Explore — high passive skills notice things from
            afar.
          </EmptyNote>
        )}
        <div className="space-y-2">
          {contents.map((c) => (
            <button
              key={c.id}
              className="w-full text-left bg-ink-850 border border-ink-700 rounded-lg p-2.5 cursor-pointer hover:border-ink-600"
              onClick={() => selectHex({ q: c.q, r: c.r })}
              title="Show on map"
            >
              <div className="flex items-center gap-2">
                <span>{c.glyph || CONTENT_TYPE_GLYPHS[c.type]}</span>
                <span className="text-sm font-medium text-ink-100 truncate flex-1">{c.title}</span>
                <span className="text-xs text-ink-400">
                  {c.q},{c.r}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {c.discoveredClues.map((clue) => (
                  <li key={clue.clueId} className="text-xs text-ink-200">
                    {clue.text}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Party notes">
        {partyNotes.length === 0 && (
          <EmptyNote>
            No party notes on this map yet — pin one from a hex in the Inspect tab.
          </EmptyNote>
        )}
        <div className="space-y-1.5">
          {partyNotes.map((n) => {
            const owner = state.seats.find((s) => s.id === n.ownerSeatId)?.name;
            return (
              <button
                key={n.id}
                className="w-full text-left bg-ink-850 border border-ink-700 rounded-lg px-2.5 py-2 cursor-pointer hover:border-ink-600"
                onClick={() => selectHex({ q: n.q, r: n.r })}
                title="Show on map"
              >
                <div className="flex items-center gap-2">
                  <span>{n.glyph}</span>
                  <span className="text-sm text-ink-100 truncate flex-1">
                    {n.label || '(no text)'}
                  </span>
                  <span className="text-xs text-ink-400 shrink-0">
                    {n.q},{n.r}
                  </span>
                </div>
                {owner && <span className="text-[11px] text-ink-400">— {owner}</span>}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Tracks you've found">
        {trails.length === 0 && (
          <EmptyNote>No tracks discovered yet — footprints and trail signs show up here.</EmptyNote>
        )}
        <div className="space-y-2">
          {trails.map((t) => (
            <TrackRow key={t.trailId} trail={t} />
          ))}
        </div>
      </Section>

      <Section title="The story so far">
        {narrations.length === 0 && <EmptyNote>No narration shared yet.</EmptyNote>}
        <div className="space-y-1.5">
          {narrations.map((n) => (
            <div
              key={n.id}
              className="text-xs bg-ink-850 border border-ink-700 rounded-md px-2.5 py-2"
            >
              <p className="text-ink-100 whitespace-pre-wrap">{n.text}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/**
 * A small "previously on…" teaser at the top of the journal (issue #78): as
 * soon as the DM starts a new session, players get a quick reminder of the
 * highlights from the one before it. Deliberately simple — no per-player
 * "seen this already" tracking, it just shows whenever the most recent
 * session mark is a 'start'. Runs on `state.log`, which is already filtered
 * to what this viewer is allowed to see, so the recap it builds respects the
 * same security boundary as the rest of the journal.
 */
function PreviouslyOnCard() {
  const state = useSession((s) => s.state);
  if (!state) return null;

  const lastMark = [...state.log].reverse().find((e) => e.kind === 'session');
  const lastAction = (lastMark?.data as { action?: string } | undefined)?.action;
  if (lastAction !== 'start') return null;

  const sessions = computeSessions(state.log);
  const previous = sessions[sessions.length - 2];
  if (!previous) return null;

  const recap = computeRecap(state.log, { fromAt: previous.fromAt, toAt: previous.toAt });
  const highlights = recapHighlights(recap, 3);
  if (highlights.length === 0) return null;

  return (
    <div className="mb-4 bg-brass-500/10 border border-brass-500/30 rounded-lg p-2.5">
      <div className="text-[11px] uppercase tracking-wider text-brass-300 font-semibold mb-1.5">
        Previously on…
      </div>
      <ul className="space-y-1">
        {highlights.map((h) => (
          <li key={h.id} className="text-xs text-ink-100">
            {h.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One known trail: clicking toggles the full-trail highlight on the map
 * (every cell this character has discovered) without navigating the
 * Inspect selection — this is a map overlay, not a "go to hex" shortcut.
 */
function TrackRow({
  trail,
}: {
  trail: { trailId: string; glyph: string; cells: { q: number; r: number }[] };
}) {
  const highlighted = useUi((u) => u.trailHighlight?.trailId === trail.trailId);
  const toggle = () => {
    const ui = useUi.getState();
    ui.set('trailHighlight', highlighted ? null : { trailId: trail.trailId, cells: trail.cells });
  };
  return (
    <button
      onClick={toggle}
      className={cx(
        'w-full text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-colors',
        highlighted
          ? 'border-brass-500 bg-brass-500/10'
          : 'border-ink-700 bg-ink-850 hover:border-ink-600',
      )}
      title={
        highlighted
          ? 'Hide this trail'
          : `Show the ${trail.cells.length} place(s) you've spotted this trail`
      }
    >
      <div className="flex items-center gap-2">
        <span>{trail.glyph}</span>
        <span className="text-sm font-medium text-ink-100 flex-1">
          {trail.cells.length} place{trail.cells.length === 1 ? '' : 's'} spotted
        </span>
      </div>
      {highlighted && (
        <span className="block text-[11px] text-brass-300 mt-0.5">highlighted on map</span>
      )}
    </button>
  );
}
