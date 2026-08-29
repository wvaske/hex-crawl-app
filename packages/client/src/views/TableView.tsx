import React, { useEffect, useRef } from 'react';
import { connectWs, disconnectWs } from '../ws.js';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { TopBar } from '../components/TopBar.js';
import { Toolbar } from '../components/Toolbar.js';
import { SidePanel } from '../components/SidePanel.js';
import { Toasts } from '../components/Toasts.js';
import { ContentDialog } from '../components/ContentDialog.js';

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
      <TopBar campaignId={campaignId} onRecenter={() => engineRef.current?.recenter()} />
      <div className="flex-1 flex min-h-0 relative">
        <div ref={hostRef} className="canvas-host flex-1 min-w-0 relative" />
        {role === 'dm' && <Toolbar />}
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
