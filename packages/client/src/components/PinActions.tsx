import React from 'react';
import { hexKey, isFullContent, CONTENT_TYPE_GLYPHS, type FogState } from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { cx } from '../ui/kit.js';
import { wikiHref } from './panels/InspectTab.js';

/**
 * DM quick actions floating above a clicked pin: enable/disable, fog state,
 * move, wiki. Tracks the hex as the map pans and zooms.
 */
export function PinActions() {
  const role = useSession((s) => s.role);
  const state = useSession((s) => s.state);
  const hex = useUi((s) => s.selectedHex);
  const pos = useUi((s) => s.pinPopup);
  const map = activeMap(state);

  if (role !== 'dm' || !hex || !pos || !map || !state?.mapState) return null;
  const contents = state.mapState.contents
    .filter(isFullContent)
    .filter((c) => c.q === hex.q && c.r === hex.r);
  if (contents.length === 0) return null;

  const key = hexKey(hex.q, hex.r);
  const fog: FogState = state.mapState.fog.find((f) => hexKey(f.q, f.r) === key)?.state ?? 'hidden';
  const wikiBase = state.campaign.settings.wikiBaseUrl ?? '';

  return (
    <div
      className="absolute z-30 -translate-x-1/2 -translate-y-full flex flex-col items-center gap-1 pointer-events-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {contents.map((c) => (
        <div
          key={c.id}
          className="pointer-events-auto bg-ink-900/95 border border-ink-700 rounded-lg shadow-xl backdrop-blur px-1.5 py-1 flex items-center gap-1"
        >
          <span className="text-xs text-ink-300 max-w-28 truncate pl-1" title={c.title}>
            {c.glyph || CONTENT_TYPE_GLYPHS[c.type]} {c.title}
          </span>
          <button
            className={cx(
              'px-1.5 py-0.5 rounded text-[11px] cursor-pointer',
              c.enabled ? 'text-brass-300 hover:bg-ink-700' : 'text-ink-400 hover:bg-ink-700',
            )}
            title={c.enabled ? 'Live for players — click to disable' : 'Disabled — click to enable'}
            onClick={() =>
              send({ kind: 'content.setEnabled', contentIds: [c.id], enabled: !c.enabled })
            }
          >
            {c.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            className={cx(
              'px-1.5 py-0.5 rounded text-[11px] cursor-pointer whitespace-nowrap',
              c.knownLocation ? 'bg-brass-500/25 text-brass-300' : 'text-ink-300 hover:bg-ink-700',
            )}
            title={
              c.knownLocation
                ? 'Players see this pin (location is common knowledge) — click to make it discovery-gated again'
                : 'Show the pin to players: they learn WHERE it is, but clues stay gated'
            }
            onClick={() =>
              send({
                kind: 'content.upsert',
                content: {
                  id: c.id,
                  mapId: c.mapId,
                  q: c.q,
                  r: c.r,
                  type: c.type,
                  title: c.title,
                  dmNotes: c.dmNotes,
                  glyph: c.glyph,
                  showLabel: c.showLabel,
                  scaleVisibility: c.scaleVisibility,
                  wikiPage: c.wikiPage,
                  enabled: c.enabled,
                  knownLocation: !c.knownLocation,
                  quest: c.quest,
                  clues: c.clues.map((cl) => ({
                    id: cl.id,
                    text: cl.text,
                    gate: cl.gate,
                    sortOrder: cl.sortOrder,
                    indicatesDirection: cl.indicatesDirection,
                    revealsLocation: cl.revealsLocation,
                  })),
                },
              })
            }
          >
            {c.knownLocation ? 'Known ✓' : 'Show players'}
          </button>
          <span className="w-px h-4 bg-ink-700" />
          {(['visible', 'explored', 'hidden'] as FogState[]).map((s) => (
            <button
              key={s}
              className={cx(
                'px-1.5 py-0.5 rounded text-[11px] capitalize cursor-pointer',
                fog === s ? 'bg-brass-500/25 text-brass-300' : 'text-ink-300 hover:bg-ink-700',
              )}
              title={`Set this hex's fog to ${s}`}
              onClick={() => send({ kind: 'fog.set', mapId: map.id, cells: [hex], state: s })}
            >
              {s}
            </button>
          ))}
          <span className="w-px h-4 bg-ink-700" />
          <button
            className="px-1.5 py-0.5 rounded text-[11px] cursor-pointer text-ink-300 hover:bg-ink-700"
            title="Move: click the destination hex"
            onClick={() => {
              useUi.getState().set('movingContentId', c.id);
              useSession.getState().pushToast({
                kind: 'info',
                title: `Moving ${c.title}`,
                text: 'Click the destination hex — Esc cancels.',
              });
            }}
          >
            Move
          </button>
          <button
            className="px-1.5 py-0.5 rounded text-[11px] cursor-pointer text-ink-300 hover:bg-ink-700"
            title="Everything about this location: clues, visits, wiki page"
            onClick={() => useUi.getState().set('locationDialogContentId', c.id)}
          >
            More…
          </button>
          {c.wikiPage ? (
            <a
              className="px-1.5 py-0.5 rounded text-xs cursor-pointer text-arcane-500 hover:bg-ink-700"
              href={wikiHref(c.wikiPage, wikiBase)}
              target="_blank"
              rel="noreferrer"
              title={`Open wiki: ${c.wikiPage}`}
            >
              Wiki
            </a>
          ) : (
            <span className="px-1.5 py-0.5 text-[11px] text-ink-600" title="No wiki page set">
              Wiki
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
