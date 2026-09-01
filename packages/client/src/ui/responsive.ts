import React from 'react';

/**
 * Viewport/input queries the shell branches on (issue #75).
 *
 * The player experience has to work one-handed on a phone, so below
 * `MOBILE_MAX_WIDTH` the side pop-out becomes a bottom sheet and the heading
 * rail becomes a thumb-reachable bottom tab bar. Everything else (DM tools)
 * stays desktop-first.
 *
 * Keep `MOBILE_MAX_WIDTH` in step with Tailwind's `md` breakpoint (768px) —
 * the CSS-only halves of this work use `md:` utilities and the two must agree.
 */
export const MOBILE_MAX_WIDTH = 767;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/** Reactive `matchMedia`. Returns false wherever `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = React.useCallback(() => matches(query), [query]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Phone-sized viewport: bottom sheet + bottom tab bar instead of a side rail. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/**
 * Touch (or pen) as the primary input. Read imperatively — the engine is a
 * plain class, not a component, and only needs this at pointer-down time.
 */
export function isCoarsePointer(): boolean {
  return matches(COARSE_POINTER_QUERY);
}
