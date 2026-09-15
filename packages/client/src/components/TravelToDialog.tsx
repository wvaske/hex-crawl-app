import React from 'react';
import {
  CONTENT_TYPE_GLYPHS,
  exploredPassable,
  findRoute,
  formatDuration,
  hexDistance,
  hexKey,
  minutesPerHex,
  resolveTravelMode,
} from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { useUi } from '../stores/ui.js';
import { send } from '../ws.js';
import { Button, Dialog, EmptyNote, cx } from '../ui/kit.js';

/**
 * "Travel to…" (issue #130): pick a known settlement on the current map and
 * send the token there along the explored route. Players see the settlements
 * their character has located (that is all their snapshot holds); the DM sees
 * every enabled one. Each row says how far, whether an explored route exists
 * and roughly how long the walk is — the same numbers the readout shows for a
 * drag, without the drag.
 */
export function TravelToDialog() {
  const tokenId = useUi((s) => s.travelToTokenId)!;
  const setUi = useUi((s) => s.set);
  const state = useSession((s) => s.state);
  const role = useSession((s) => s.role);
  const map = activeMap(state);
  const close = () => setUi('travelToTokenId', null);

  if (!state?.mapState || !map) return null;
  const ms = state.mapState;
  const token = ms.tokens.find((t) => t.id === tokenId);
  if (!token) return null;

  const fog = new Map(ms.fog.map((f) => [hexKey(f.q, f.r), f.state]));
  const passable = exploredPassable((h) => fog.get(hexKey(h.q, h.r)));
  const time = state.campaign.time;
  const mode = resolveTravelMode(time.travelMode, state.campaign.settings.customTravelModes);
  const perHex = minutesPerHex(map.milesPerHex, mode, time.pace);

  const rows = ms.contents
    .filter((c) => c.type === 'settlement' && !('enabled' in c && !c.enabled))
    .filter((c) => !(c.q === token.q && c.r === token.r))
    .map((c) => {
      const dist = hexDistance(token, c);
      const route = map.routeExplored ? findRoute(token, c, passable) : null;
      return { content: c, dist, route };
    })
    .sort((a, b) => a.dist - b.dist);

  const go = (q: number, r: number) => {
    if (role !== 'dm' && map.moveApproval) {
      send({ kind: 'move.request', tokenId: token.id, q, r });
      useSession.getState().pushToast({
        kind: 'info',
        title: 'Travel declared',
        text: 'Waiting for the DM to resolve your move.',
      });
    } else {
      send({ kind: 'token.move', tokenId: token.id, q, r, teleport: false });
    }
    close();
  };

  return (
    <Dialog title={`Travel — ${token.label || 'token'}`} onClose={close}>
      <p className="text-xs text-ink-400 mb-2">
        Known settlements on this map, nearest first. A route follows explored hexes only; travel
        may halt for an encounter{state.campaign.settings.stopTravelAtNight ? ' or at nightfall' : ''}.
      </p>
      {rows.length === 0 && (
        <EmptyNote>
          {role === 'dm' ? 'No settlements on this map.' : "You don't know of any settlements here yet."}
        </EmptyNote>
      )}
      <ul className="space-y-1.5 max-h-[60dvh] overflow-y-auto">
        {rows.map(({ content, dist, route }) => {
          const hexes = route ? route.length - 1 : null;
          const canGo = hexes !== null || role === 'dm' || map.moveMode !== 'step' || dist <= 1;
          const eta = hexes !== null && perHex > 0 ? formatDuration(hexes * perHex) : null;
          return (
            <li
              key={content.id}
              className="flex items-center gap-2 bg-ink-850 border border-ink-700 rounded-md px-2.5 py-2"
            >
              <span className="text-base">{content.glyph || CONTENT_TYPE_GLYPHS[content.type]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-100 truncate">{content.title}</p>
                <p className="text-[11px] text-ink-400">
                  {dist} hex{dist === 1 ? '' : 'es'} away
                  {hexes !== null ? (
                    <span className="text-brass-300">
                      {' '}
                      · explored route {hexes} hex{hexes === 1 ? '' : 'es'}
                      {eta ? ` ≈ ${eta}` : ''}
                    </span>
                  ) : map.routeExplored ? (
                    <span className="text-ember-500"> · no explored route</span>
                  ) : null}
                </p>
              </div>
              <Button
                size="sm"
                variant={hexes !== null ? 'primary' : 'default'}
                disabled={!canGo}
                className={cx(!canGo && 'opacity-40')}
                title={
                  hexes !== null
                    ? 'Walk there along the explored route'
                    : canGo
                      ? 'No explored route — travels in a straight line'
                      : 'Step mode: reach it one hex at a time until a route is explored'
                }
                onClick={() => go(content.q, content.r)}
              >
                Go
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

/** Opens the picker for a token. Sits next to the send-to-hex 🎯 button. */
export function TravelToButton({ tokenId, name }: { tokenId: string; name: string }) {
  const setUi = useUi((s) => s.set);
  return (
    <button
      className="shrink-0 px-2 py-1 mr-1.5 rounded text-sm cursor-pointer text-ink-400 hover:text-brass-300"
      title={`Travel to a known settlement with ${name} (along explored hexes)`}
      onClick={(e) => {
        e.stopPropagation();
        setUi('travelToTokenId', tokenId);
      }}
    >
      🧭
    </button>
  );
}
