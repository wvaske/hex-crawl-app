import React, { useState } from 'react';
import { EXTRA_DICE, type Advantage } from '@hexcrawl/shared';
import { useSession } from '../stores/session.js';
import { EXTRA_LABELS, useRollOptions } from '../stores/roll.js';
import { cx, Lbl } from '../ui/kit.js';

/**
 * The dice tray (issue #129): everything that rides on the next 🎲 press.
 * Buttons, not a text field — tap d4 to add a Guidance die, tap the chip's
 * sign to make it a penalty, tap ✕ to drop it. Advantage/disadvantage is a
 * three-way toggle. A player gets "DM only"; the DM (in a group roll) gets
 * "proficient only". Sits above every place a roll can be made from.
 */
export function RollOptionsBar({ group = false }: { group?: boolean }) {
  const role = useSession((s) => s.role);
  const extras = useRollOptions((s) => s.extras);
  const advantage = useRollOptions((s) => s.advantage);
  const secret = useRollOptions((s) => s.secret);
  const proficientOnly = useRollOptions((s) => s.proficientOnly);
  const { addExtra, removeExtra, flipExtra, set } = useRollOptions.getState();
  const [label, setLabel] = useState<string>(EXTRA_LABELS[0]);
  const [custom, setCustom] = useState('');
  const [flat, setFlat] = useState('2');
  const chosenLabel = label === 'Other' ? custom.trim() : label;
  const pending = extras.length > 0 || advantage !== 'none';

  return (
    <div className="rounded-md border border-ink-700 bg-ink-900/60 p-1.5 space-y-1.5">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[0.625rem] uppercase tracking-wider text-ink-400 mr-0.5">Add</span>
        {EXTRA_DICE.map((sides) => (
          <button
            key={sides}
            className="px-1.5 py-0.5 rounded border border-ink-600 text-[0.6875rem] text-ink-200 hover:bg-ink-700 cursor-pointer"
            title={`Add +1d${sides}${chosenLabel ? ` (${chosenLabel})` : ''} to the next roll`}
            onClick={() => addExtra({ sides, amount: 1, sign: 1, label: chosenLabel })}
          >
            d{sides}
          </button>
        ))}
        <span className="flex items-center gap-0.5 ml-1">
          <input
            type="number"
            min={1}
            max={20}
            value={flat}
            onChange={(e) => setFlat(e.target.value)}
            className="w-10 rounded bg-ink-900 border border-ink-600 px-1 py-0.5 text-[0.6875rem] text-ink-100"
            title="Flat bonus"
          />
          <button
            className="px-1.5 py-0.5 rounded border border-ink-600 text-[0.6875rem] text-ink-200 hover:bg-ink-700 cursor-pointer"
            title={`Add a flat +${flat || 0}${chosenLabel ? ` (${chosenLabel})` : ''}`}
            onClick={() => {
              const n = Math.round(Number(flat));
              if (Number.isFinite(n) && n >= 1) addExtra({ sides: 0, amount: Math.min(20, n), sign: 1, label: chosenLabel });
            }}
          >
            +flat
          </button>
        </span>
        <select
          className="ml-1 bg-ink-900 border border-ink-600 rounded px-1 py-0.5 text-[0.6875rem] text-ink-200 cursor-pointer"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          title="What the die is for — shown in the log"
        >
          {EXTRA_LABELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        {label === 'Other' && (
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={40}
            placeholder="reason"
            className="w-24 rounded bg-ink-900 border border-ink-600 px-1 py-0.5 text-[0.6875rem] text-ink-100"
          />
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <div className="flex items-center rounded-md border border-ink-600 overflow-hidden text-[0.6875rem]">
          {(
            [
              ['disadvantage', 'Dis'],
              ['none', 'Normal'],
              ['advantage', 'Adv'],
            ] as [Advantage, string][]
          ).map(([value, text]) => (
            <button
              key={value}
              onClick={() => set('advantage', value)}
              className={cx(
                'px-2 py-0.5 cursor-pointer transition-colors',
                advantage === value ? 'bg-brass-500/25 text-brass-300' : 'text-ink-400 hover:bg-ink-700',
              )}
              title={
                value === 'none'
                  ? 'One d20'
                  : value === 'advantage'
                    ? 'Roll two d20, keep the higher'
                    : 'Roll two d20, keep the lower'
              }
            >
              {text}
            </button>
          ))}
        </div>
        {role === 'player' && (
          <label className="flex items-center gap-1 text-[0.6875rem] text-ink-300 cursor-pointer ml-1" title="Only you and the DM see this roll">
            <input type="checkbox" checked={secret} onChange={(e) => set('secret', e.target.checked)} />
            DM only
          </label>
        )}
        {role === 'dm' && group && (
          <label className="flex items-center gap-1 text-[0.6875rem] text-ink-300 cursor-pointer ml-1" title="Skip characters who are not proficient in the skill">
            <input
              type="checkbox"
              checked={proficientOnly}
              onChange={(e) => set('proficientOnly', e.target.checked)}
            />
            Proficient only
          </label>
        )}
        {pending && (
          <span className="text-[0.625rem] text-brass-300 ml-auto" title="Applies to the next roll, then clears">
            on next roll
          </span>
        )}
      </div>

      {extras.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {extras.map((x, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full border border-brass-500/60 bg-brass-500/10 px-1.5 py-0.5 text-[0.6875rem] text-brass-300"
            >
              <button
                className="cursor-pointer font-bold"
                title={x.sign === 1 ? 'Bonus — click to make it a penalty' : 'Penalty — click to make it a bonus'}
                onClick={() => flipExtra(i)}
              >
                {x.sign === 1 ? '+' : '−'}<Lbl>{x.sign === 1 ? 'bonus' : 'penalty'}</Lbl>
              </button>
              {x.sides === 0 ? x.amount : `${x.amount}d${x.sides}`}
              {x.label && <span className="text-ink-300">{x.label}</span>}
              <button className="cursor-pointer text-ink-400 hover:text-ember-500" title="Remove" onClick={() => removeExtra(i)}>
                ✕<Lbl>Remove</Lbl>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
