import React from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  TERRAINS,
  isFullContent,
  describeGate,
  hexKey,
  type Content,
  type ContentPlayerView,
  type FogState,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../../stores/session.js';
import { useUi } from '../../stores/ui.js';
import { send } from '../../ws.js';
import { Button, EmptyNote, Section, cx } from '../../ui/kit.js';

export function InspectTab() {
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const seatId = useSession((s) => s.seatId);
  const hex = useUi((s) => s.selectedHex);
  const setUi = useUi((s) => s.set);
  const map = activeMap(state);

  if (!state || !map || !state.mapState) {
    return <EmptyNote>No active map yet.</EmptyNote>;
  }
  if (!hex) {
    return (
      <EmptyNote>
        Click a hex on the map to inspect it{role === 'dm' ? ' and manage its contents' : ''}.
      </EmptyNote>
    );
  }

  const ms = state.mapState;
  const key = hexKey(hex.q, hex.r);
  const cell = ms.hexes.find((h) => hexKey(h.q, h.r) === key);
  const fog: FogState = ms.fog.find((f) => hexKey(f.q, f.r) === key)?.state ?? 'hidden';
  const tokens = ms.tokens.filter((t) => t.q === hex.q && t.r === hex.r);
  const markers = ms.markers.filter((m) => m.q === hex.q && m.r === hex.r);
  const contents = ms.contents.filter((c) => c.q === hex.q && c.r === hex.r);
  const isDm = role === 'dm';
  const myCharacterId = state.seats.find((s) => s.id === seatId)?.characterId ?? null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-semibold text-ink-100">
          Hex {hex.q}, {hex.r}
        </h2>
        <span className="text-xs text-ink-400">
          {cell ? TERRAINS[cell.terrain].label : 'Unpainted'}
        </span>
      </div>

      {isDm && (
        <Section title="Fog">
          <div className="flex gap-1">
            {(['visible', 'explored', 'hidden'] as FogState[]).map((s) => (
              <button
                key={s}
                onClick={() => send({ kind: 'fog.set', mapId: map.id, cells: [hex], state: s })}
                className={cx(
                  'flex-1 py-1 rounded text-xs capitalize cursor-pointer border',
                  fog === s
                    ? 'border-brass-500 bg-brass-500/15 text-brass-300'
                    : 'border-ink-700 hover:bg-ink-700 text-ink-200',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>
      )}

      {tokens.length > 0 && (
        <Section title="Tokens here">
          <ul className="space-y-1">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm text-ink-100">
                <span
                  className="w-4 h-4 rounded-full inline-block border border-white/40 shrink-0"
                  style={{ background: t.color }}
                />
                <span className="truncate">{t.label || '(unnamed)'}</span>
                <span className="text-xs text-ink-400">{t.kind.toUpperCase()}</span>
                {isDm && !t.playerVisible && t.kind === 'npc' && (
                  <span className="text-xs text-ember-500" title="Hidden from players">
                    hidden
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {markers.length > 0 && (
        <Section title="Markers">
          <ul className="space-y-1.5">
            {markers.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="text-base">{m.glyph}</span>
                <MarkerLabel markerId={m.id} label={m.label} editable={isDm} />
                {isDm && (
                  <>
                    <button
                      className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
                      title={m.dmOnly ? 'DM-only — click to share' : 'Visible to players — click to hide'}
                      onClick={() =>
                        send({ kind: 'marker.update', markerId: m.id, patch: { dmOnly: !m.dmOnly } })
                      }
                    >
                      {m.dmOnly ? '🚫' : '👁️'}
                    </button>
                    <button
                      className="text-xs text-ink-400 hover:text-ember-500 cursor-pointer ml-auto"
                      onClick={() => send({ kind: 'marker.delete', markerId: m.id })}
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Content"
        actions={
          isDm ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUi('contentDialogHex', hex);
                setUi('editingContentId', null);
              }}
            >
              + Add
            </Button>
          ) : undefined
        }
      >
        {contents.length === 0 && (
          <EmptyNote>{isDm ? 'Nothing here yet.' : 'Nothing you know of here.'}</EmptyNote>
        )}
        <div className="space-y-2">
          {contents.map((c) =>
            isFullContent(c) ? (
              <DmContentCard key={c.id} content={c} />
            ) : (
              <PlayerContentCard key={c.id} content={c} />
            ),
          )}
        </div>
      </Section>

      {!isDm && !myCharacterId && (
        <p className="text-xs text-ink-400 mt-4">
          Claim a character in the Party tab to make discoveries and move a token.
        </p>
      )}
    </div>
  );
}

function MarkerLabel({
  markerId,
  label,
  editable,
}: {
  markerId: string;
  label: string;
  editable: boolean;
}) {
  if (!editable) return <span className="text-ink-200 truncate">{label}</span>;
  return (
    <input
      className="bg-transparent border-b border-transparent focus:border-ink-600 focus:outline-none text-sm text-ink-200 min-w-0 flex-1"
      defaultValue={label}
      placeholder="label…"
      onBlur={(e) => {
        if (e.target.value !== label) {
          send({ kind: 'marker.update', markerId, patch: { label: e.target.value } });
        }
      }}
    />
  );
}

function DmContentCard({ content }: { content: Content }) {
  const state = useSession((s) => s.state);
  const setUi = useUi((s) => s.set);
  const discoveries = state?.discoveries ?? [];
  const characters = state?.characters ?? [];

  return (
    <div className="bg-ink-850 border border-ink-700 rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span>{content.glyph || CONTENT_TYPE_GLYPHS[content.type]}</span>
        <span className="font-medium text-sm text-ink-100 truncate flex-1">{content.title}</span>
        <button
          className="text-xs text-ink-400 hover:text-ink-100 cursor-pointer"
          onClick={() => {
            setUi('contentDialogHex', { q: content.q, r: content.r });
            setUi('editingContentId', content.id);
          }}
        >
          Edit
        </button>
      </div>
      {content.dmNotes && (
        <p className="text-xs text-ink-300 mt-1.5 whitespace-pre-wrap">{content.dmNotes}</p>
      )}
      {content.clues.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {content.clues.map((clue) => {
            const known = discoveries.filter((d) => d.clueId === clue.id);
            return (
              <li key={clue.id} className="text-xs border-t border-ink-700 pt-1.5">
                <p className="text-ink-200">{clue.text}</p>
                <p className="text-ink-400 mt-0.5">{describeGate(clue.gate)}</p>
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {known.map((d) => {
                    const ch = characters.find((c) => c.id === d.characterId);
                    return (
                      <span
                        key={d.id}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-ink-950 cursor-pointer"
                        style={{ background: ch?.color ?? '#888' }}
                        title={`Discovered — click to revoke`}
                        onClick={() => send({ kind: 'discovery.revoke', discoveryId: d.id })}
                      >
                        {ch?.name ?? '?'}
                      </span>
                    );
                  })}
                  <button
                    className="text-[10px] text-brass-400 hover:text-brass-300 cursor-pointer px-1"
                    onClick={() => send({ kind: 'clue.reveal', clueId: clue.id, characterIds: [] })}
                    title="Reveal to everyone"
                  >
                    Reveal to all
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlayerContentCard({ content }: { content: ContentPlayerView }) {
  return (
    <div className="bg-ink-850 border border-ink-700 rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        <span>{content.glyph || CONTENT_TYPE_GLYPHS[content.type]}</span>
        <span className="font-medium text-sm text-ink-100">{content.title}</span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {content.discoveredClues.map((c) => (
          <li key={c.clueId} className="text-xs text-ink-200">
            {c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
