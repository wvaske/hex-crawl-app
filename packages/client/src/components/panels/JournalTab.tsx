import React from 'react';
import { CONTENT_TYPE_GLYPHS, isFullContent, type ContentPlayerView } from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { EmptyNote, Section } from '../../ui/kit.js';

/** Player-side journal: everything their character has learned, grouped by place. */
export function JournalTab() {
  const state = useSession((s) => s.state);
  const selectHex = useUi((s) => s.selectHex);
  if (!state) return null;

  const contents = (state.mapState?.contents ?? []).filter(
    (c): c is ContentPlayerView => !isFullContent(c),
  );
  const narrations = state.log.filter((l) => l.kind === 'narration');

  return (
    <div>
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

      <Section title="The story so far">
        {narrations.length === 0 && <EmptyNote>No narration shared yet.</EmptyNote>}
        <div className="space-y-1.5">
          {narrations.map((n) => (
            <div key={n.id} className="text-xs bg-ink-850 border border-ink-700 rounded-md px-2.5 py-2">
              <p className="text-ink-100 whitespace-pre-wrap">{n.text}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
