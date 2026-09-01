import React from 'react';
import type { Sense } from '@hexcrawl/shared';
import { useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { EmptyNote, Section, cx } from '../../ui/kit.js';

/**
 * The character's sensed clues: what they can observe right now, and past
 * observations. Clicking a clue highlights every visited hex it can be
 * sensed from, so the party can triangulate the source.
 */
export function SensesTab() {
  const senses = useSession((s) => s.state?.senses ?? []);
  const current = senses.filter((s) => s.inRange);
  const past = senses.filter((s) => !s.inRange);

  return (
    <div>
      <Section title="You currently sense">
        {current.length === 0 && (
          <EmptyNote>Nothing beyond the ordinary, from where you stand.</EmptyNote>
        )}
        <div className="space-y-1.5">
          {current.map((s) => (
            <SenseRow key={s.clueId} sense={s} />
          ))}
        </div>
      </Section>
      <Section title="Past observations">
        {past.length === 0 && <EmptyNote>Nothing yet — explore, and pay attention.</EmptyNote>}
        <div className="space-y-1.5">
          {past.map((s) => (
            <SenseRow key={s.clueId} sense={s} />
          ))}
        </div>
      </Section>
      <p className="text-[11px] text-ink-400 mt-2">
        Click a clue to highlight every hex you've visited where it can be sensed — walk the edges
        of that area to triangulate the source.
      </p>
    </div>
  );
}

function SenseRow({ sense }: { sense: Sense }) {
  const highlighted = useUi((u) => u.senseHighlight?.clueId === sense.clueId);
  const toggle = () => {
    const ui = useUi.getState();
    ui.set(
      'senseHighlight',
      highlighted ? null : { clueId: sense.clueId, cells: sense.observableFrom },
    );
  };
  return (
    <button
      onClick={toggle}
      className={cx(
        'w-full text-left rounded-md border px-2.5 py-2 cursor-pointer transition-colors',
        highlighted
          ? 'border-brass-500 bg-brass-500/10'
          : 'border-ink-700 bg-ink-850 hover:border-ink-500',
      )}
      title={
        highlighted
          ? 'Hide the sensing area'
          : `Show the ${sense.observableFrom.length} visited hex(es) this can be sensed from`
      }
    >
      <span className="block text-sm text-ink-100">
        {sense.text}
        {sense.direction && <span className="text-brass-300"> — to the {sense.direction}</span>}
      </span>
      <span className="block text-[11px] text-ink-400 mt-0.5">
        {sense.located && sense.contentTitle ? (
          <>
            Source found: <span className="text-ink-200">{sense.contentTitle}</span>
          </>
        ) : sense.inRange ? (
          'Sensing it now'
        ) : (
          'Observed earlier'
        )}
        {/*
          Both facts used to live in a `title`, which a phone never shows: the
          hex count is what tells a player whether tapping is worth it, and
          "share with the party" is what the handshake actually does (#75).
        */}
        {highlighted ? ' · highlighted on map' : ` · seen from ${sense.observableFrom.length} hexes`}
        <span
          role="button"
          className="float-right inline-flex items-center -my-1 px-2 py-1 rounded text-brass-400 hover:text-brass-300"
          title="Tell the party — everyone learns this clue"
          onClick={(e) => {
            e.stopPropagation();
            send({ kind: 'clue.share', clueId: sense.clueId });
          }}
        >
          🤝 Share with party
        </span>
      </span>
    </button>
  );
}
