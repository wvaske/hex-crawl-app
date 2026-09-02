import React, { useEffect, useState } from 'react';
import type { DiceRoll, LogEntry } from '@hexcrawl/shared';
import { formatRoll } from '@hexcrawl/shared';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button } from '../ui/kit.js';

/**
 * DM popup for a triggered encounter (manual roll or auto travel check):
 * everything needed to run the moment — the rolls, the table entry, the
 * quantity — plus an editable narration box to hand it to the players.
 * Opened from ws.ts when the encounter log event lands; reopenable from any
 * encounter row in the Log tab.
 */
export function EncounterDialog() {
  const entry = useUi((u) => u.encounterDialogEntry)!;
  const setUi = useUi((u) => u.set);
  const state = useSession((s) => s.state);
  const close = () => setUi('encounterDialogEntry', null);

  const data = entry.data as {
    terrain?: string | null;
    tableId?: string | null;
    entryText?: string | null;
    checkRoll?: DiceRoll | null;
    tableRoll?: DiceRoll | null;
    quantityRoll?: DiceRoll | null;
  };
  const table = state?.encounterTables.find((t) => t.id === data.tableId) ?? null;
  const quantity = data.quantityRoll ?? null;
  const defaultNarration = data.entryText
    ? quantity
      ? `${data.entryText} (${quantity.total})`
      : data.entryText
    : entry.text;

  const [narration, setNarration] = useState(defaultNarration);
  const [narrated, setNarrated] = useState(false);
  // A reroll replaces the entry (ws.ts writes the new one into the store):
  // reset the narration draft to match it.
  useEffect(() => {
    setNarration(defaultNarration);
    setNarrated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rollAgain = () => {
    const mapId = state?.campaign.activeMapId;
    if (!mapId) return;
    // Same table, straight to the result — the trigger already happened.
    send({ kind: 'encounter.roll', mapId, q: null, r: null, tableId: data.tableId ?? null, skipCheck: true });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-ink-850 border border-ink-600 rounded-xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
          <h2 className="font-semibold text-ink-100">⚔️ Encounter</h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close">
            ✕
          </Button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-400">
            {table && (
              <span className="px-2 py-0.5 rounded-full border border-ink-600 text-ink-200">
                🎲 {table.name}
              </span>
            )}
            {data.terrain && (
              <span className="px-2 py-0.5 rounded-full border border-ink-600 capitalize">
                {data.terrain}
              </span>
            )}
            {entry.text.startsWith('Auto check') && (
              <span className="px-2 py-0.5 rounded-full border border-ink-600">
                auto travel check
              </span>
            )}
          </div>

          <p className="text-base text-ink-100 whitespace-pre-wrap">
            {data.entryText ?? entry.text}
            {quantity && (
              <span className="text-brass-300"> × {quantity.total}</span>
            )}
          </p>

          <div className="text-[11px] text-ink-400 space-y-0.5">
            {data.checkRoll && <p>Trigger — {formatRoll(data.checkRoll)}</p>}
            {data.tableRoll && <p>Table — {formatRoll(data.tableRoll)}</p>}
            {quantity && <p>Quantity — {formatRoll(quantity)}</p>}
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-ink-400 mb-1">
              Narrate it (players see this word for word)
            </label>
            <textarea
              className="w-full bg-ink-900 border border-ink-600 rounded-md px-2 py-1.5 text-sm text-ink-100 min-h-[72px]"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-ink-700">
          <Button
            variant="primary"
            size="sm"
            disabled={!narration.trim()}
            onClick={() => {
              send({ kind: 'narrate', text: narration.trim(), seatIds: [] });
              setNarrated(true);
            }}
          >
            📜 Narrate to the table
          </Button>
          {narrated && <span className="text-[11px] text-brass-300">Sent ✓</span>}
          <span className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={rollAgain} title="Roll this table again">
              🎲 Reroll
            </Button>
            <Button variant="ghost" size="sm" onClick={close}>
              Done
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
