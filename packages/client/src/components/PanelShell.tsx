import React from 'react';
import { useSession } from '../stores/session.js';
import {
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  persistPanelWidth,
  useUi,
  type PanelId,
} from '../stores/ui.js';
import { Button, cx } from '../ui/kit.js';
import { CharacterDialog } from './CharacterDialog.js';
import { InspectTab } from './panels/InspectTab.js';
import { MapsTab } from './panels/MapsTab.js';
import { CharactersTab } from './panels/CharactersTab.js';
import { TokensTab } from './panels/TokensTab.js';
import { EncountersTab } from './panels/EncountersTab.js';
import { LogTab } from './panels/LogTab.js';
import { JournalTab } from './panels/JournalTab.js';
import { SensesTab } from './panels/SensesTab.js';
import { SettingsTab } from './panels/SettingsTab.js';

/**
 * The right-hand shell (issue #61). A permanent icon rail on the screen edge
 * lists a handful of task-shaped headings; clicking one pops its panel out
 * from the side, clicking another swaps it, clicking the open one closes it.
 *
 * Panels are *compositions* of the existing panel components — the shell
 * decides what belongs together, the components keep owning their content.
 */

const PANEL_META: Record<PanelId, { icon: string; label: string; title: string; hint: string }> = {
  information: {
    icon: '🔍',
    label: 'Info',
    title: 'Information',
    hint: 'The hex you clicked, and what you can sense from where you stand',
  },
  character: {
    icon: '🧝',
    label: 'Party',
    title: 'Character',
    hint: 'Your character sheet and the rest of the party',
  },
  history: {
    icon: '📜',
    label: 'History',
    title: 'History',
    hint: 'What you have learned so far, and everything that has happened',
  },
  build: {
    icon: '🛠️',
    label: 'Build',
    title: 'Build',
    hint: 'Prep: maps, tokens and encounter tables',
  },
  setup: {
    icon: '⚙️',
    label: 'Setup',
    title: 'Setup',
    hint: 'Campaign settings, players and integrations',
  },
};

const PLAYER_PANELS: PanelId[] = ['information', 'character', 'history'];
const DM_PANELS: PanelId[] = ['information', 'character', 'history', 'build', 'setup'];

