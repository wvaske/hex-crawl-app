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
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-col gap-2 w-full max-w-md px-4">
      {toasts.map((t) => {
        const style = KIND_STYLE[t.kind] ?? KIND_STYLE.info!;
        return (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              'text-left bg-ink-850/95 border rounded-lg px-4 py-3 shadow-xl backdrop-blur cursor-pointer',
              'hover:bg-ink-800 transition-colors animate-[toast-in_0.25s_ease-out]',
              style.ring,
            )}
          >
            <div className="flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{style.icon}</span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-ink-400 font-semibold">
                  {t.title}
                </p>
                <p className="text-sm text-ink-100 mt-0.5">{t.text}</p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
