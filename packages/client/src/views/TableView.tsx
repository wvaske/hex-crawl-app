import React, { useEffect, useRef } from 'react';
import { connectWs, disconnectWs, send } from '../ws.js';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { TopBar } from '../components/TopBar.js';
import { Toolbar } from '../components/Toolbar.js';
import { SidePanel } from '../components/SidePanel.js';
import { Toasts } from '../components/Toasts.js';
import { ContentDialog } from '../components/ContentDialog.js';
import { EmptyMapHint, HexReadout } from '../components/StatusOverlays.js';
import { PendingMoves } from '../components/PendingMoves.js';
import { SelectionBar } from '../components/SelectionBar.js';
import { PinActions } from '../components/PinActions.js';

export function TableView({ campaignId }: { campaignId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const status = useSession((s) => s.status);
  const hasState = useSession((s) => s.state !== null);
  const role = useSession((s) => s.role);
  const panelOpen = useUi((s) => s.panelOpen);
  const contentDialogHex = useUi((s) => s.contentDialogHex);

  useEffect(() => {
    connectWs(campaignId);
    return () => disconnectWs();
  }, [campaignId]);

  // DM tool keyboard shortcuts + hold-space to pan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }
      const ui = useUi.getState();
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault(); // keep the page from scrolling / buttons from firing
        if (!ui.spacePan) ui.set('spacePan', true);
        return;
      }
      if (e.key === 'Alt') {
        ui.set('altTeleport', true);
      }
      if (e.key === 'Escape') {
        // Painting an area is a mode inside the open content dialog: the
        // first Escape leaves the mode and hands the dialog back, rather
        // than throwing away the edit in progress.
        if (ui.areaPaint) {
          ui.set('areaPaint', null);
          return;
        }
        ui.set('areaHighlight', null);
        ui.set('contentDialogHex', null);
        ui.set('editingContentId', null);
        ui.selectHex(null);
        ui.set('measureStart', null);
        ui.set('movingTokenId', null);
        ui.set('senseHighlight', null);
        ui.set('trailHighlight', null);
        ui.set('trailDraft', []);
        ui.set('editingTrailId', null);
        ui.set('contentSelection', null);
        return;
      }
      if (useSession.getState().role !== 'dm') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        send({ kind: 'undo' });
        return;
      }
      const tools = { v: 'select', b: 'paint', f: 'fog', m: 'marker', c: 'content', t: 'trail', r: 'measure' } as const;
      const tool = tools[e.key.toLowerCase() as keyof typeof tools];
      if (tool && !e.metaKey && !e.ctrlKey && !e.altKey) ui.setTool(tool);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space') useUi.getState().set('spacePan', false);
      if (e.key === 'Alt') useUi.getState().set('altTeleport', false);
    };
    const onBlur = () => {
      useUi.getState().set('spacePan', false);
      useUi.getState().set('altTeleport', false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new CanvasEngine();
    engineRef.current = engine;
    void engine.init(host);
    return () => {
      engine.destroy();
      engineRef.current = null;
      host.replaceChildren();
    };
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TopBar
        campaignId={campaignId}
        onRecenter={() => engineRef.current?.recenter()}
        onGoToMe={() => engineRef.current?.centerOnMyToken()}
      />
      <div className="flex-1 flex min-h-0 relative">
        <div ref={hostRef} className="canvas-host flex-1 min-w-0 relative" />
        <EmptyMapHint />
        <HexReadout />
        <PendingMoves />
        {role === 'dm' && <Toolbar />}
        {role === 'dm' && <SelectionBar />}
        {role === 'dm' && <PinActions />}
        {panelOpen && <SidePanel campaignId={campaignId} />}
        {!hasState && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 pointer-events-none">
            <p className="text-ink-400 animate-pulse">
              {status === 'open' ? 'Loading campaign…' : 'Connecting…'}
            </p>
          </div>
        )}
        {status === 'closed' && hasState && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-ember-500/90 text-ink-950 text-sm font-medium px-4 py-1.5 rounded-full shadow-lg">
            Connection lost — reconnecting…
          </div>
        )}
        <Toasts />
      </div>
      {contentDialogHex && <ContentDialog />}
    </div>
  );
}
