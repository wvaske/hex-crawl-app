import React from 'react';
import { useSession } from '../stores/session.js';
import { useUi, type PanelTab } from '../stores/ui.js';
import { cx } from '../ui/kit.js';
import { InspectTab } from './panels/InspectTab.js';
import { MapsTab } from './panels/MapsTab.js';
import { CharactersTab } from './panels/CharactersTab.js';
import { TokensTab } from './panels/TokensTab.js';
import { EncountersTab } from './panels/EncountersTab.js';
import { LogTab } from './panels/LogTab.js';
import { JournalTab } from './panels/JournalTab.js';
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
  { tab: 'characters', icon: '🧝', name: 'Party' },
  { tab: 'journal', icon: '📔', name: 'Journal' },
  { tab: 'log', icon: '📜', name: 'Log' },
];

export function SidePanel({ campaignId }: { campaignId: string }) {
  const role = useSession((s) => s.role);
  const tab = useUi((s) => s.panelTab);
  const setUi = useUi((s) => s.set);
  const tabs = role === 'dm' ? DM_TABS : PLAYER_TABS;
  const active = tabs.some((t) => t.tab === tab) ? tab : 'inspect';

  return (
    <aside className="w-80 shrink-0 bg-ink-900 border-l border-ink-700 flex flex-col z-20">
      <nav className="flex border-b border-ink-700 shrink-0 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.tab}
            onClick={() => setUi('panelTab', t.tab)}
            title={t.name}
            className={cx(
              'flex-1 min-w-10 py-2.5 text-center text-base transition-colors cursor-pointer border-b-2',
              active === t.tab
                ? 'border-brass-500 bg-ink-850'
                : 'border-transparent hover:bg-ink-850/60 opacity-60 hover:opacity-100',
            )}
          >
            {t.icon}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-3">
        {active === 'inspect' && <InspectTab />}
        {active === 'maps' && <MapsTab campaignId={campaignId} />}
        {active === 'tokens' && <TokensTab />}
        {active === 'characters' && <CharactersTab />}
        {active === 'encounters' && <EncountersTab />}
        {active === 'log' && <LogTab />}
        {active === 'journal' && <JournalTab />}
        {active === 'settings' && <SettingsTab campaignId={campaignId} />}
      </div>
    </aside>
  );
}
