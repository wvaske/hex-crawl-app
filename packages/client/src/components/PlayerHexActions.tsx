import React from 'react';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button } from '../ui/kit.js';

/** A selected destination declares intent; neither button moves without DM approval. */
export function PlayerHexActions() {
  const { state, role, seatId, viewingAs } = useSession();
  const hex = useUi((s) => s.selectedHex);
  const pos = useUi((s) => s.pinPopup);
  const characterId = viewingAs?.characterId
    ?? state?.seats.find((s) => s.id === seatId)?.characterId;
  const token = state?.mapState?.tokens.find((t) =>
    t.kind === 'pc' && characterId && t.characterId === characterId);
  if (role !== 'player' || !hex || !pos || !token) return null;
  if (token.q === hex.q && token.r === hex.r) return null;
  const pending = state?.mapState?.pendingMoves.find((p) =>
    p.tokenId === token.id && p.toQ === hex.q && p.toR === hex.r);
  const request = (teleport: boolean) => send({
    kind: 'move.request', tokenId: token.id, q: hex.q, r: hex.r, teleport,
  });

  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-ink-700 bg-ink-900/95 p-2 shadow-xl backdrop-blur"
      style={{ left: `clamp(8rem, ${pos.x}px, calc(100% - 8rem))`, top: Math.max(90, pos.y) }}
      aria-label="Request movement to selected hex"
    >
      <div className="flex gap-2">
        <Button size="sm" className="min-h-10" onClick={() => request(false)}
          disabled={pending?.teleport === false} title="Ask the DM to approve travel to this hex">
          Move Here
        </Button>
        <Button size="sm" className="min-h-10" variant="ghost" onClick={() => request(true)}
          disabled={pending?.teleport === true} title="Ask the DM to approve teleporting to this hex">
          ⚡ Teleport Here
        </Button>
      </div>
      <p className="mt-1 text-center text-[0.6875rem] text-ink-400" role="status">
        {pending ? 'Waiting for DM approval' : 'Both options require DM approval'}
      </p>
    </div>
  );
}
