import React, { useState } from 'react';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';

/**
 * Floating action bar for box-selected content (Shift+drag with the select
 * tool): bulk enable/disable and quest tagging.
 */
export function SelectionBar() {
  const selection = useUi((s) => s.contentSelection);
  const [quest, setQuest] = useState('');
  const pushToast = useSession((s) => s.pushToast);

  if (!selection || selection.length === 0) return null;

  const clear = () => useUi.getState().set('contentSelection', null);
  const setEnabled = (enabled: boolean) => {
    send({ kind: 'content.setEnabled', contentIds: selection, enabled });
    pushToast({
      kind: 'info',
      title: enabled ? 'Enabled' : 'Disabled',
      text: `${selection.length} item(s) ${enabled ? 'now live for players' : 'hidden from players'}.`,
    });
    clear();
  };
  const applyQuest = () => {
    send({ kind: 'content.setQuest', contentIds: selection, quest: quest.trim() });
    pushToast({
      kind: 'info',
      title: 'Quest tagged',
      text: `${selection.length} item(s) → "${quest.trim() || '(none)'}"`,
    });
    clear();
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-ink-900/95 border border-brass-500/50 rounded-lg shadow-xl backdrop-blur px-3 py-2 flex items-center gap-2">
      <span className="text-sm text-ink-100 font-medium whitespace-nowrap">
        {selection.length} item{selection.length === 1 ? '' : 's'}
      </span>
      <button
        className="px-2.5 py-1 rounded text-xs cursor-pointer bg-brass-500/20 text-brass-300 border border-brass-500/50"
        onClick={() => setEnabled(true)}
      >
        🟢 Enable
      </button>
      <button
        className="px-2.5 py-1 rounded text-xs cursor-pointer text-ink-200 border border-ink-600 hover:bg-ink-700"
        onClick={() => setEnabled(false)}
      >
        ⚪ Disable
      </button>
      <input
        className="w-32 bg-ink-950 border border-ink-600 rounded px-2 py-1 text-xs text-ink-100"
        placeholder="Quest tag…"
        value={quest}
        maxLength={120}
        onChange={(e) => setQuest(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && applyQuest()}
      />
      <button
        className="px-2 py-1 rounded text-xs cursor-pointer text-ink-200 border border-ink-600 hover:bg-ink-700"
        onClick={applyQuest}
        title="Assign this quest tag to the selection (empty clears the tag)"
      >
        Tag
      </button>
      <button className="text-ink-400 hover:text-ink-100 cursor-pointer px-1" onClick={clear}>
        ✕
      </button>
    </div>
  );
}
