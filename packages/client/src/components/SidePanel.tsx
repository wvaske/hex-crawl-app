import React from 'react';
import { useSession } from '../stores/session.js';
import {
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  persistPanelWidth,
  useUi,
  type PanelTab,
} from '../stores/ui.js';
import { cx } from '../ui/kit.js';
import { InspectTab } from './panels/InspectTab.js';
import { MapsTab } from './panels/MapsTab.js';
import { CharactersTab } from './panels/CharactersTab.js';
import { TokensTab } from './panels/TokensTab.js';
import { EncountersTab } from './panels/EncountersTab.js';
import { LogTab } from './panels/LogTab.js';
import { JournalTab } from './panels/JournalTab.js';
import { SensesTab } from './panels/SensesTab.js';
import { SettingsTab } from './panels/SettingsTab.js';

const DM_TABS: { tab: PanelTab; icon: string; name: string }[] = [
  { tab: 'inspect', icon: '🔍', name: 'Inspect' },
  { tab: 'maps', icon: '🗺️', name: 'Maps' },
  { tab: 'tokens', icon: '♟️', name: 'Tokens' },
  { tab: 'characters', icon: '🧝', name: 'Party' },
  { tab: 'encounters', icon: '🎲', name: 'Encounters' },
  { tab: 'log', icon: '📜', name: 'Log' },
  { tab: 'settings', icon: '⚙️', name: 'Setup' },
];

const PLAYER_TABS: { tab: PanelTab; icon: string; name: string }[] = [
  { tab: 'inspect', icon: '🔍', name: 'Inspect' },
  { tab: 'senses', icon: '👁️', name: 'Senses' },
  { tab: 'characters', icon: '🧝', name: 'Party' },
  { tab: 'journal', icon: '📔', name: 'Journal' },
  { tab: 'log', icon: '📜', name: 'Log' },
];

export function SidePanel({ campaignId }: { campaignId: string }) {
  const role = useSession((s) => s.role);
  const tab = useUi((s) => s.panelTab);
  const width = useUi((s) => s.panelWidth);
  const setUi = useUi((s) => s.set);
  const tabs = role === 'dm' ? DM_TABS : PLAYER_TABS;
  const active = tabs.some((t) => t.tab === tab) ? tab : 'inspect';
  // When the panel is too narrow for one row of tabs, wrap into two rows
  // instead of scrolling horizontally.
  const twoRows = width < tabs.length * 64;

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = useUi.getState().panelWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(
        PANEL_WIDTH_MAX,
        Math.max(PANEL_WIDTH_MIN, startWidth + (startX - ev.clientX)),
      );
      useUi.getState().set('panelWidth', next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      persistPanelWidth(useUi.getState().panelWidth);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 bg-ink-900 border-l border-ink-700 flex flex-col z-20"
    >
      <div
        onPointerDown={startResize}
        className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-0.5 cursor-col-resize z-30 hover:bg-brass-500/40 active:bg-brass-500/60"
        title="Drag to resize the panel"
      />
      <nav
        className={cx(
          'border-b border-ink-700 shrink-0',
          twoRows ? 'grid' : 'flex overflow-x-auto',
        )}
        style={
          twoRows
            ? { gridTemplateColumns: `repeat(${Math.ceil(tabs.length / 2)}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {tabs.map((t) => (
          <button
            key={t.tab}
            onClick={() => setUi('panelTab', t.tab)}
            title={t.name}
            className={cx(
              'flex-1 px-2 py-2 text-center text-[11px] font-medium transition-colors cursor-pointer border-b-2 whitespace-nowrap',
              active === t.tab
                ? 'border-brass-500 bg-ink-850 text-brass-300'
                : 'border-transparent hover:bg-ink-850/60 text-ink-300 hover:text-ink-100',
            )}
          >
            {t.name}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-3">
        {active === 'inspect' && <InspectTab />}
        {active === 'maps' && <MapsTab campaignId={campaignId} />}
        {active === 'tokens' && <TokensTab />}
        {active === 'characters' && <CharactersTab />}
        {active === 'senses' && <SensesTab />}
        {active === 'encounters' && <EncountersTab />}
        {active === 'log' && <LogTab />}
        {active === 'journal' && <JournalTab />}
        {active === 'settings' && <SettingsTab campaignId={campaignId} />}
      </div>
    </aside>
  );
}
