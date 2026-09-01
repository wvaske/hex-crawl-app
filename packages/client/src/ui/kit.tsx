import React from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
        variant === 'default' &&
          'bg-ink-700 hover:bg-ink-600 text-ink-100 border border-ink-600',
        variant === 'primary' &&
          'bg-brass-500 hover:bg-brass-400 text-ink-950 border border-brass-400',
        variant === 'danger' && 'bg-ember-500/20 hover:bg-ember-500/35 text-ember-500 border border-ember-500/40',
        variant === 'ghost' && 'hover:bg-ink-700/60 text-ink-300 hover:text-ink-100',
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'w-full rounded-md bg-ink-900 border border-ink-600 px-2.5 py-1.5 text-sm text-ink-100',
        'placeholder:text-ink-400 focus:outline-none focus:border-brass-500',
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'w-full rounded-md bg-ink-900 border border-ink-600 px-2.5 py-1.5 text-sm text-ink-100',
        'placeholder:text-ink-400 focus:outline-none focus:border-brass-500 resize-y',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'w-full rounded-md bg-ink-900 border border-ink-600 px-2 py-1.5 text-sm text-ink-100',
        'focus:outline-none focus:border-brass-500 cursor-pointer',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('block text-[11px] uppercase tracking-wider text-ink-400 mb-1', className)}>
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-ink-200 cursor-pointer group"
    >
      <span
        className={cx(
          'w-8 h-4.5 rounded-full relative transition-colors shrink-0',
          checked ? 'bg-brass-500' : 'bg-ink-600 group-hover:bg-ink-400',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-ink-100 transition-all',
            checked ? 'left-4' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/*
        `dvh` rather than `vh` so the dialog still fits once a mobile browser's
        address bar is showing, and `min-w-0` so long unbroken content (wiki
        text, ids) scrolls its own container instead of widening the dialog.
      */}
      <div
        className={cx(
          'bg-ink-850 border border-ink-600 rounded-xl shadow-2xl w-full min-w-0 flex flex-col max-h-[90dvh]',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-ink-700 shrink-0">
          <h2 className="font-semibold text-ink-100 min-w-0 truncate">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="p-3 sm:p-4 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-400 italic py-2">{children}</p>;
}
