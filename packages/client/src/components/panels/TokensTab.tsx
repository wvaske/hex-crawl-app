import React, { useState } from 'react';
import type { Token } from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Field, Input, Section, Toggle } from '../../ui/kit.js';

export function TokensTab() {
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  const selectedHex = useUi((s) => s.selectedHex);

  if (!state || !map || !state.mapState) return <EmptyNote>No active map.</EmptyNote>;
  const tokens = state.mapState.tokens;
  const spawnAt = selectedHex ?? { q: 0, r: 0 };

  const charactersWithoutToken = state.characters.filter(
    (ch) => !tokens.some((t) => t.characterId === ch.id),
  );

  return (
    <div>
      {charactersWithoutToken.length > 0 && (
        <Section title="Party tokens">
          <p className="text-xs text-ink-400 mb-2">
            Drop a token for each character{selectedHex ? ` at hex ${spawnAt.q}, ${spawnAt.r}` : ' (select a hex first to choose where)'}
            .
          </p>
          <div className="space-y-1.5">
            {charactersWithoutToken.map((ch) => (
              <Button
                key={ch.id}
                size="sm"
                className="w-full justify-start"
                onClick={() =>
                  send({
                    kind: 'token.create',
                    mapId: map.id,
                    q: spawnAt.q,
                    r: spawnAt.r,
                    tokenKind: 'pc',
                    characterId: ch.id,
                    label: ch.name,
                    color: ch.color,
                    glyph: ch.glyph,
                    playerVisible: true,
                  })
                }
              >
                <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ background: ch.color }} />
                Place {ch.name}
              </Button>
            ))}
          </div>
        </Section>
      )}

      <NpcCreator mapId={map.id} q={spawnAt.q} r={spawnAt.r} hasHex={!!selectedHex} />

      <Section title="Tokens on this map">
        {tokens.length === 0 && <EmptyNote>None yet.</EmptyNote>}
        <div className="space-y-1.5">
          {tokens.map((t) => (
            <TokenRow key={t.id} token={t} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function NpcCreator({ mapId, q, r, hasHex }: { mapId: string; q: number; r: number; hasHex: boolean }) {
  const [label, setLabel] = useState('');
  const [visible, setVisible] = useState(true);

  const create = () => {
    if (!label.trim()) return;
    send({
      kind: 'token.create',
      mapId,
      q,
      r,
      tokenKind: 'npc',
      characterId: null,
      label: label.trim(),
      color: '#8d4a4a',
      glyph: '',
      playerVisible: visible,
    });
    setLabel('');
  };

  return (
    <Section title="New NPC / monster token">
      <div className="space-y-2">
        <div className="flex gap-1.5">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Green dragon"
            maxLength={60}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <Button size="sm" onClick={create} disabled={!label.trim()}>
            +
          </Button>
        </div>
        <Toggle checked={visible} onChange={setVisible} label="Visible to players" />
        {!hasHex && <p className="text-xs text-ink-400">Tip: select a hex first to spawn it there.</p>}
      </div>
    </Section>
  );
}

function TokenRow({ token }: { token: Token }) {
  const setUi = useUi((s) => s.set);
  return (
    <div className="flex items-center gap-2 bg-ink-850 border border-ink-700 rounded-md px-2 py-1.5">
      <span
        className="w-4 h-4 rounded-full shrink-0 border border-white/30"
        style={{ background: token.color }}
      />
      <button
        className="text-sm text-ink-100 truncate flex-1 text-left cursor-pointer hover:text-brass-300"
        onClick={() => {
          setUi('selectedHex', { q: token.q, r: token.r });
          setUi('selectedTokenId', token.id);
          setUi('panelTab', 'inspect');
        }}
        title="Jump to token"
      >
        {token.label || '(unnamed)'}
        <span className="text-ink-400 text-xs ml-1.5">
          {token.q},{token.r}
        </span>
      </button>
      <button
        className={`text-xs cursor-pointer ${token.partyId ? '' : 'opacity-35 grayscale'}`}
        title={
          token.partyId
            ? 'In the party — moves with the group. Click to detach.'
            : 'Solo — click to add to the party (party members move together).'
        }
        onClick={() =>
          send({
            kind: 'token.update',
            tokenId: token.id,
            patch: { partyId: token.partyId ? null : 'party' },
          })
        }
      >
        🧭
      </button>
      {token.kind === 'npc' && (
        <button
          className="text-xs cursor-pointer"
          title={token.playerVisible ? 'Players see this — click to hide' : 'Hidden — click to reveal'}
          onClick={() =>
            send({ kind: 'token.update', tokenId: token.id, patch: { playerVisible: !token.playerVisible } })
          }
        >
          {token.playerVisible ? '👁️' : '🚫'}
        </button>
      )}
      <input
        type="color"
        className="w-5 h-5 rounded cursor-pointer bg-transparent border-0"
        value={token.color}
        title="Token color"
        onChange={(e) =>
          send({ kind: 'token.update', tokenId: token.id, patch: { color: e.target.value } })
        }
      />
      <button
        className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer"
        onClick={() => send({ kind: 'token.delete', tokenId: token.id })}
        title="Remove token"
      >
        ✕
      </button>
    </div>
  );
}
