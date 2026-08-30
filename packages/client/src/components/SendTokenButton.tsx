import React from 'react';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { cx } from '../ui/kit.js';

/**
 * Arms "click the map to send this token there" mode — a long-distance
 * alternative to dragging. Clicking again (or Escape) cancels.
 */
export function SendTokenButton({ tokenId, name }: { tokenId: string; name: string }) {
  const armed = useUi((s) => s.movingTokenId === tokenId);
  return (
    <button
      className={cx(
        'shrink-0 px-2 py-1 mr-1.5 rounded text-sm cursor-pointer transition-colors',
        armed ? 'bg-brass-500/25 text-brass-300' : 'text-ink-400 hover:text-brass-300',
      )}
      title={
        armed
          ? 'Click the map where they should go — Esc cancels'
          : `Send ${name} somewhere: click this, then click the destination hex`
      }
      onClick={(e) => {
        e.stopPropagation();
        const ui = useUi.getState();
        if (armed) {
          ui.set('movingTokenId', null);
          return;
        }
        ui.set('movingTokenId', tokenId);
        useSession.getState().pushToast({
          kind: 'info',
          title: `Send ${name}`,
          text: 'Click the destination hex on the map — Esc cancels.',
        });
      }}
    >
      🎯
    </button>
  );
}
