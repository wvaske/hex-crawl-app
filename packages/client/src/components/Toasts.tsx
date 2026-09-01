import React from 'react';
import { useSession } from '../stores/session.js';
import { cx } from '../ui/kit.js';

const KIND_STYLE: Record<string, { icon: string; ring: string }> = {
  discovery: { icon: '👁️', ring: 'border-arcane-500/60' },
  narration: { icon: '📜', ring: 'border-brass-500/60' },
  info: { icon: 'ℹ️', ring: 'border-ink-600' },
  error: { icon: '⚠️', ring: 'border-ember-500/60' },
};

export function Toasts() {
  const toasts = useSession((s) => s.toasts);
  const dismiss = useSession((s) => s.dismissToast);
  if (!toasts.length) return null;
  // Compact stack in the bottom-right corner, clear of the panel rail (#61);
  // never covers the middle of the map.
  const visible = toasts.slice(-3);
  const hidden = toasts.length - visible.length;
  return (
    // On a phone the panel rail is a bottom tab bar, so toasts clear it there
    // instead of clearing the side rail (issue #75).
    <div className="absolute bottom-20 right-2 md:bottom-2 md:right-16 z-40 flex flex-col gap-1.5 w-[19rem] max-w-[calc(100%-1rem)] pointer-events-none">
      {hidden > 0 && (
        <p className="text-[10px] text-ink-400 text-right pr-1">+{hidden} more…</p>
      )}
      {visible.map((t) => {
        const style = KIND_STYLE[t.kind] ?? KIND_STYLE.info!;
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              'pointer-events-auto text-left bg-ink-850/95 border rounded-md px-2.5 py-1.5 shadow-lg backdrop-blur cursor-pointer',
              'hover:bg-ink-800 transition-colors',
              style.ring,
            )}
          >
            <div className="flex items-start gap-2">
              <span className="text-sm leading-none mt-0.5">{style.icon}</span>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-ink-400 font-semibold truncate">
                  {t.title}
                </p>
                <p className="text-xs text-ink-100 mt-0.5 line-clamp-2">{t.text}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
