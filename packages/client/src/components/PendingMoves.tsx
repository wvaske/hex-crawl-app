import React from 'react';
import { hexDistance } from '@hexcrawl/shared';
import { activeMap, useSession } from '../stores/session.js';
import { send } from '../ws.js';

/** DM strip listing declared player moves with approve/deny controls. */
export function PendingMoves() {
  const role = useSession((s) => s.role);
  const state = useSession((s) => s.state);
  const map = activeMap(state);
  if (role !== 'dm' || !state?.mapState) return null;
  const pending = state.mapState.pendingMoves;
  if (!pending.length) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex flex-col gap-1.5 max-w-md w-full px-4">
      {pending.map((pm) => {
        const dist = hexDistance({ q: pm.fromQ, r: pm.fromR }, { q: pm.toQ, r: pm.toR });
        return (
          <div
            key={pm.tokenId}
            className="flex items-center gap-2.5 bg-ink-900/95 border border-brass-500/50 rounded-lg px-3 py-2 shadow-xl backdrop-blur"
          >
            <span
              className="w-4 h-4 rounded-full shrink-0 border border-white/40"
              style={{ background: pm.color }}
            />
            <span className="text-sm text-ink-100 min-w-0 flex-1 truncate">
              <span className="font-medium">{pm.label}</span> wants to travel to{' '}
              <span className="text-brass-300">
                {pm.toQ}, {pm.toR}
              </span>
              {map && (
                <span className="text-ink-400"> ({dist} hexes ≈ {Math.round(dist * map.milesPerHex)} mi)</span>
              )}
            </span>
            <button
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-moss-500/20 text-moss-500 border border-moss-500/50 hover:bg-moss-500/35 cursor-pointer"
              onClick={() => send({ kind: 'move.resolve', tokenId: pm.tokenId, approve: true, teleport: false })}
              title="Approve: the move happens, the trail is explored, discoveries fire"
            >
              ✓ Approve
            </button>
            <button
              className="px-2 py-1 rounded-md text-xs font-medium bg-arcane-500/15 text-arcane-500 border border-arcane-500/40 hover:bg-arcane-500/30 cursor-pointer"
              onClick={() => send({ kind: 'move.resolve', tokenId: pm.tokenId, approve: true, teleport: true })}
              title="Teleport: the move happens instantly with no explored trail along the path"
            >
              ⚡
            </button>
            <button
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-ember-500/15 text-ember-500 border border-ember-500/40 hover:bg-ember-500/30 cursor-pointer"
              onClick={() => send({ kind: 'move.resolve', tokenId: pm.tokenId, approve: false, teleport: false })}
              title="Hold: the token stays put (roll an encounter first if something intervenes)"
            >
              ✗ Hold
            </button>
          </div>
        );
      })}
    </div>
  );
}
