import { useState } from 'react';
import { TERRAIN_COLORS, parseHexKey } from '@hex-crawl/shared';
import { axialToOffset } from '../hex/coordinates';
import type { TerrainType, Token } from '@hex-crawl/shared';
import { useUIStore } from '../stores/useUIStore';
import type { SidePanelTab } from '../stores/useUIStore';
import { useMapStore } from '../stores/useMapStore';
import { TerrainPalette } from './TerrainPalette';
import { CreationDialog } from './CreationDialog';
import { ImportExportDialog } from './ImportExportDialog';
import { FogControls } from './FogControls';
import { ImageLayerPanel } from './ImageLayerPanel';
import { useSessionStore } from '../stores/useSessionStore';
import { useTokenStore } from '../stores/useTokenStore';

const BASE_TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'create', label: 'Create' },
  { id: 'import-export', label: 'Import/Export' },
];

// Common RPG emoji for token icons
const TOKEN_ICONS = [
  '\u2694\uFE0F', '\u{1F6E1}\uFE0F', '\u{1F9D9}', '\u{1F9DD}', '\u{1F9DF}', '\u{1F409}',
  '\u{1F43A}', '\u{1F480}', '\u{1F451}', '\u{1F9B9}', '\u{1F9DA}', '\u{1F9DC}',
  '\u{1F3F9}', '\u{1FA84}', '\u{1F40D}', '\u{1F577}\uFE0F',
];

// Preset token colors
const TOKEN_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
];

/**
 * Hex info display when one or more hexes are selected.
 */