export function PanelShell({ campaignId }: { campaignId: string }) {
  const role = useSession((s) => s.role);
  const open = useUi((s) => s.openPanel);
  const width = useUi((s) => s.panelWidth);
  const setUi = useUi((s) => s.set);
  const panels = role === 'dm' ? DM_PANELS : PLAYER_PANELS;
  // A player who somehow holds a DM-only panel id (role flipped on rejoin)
  // must not end up staring at an empty shell.
  const active = open && panels.includes(open) ? open : null;

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
    <>
      {active && (
        <aside
          style={{ width }}
          className="relative shrink-0 bg-ink-900 border-l border-ink-700 flex flex-col z-20"
        >
          <div
            onPointerDown={startResize}
            className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-0.5 cursor-col-resize z-30 hover:bg-brass-500/40 active:bg-brass-500/60"
            title="Drag to resize the panel"
          />
          <header className="flex items-center gap-2 px-3 py-2 border-b border-ink-700 shrink-0">
            <span className="text-base leading-none">{PANEL_META[active].icon}</span>
            <h2 className="text-sm font-semibold text-ink-100 flex-1 truncate">
              {PANEL_META[active].title}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="!px-1.5"
              onClick={() => setUi('openPanel', null)}
              title="Close this panel"
              aria-label="Close panel"
            >
              ✕
            </Button>
          </header>
          <div className="flex-1 min-h-0 flex flex-col">
            {active === 'information' && <InformationPanel />}
            {active === 'character' && <CharacterPanel />}
            {active === 'history' && <HistoryPanel />}
            {active === 'build' && <BuildPanel campaignId={campaignId} />}
            {active === 'setup' && <SetupPanel campaignId={campaignId} />}
          </div>
        </aside>
      )}

      <nav
        className="shrink-0 w-14 bg-ink-900 border-l border-ink-700 flex flex-col items-stretch py-1 gap-0.5 z-20"
        aria-label="Panels"
      >
        {panels.map((id) => {
          const meta = PANEL_META[id];
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => setUi('openPanel', isActive ? null : id)}
              title={isActive ? `Close ${meta.title}` : `${meta.title} — ${meta.hint}`}
              aria-pressed={isActive}
              className={cx(
                'flex flex-col items-center gap-0.5 py-2 cursor-pointer transition-colors border-r-2',
                isActive
                  ? 'border-brass-500 bg-ink-850 text-brass-300'
                  : 'border-transparent text-ink-400 hover:bg-ink-850/60 hover:text-ink-100',
              )}
            >
              <span className="text-base leading-none">{meta.icon}</span>
              <span className="text-[10px] font-medium leading-none">{meta.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

/** The scrolling body every panel shares. */
function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>;
}

/** A pill row for panels that hold more than one view. */
function SubTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: string; title?: string }[];
}) {
  return (
    <div className="flex gap-1 px-3 pt-3 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.title}
          className={cx(
            'px-2.5 py-0.5 rounded-full text-[11px] cursor-pointer border transition-colors',
            value === t.id
              ? 'border-brass-500 bg-brass-500/15 text-brass-300'
              : 'border-ink-700 text-ink-300 hover:bg-ink-700',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Information = the old Inspect tab, plus (for players) their senses in the
 * same scroll. Both answer "what is around me right now?", and splitting them
 * across tabs meant a player watching for a smell had to leave the hex they
 * were reading about.
 */
function InformationPanel() {
  const role = useSession((s) => s.role);
  return (
    <PanelBody>
      <InspectTab />
      {role === 'player' && (
        <div className="mt-5 pt-4 border-t border-ink-700">
          <h3 className="text-sm font-semibold text-ink-100 mb-2">👁️ Your senses</h3>
          <SensesTab />
        </div>
      )}
    </PanelBody>
  );
}

/**
 * Character leads with the one thing a player wants from it — their own sheet
 * — and keeps the full party roster (claim, roll, edit, send token) below.
 */
function CharacterPanel() {
  const state = useSession((s) => s.state);
  const seatId = useSession((s) => s.seatId);
  const role = useSession((s) => s.role);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const myCharacterId = state?.seats.find((s) => s.id === seatId)?.characterId ?? null;
  const mine = state?.characters.find((c) => c.id === myCharacterId) ?? null;

  return (
    <PanelBody>
      {mine ? (
        <Button
          variant="primary"
          size="sm"
          className="w-full mb-3"
          onClick={() => setSheetOpen(true)}
          title="Bio, appearance, goals, inventory, skills"
        >
          📜 Open {mine.name}'s sheet
        </Button>
      ) : (
        role === 'player' && (
          <p className="text-xs text-ink-400 mb-3">
            Claim a character below to play — your sheet opens from here afterwards.
          </p>
        )
      )}
      <CharactersTab />
      {sheetOpen && mine && (
        <CharacterDialog character={mine} onClose={() => setSheetOpen(false)} />
      )}
    </PanelBody>
  );
}

/**
 * History = "what have we learned" (the journal, with its previously-on card,
 * party notes and tracks) next to "what happened" (the log, which carries its
 * own recaps view). The DM has no journal — their contents are never the
 * player-filtered views the journal renders — so they get the log directly.
 */
function HistoryPanel() {
  const role = useSession((s) => s.role);
  const isDm = role === 'dm';
  const [tab, setTab] = React.useState<'journal' | 'log'>(isDm ? 'log' : 'journal');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {!isDm && (
        <SubTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'journal', label: '📔 Journal', title: 'Discoveries, party notes and tracks' },
            { id: 'log', label: '📜 Log', title: 'Everything that happened, and session recaps' },
          ]}
        />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'journal' && !isDm ? <JournalTab /> : <LogTab />}
      </div>
    </div>
  );
}

/** Build = the DM's prep bench: maps (and the map manager), tokens, encounters. */
function BuildPanel({ campaignId }: { campaignId: string }) {
  const [tab, setTab] = React.useState<'maps' | 'tokens' | 'encounters'>('maps');
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'maps', label: '🗺️ Maps', title: 'Maps, images and the map manager' },
          { id: 'tokens', label: '♟️ Tokens', title: 'Party tokens, NPCs and monsters' },
          { id: 'encounters', label: '🎲 Encounters', title: 'Encounter tables and rolls' },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'maps' && <MapsTab campaignId={campaignId} />}
        {tab === 'tokens' && <TokensTab />}
        {tab === 'encounters' && <EncountersTab />}
      </div>
    </div>
  );
}

function SetupPanel({ campaignId }: { campaignId: string }) {
  return (
    <PanelBody>
      <SettingsTab campaignId={campaignId} />
    </PanelBody>
  );
}
