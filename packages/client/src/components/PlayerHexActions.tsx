import React from 'react';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button } from '../ui/kit.js';
import { useIsMobile } from '../ui/responsive.js';

/** A selected destination declares intent; neither button moves without DM approval. */
export function PlayerHexActions() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 288, height: 90 });
  const [mobileBottom, setMobileBottom] = React.useState<number | null>(null);
  const mobile = useIsMobile();
  const openPanel = useUi((s) => s.openPanel);
  const { state, role, seatId, viewingAs } = useSession();
  const hex = useUi((s) => s.selectedHex);
  const pos = useUi((s) => s.pinPopup);
  const characterId = viewingAs?.characterId
    ?? state?.seats.find((s) => s.id === seatId)?.characterId;
  const token = state?.mapState?.tokens.find((t) =>
    t.kind === 'pc' && characterId && t.characterId === characterId);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.offsetWidth, height: element.offsetHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(pos && hex && token && (token.q !== hex.q || token.r !== hex.r))]);
  React.useLayoutEffect(() => {
    if (!mobile) { setMobileBottom(null); return; }
    const obstacles = [...document.querySelectorAll('.panel-sheet, .panel-tabbar')];
    const update = () => {
      const top = document.querySelector('.canvas-host')?.getBoundingClientRect().top ?? 0;
      setMobileBottom(Math.min(...obstacles.map((el) => el.getBoundingClientRect().top - top)));
    };
    const observer = new ResizeObserver(update);
    obstacles.forEach((el) => observer.observe(el));
    update();
    return () => observer.disconnect();
  }, [mobile, openPanel, pos?.height]);
  if (role !== 'player' || !hex || !pos || !token) return null;
  if (token.q === hex.q && token.r === hex.r) return null;
  const bottom = Math.min(pos.height, mobileBottom ?? pos.height);
  const pending = state?.mapState?.pendingMoves.find((p) =>
    p.tokenId === token.id && p.toQ === hex.q && p.toR === hex.r);
  const request = (teleport: boolean) => send({
    kind: 'move.request', tokenId: token.id, q: hex.q, r: hex.r, teleport,
  });

  return (
    <div
      ref={ref}
      className="absolute z-30 w-72 rounded-lg border border-ink-700 bg-ink-900/95 p-2 shadow-xl backdrop-blur"
      style={{
        maxWidth: Math.max(0, pos.width - 16),
        left: Math.max(8, Math.min(pos.x - size.width / 2, pos.width - size.width - 8)),
        top: Math.max(8, Math.min(pos.y >= size.height + 8 ? pos.y - size.height : pos.belowY, bottom - size.height - 8)),
        visibility: bottom < size.height + 16 ? 'hidden' : 'visible',
      }}
      role="group"
      aria-label="Request movement to selected hex"
    >
      <div className="flex flex-wrap justify-center gap-2">
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
        Hex {hex.q}, {hex.r} · {pending ? 'Waiting for DM approval' : 'DM approval required'}
      </p>
    </div>
  );
}