function HexInfoContent() {
  const selectedHexes = useUIStore((s) => s.selectedHexes);
  const hexes = useMapStore((s) => s.hexes);
  const mapName = useMapStore((s) => s.mapName);
  const userRole = useSessionStore((s) => s.userRole);
  const revealedHexKeys = useSessionStore((s) => s.revealedHexKeys);
  const adjacentHexKeys = useSessionStore((s) => s.adjacentHexKeys);

  if (selectedHexes.size === 0) {
    return (
      <div className="p-4">
        {mapName ? (
          <>
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
              Map: {mapName}
            </h3>
            <p className="text-sm text-gray-500 italic">
              Click a hex to select it.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No map loaded. Use the Create tab to generate a new map.
          </p>
        )}
      </div>
    );
  }

  if (selectedHexes.size === 1) {
    const key = [...selectedHexes][0]!;
    const hex = hexes.get(key);
    const coord = parseHexKey(key);
    const offset = axialToOffset(coord.q, coord.r);
    const isVisible = userRole === 'dm' || revealedHexKeys.has(key) || adjacentHexKeys.has(key);
    if (!hex || !isVisible) {
      return (
        <div className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Hex Info
          </h3>
          <div>
            <span className="text-xs text-gray-500">Coordinates</span>
            <p className="text-gray-200 font-mono">
              {offset.col + 1}, {offset.row + 1}
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-500">Terrain</span>
            <p className="text-gray-400 italic mt-1">Empty (no terrain)</p>
          </div>
        </div>
      );
    }
    return (
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Hex Info
        </h3>

        {/* Coordinates */}
        <div>
          <span className="text-xs text-gray-500">Coordinates</span>
          <p className="text-gray-200 font-mono">
            {offset.col + 1}, {offset.row + 1}
          </p>
        </div>

        {/* Terrain type with color swatch */}
        <div>
          <span className="text-xs text-gray-500">Terrain</span>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="w-5 h-5 rounded-sm border border-gray-500"
              style={{ backgroundColor: TERRAIN_COLORS[hex.terrain] }}
            />
            <span className="text-gray-200 capitalize">{hex.terrain}</span>
          </div>
        </div>

        {/* Terrain variant */}
        <div>
          <span className="text-xs text-gray-500">Variant</span>
          <p className="text-gray-200">{hex.terrainVariant}</p>
        </div>
      </div>
    );
  }

  // Multiple hexes selected
  const terrainCounts = new Map<TerrainType, number>();
  let emptyCount = 0;
  for (const key of selectedHexes) {
    const hex = hexes.get(key);
    if (hex) {
      terrainCounts.set(hex.terrain, (terrainCounts.get(hex.terrain) ?? 0) + 1);
    } else {
      emptyCount++;
    }
  }

  // All selected hexes are empty
  if (emptyCount === selectedHexes.size) {
    return (
      <div className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Selection
        </h3>
        <p className="text-gray-200">
          {selectedHexes.size} hexes selected
        </p>
        <p className="text-gray-400 italic">All hexes empty</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Selection
      </h3>
      <p className="text-gray-200">
        {selectedHexes.size} hexes selected
      </p>

      <div>
        <span className="text-xs text-gray-500">Terrain Breakdown</span>
        <ul className="mt-1 space-y-1">
          {[...terrainCounts.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([terrain, count]) => (
              <li key={terrain} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm border border-gray-500"
                  style={{ backgroundColor: TERRAIN_COLORS[terrain] }}
                />
                <span className="text-gray-300 capitalize text-sm">
                  {terrain}: {count}
                </span>
              </li>
            ))}
          {emptyCount > 0 && (
            <li className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm border border-gray-500"
                style={{ backgroundColor: '#374151' }}
              />
              <span className="text-gray-400 italic text-sm">
                empty: {emptyCount}
              </span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token Management Tab (DM only)
// ---------------------------------------------------------------------------

function TokenCreationForm() {
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState(TOKEN_ICONS[0]!);
  const [color, setColor] = useState(TOKEN_COLORS[0]!);
  const [tokenType, setTokenType] = useState<'pc' | 'npc'>('npc');
  const [ownerId, setOwnerId] = useState('');

  const sendMessage = useSessionStore((s) => s.sendMessage);
  const selectedHexes = useUIStore((s) => s.selectedHexes);
  const connectedPlayers = useSessionStore((s) => s.connectedPlayers);

  const selectedHexKey = selectedHexes.size === 1 ? [...selectedHexes][0]! : null;

  const handleCreate = () => {
    if (!sendMessage || !selectedHexKey || !label.trim()) return;
    sendMessage({
      type: 'token:create',
      hexKey: selectedHexKey,
      label: label.trim(),
      icon,
      color,
      tokenType,
      ...(tokenType === 'pc' && ownerId ? { ownerId } : {}),
    });
    setLabel('');
  };

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Create Token
      </h4>

      {/* Label */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Name</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Goblin Guard"
          className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Icon picker */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Icon</label>
        <div className="grid grid-cols-8 gap-1">
          {TOKEN_ICONS.map((ic) => (
            <button
              key={ic}
              onClick={() => setIcon(ic)}
              className={`w-8 h-8 flex items-center justify-center rounded text-lg ${
                icon === ic
                  ? 'bg-blue-600 ring-1 ring-blue-400'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Color</label>
        <div className="flex gap-1">
          {TOKEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 ${
                color === c ? 'border-white' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Token type toggle */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Type</label>
        <div className="flex gap-1">
          <button
            onClick={() => setTokenType('pc')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded ${
              tokenType === 'pc'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            PC
          </button>
          <button
            onClick={() => setTokenType('npc')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded ${
              tokenType === 'npc'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            NPC
          </button>
        </div>
      </div>

      {/* Player assignment (PC only) */}
      {tokenType === 'pc' && (
        <div>
          <label className="text-xs text-gray-500 block mb-1">Assign to Player</label>
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">-- Unassigned --</option>
            {[...connectedPlayers.values()].map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Place button */}
      <button
        onClick={handleCreate}
        disabled={!selectedHexKey || !label.trim() || !sendMessage}
        className="w-full px-3 py-2 text-sm font-medium rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {selectedHexKey ? 'Place Token' : 'Select a hex first'}
      </button>
    </div>
  );
}

function TokenList() {
  const tokens = useTokenStore((s) => s.tokens);
  const sendMessage = useSessionStore((s) => s.sendMessage);

  const tokenArray = [...tokens.values()];

  if (tokenArray.length === 0) {
    return (
      <p className="text-sm text-gray-500 italic">No tokens placed yet.</p>
    );
  }

  const handleToggleVisibility = (token: Token) => {
    if (!sendMessage) return;
    sendMessage({
      type: 'token:update',
      tokenId: token.id,
      updates: { visible: !token.visible },
    });
  };

  const handleDelete = (tokenId: string) => {
    if (!sendMessage) return;
    sendMessage({
      type: 'token:delete',
      tokenId,
    });
  };

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Token List
      </h4>
      {tokenArray.map((token) => (
        <div
          key={token.id}
          className="flex items-center gap-2 px-2 py-1.5 bg-gray-700/50 rounded text-sm"
        >
          {/* Icon */}
          <span className="text-base">{token.icon}</span>
          {/* Color dot */}
          <span
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: token.color }}
          />
          {/* Label */}
          <span className="text-gray-200 truncate flex-1">{token.label}</span>
          {/* Type badge */}
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase ${
              token.tokenType === 'pc'
                ? 'bg-blue-600/30 text-blue-300'
                : 'bg-orange-600/30 text-orange-300'
            }`}
          >
            {token.tokenType}
          </span>
          {/* Visibility toggle */}
          <button
            onClick={() => handleToggleVisibility(token)}
            className={`text-xs px-1 ${
              token.visible ? 'text-gray-300 hover:text-gray-100' : 'text-gray-600 hover:text-gray-400'
            }`}
            title={token.visible ? 'Hide token' : 'Show token'}
          >
            {token.visible ? '\u{1F441}' : '\u{1F441}\u200D\u{1F5E8}'}
          </button>
          {/* Delete */}
          <button
            onClick={() => handleDelete(token.id)}
            className="text-xs text-red-500 hover:text-red-400 px-1"
            title="Delete token"
          >
            X
          </button>
        </div>
      ))}
    </div>
  );
}

function TokenManagement() {
  return (
    <div className="p-4 space-y-4">
      <TokenCreationForm />
      <hr className="border-gray-700" />
      <TokenList />
    </div>
  );
}

/**
 * Right-side panel showing hex info, terrain palette, creation dialog,
 * and import/export functionality. Always visible with tab navigation.
 */
export function SidePanel() {
  const activeTab = useUIStore((s) => s.sidePanel);
  const setSidePanel = useUIStore((s) => s.setSidePanel);
  const userRole = useSessionStore((s) => s.userRole);

  // DM gets Fog and Tokens tabs
  const tabs = userRole === 'dm'
    ? [
        ...BASE_TABS,
        { id: 'fog' as SidePanelTab, label: 'Fog' },
        { id: 'tokens' as SidePanelTab, label: 'Tokens' },
        { id: 'images' as SidePanelTab, label: 'Images' },
      ]
    : BASE_TABS;

  return (
    <div className="w-[300px] h-full bg-gray-800 border-l border-gray-700 flex flex-col shrink-0">
      {/* Tab buttons — wrap to multiple rows when needed */}
      <div className="flex flex-wrap border-b border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidePanel(tab.id)}
            className={`
              px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap
              ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-750'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'info' && <HexInfoContent />}
        {activeTab === 'terrain' && <TerrainPalette />}
        {activeTab === 'create' && <CreationDialog />}
        {activeTab === 'import-export' && <ImportExportDialog />}
        {activeTab === 'fog' && <FogControls />}
        {activeTab === 'tokens' && <TokenManagement />}
        {activeTab === 'images' && <ImageLayerPanel />}
      </div>
    </div>
  );
}
