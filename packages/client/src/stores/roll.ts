import { create } from 'zustand';
import type { Advantage, RollExtra } from '@hexcrawl/shared';

/**
 * Pending trimmings for the next skill roll (issue #129): Guidance dice, a
 * Bless bonus, advantage, "DM only". They ride along on whichever 🎲 fires
 * next — sheet or search — and are consumed by it, so a Guidance die never
 * silently applies to the roll after.
 */
interface RollOptionsStore {
  extras: RollExtra[];
  advantage: Advantage;
  /** Player: keep the next roll between you and the DM. */
  secret: boolean;
  /** DM group roll: only characters proficient in the skill. */
  proficientOnly: boolean;

  addExtra(extra: RollExtra): void;
  removeExtra(index: number): void;
  flipExtra(index: number): void;
  set<K extends keyof RollOptionsStore>(key: K, value: RollOptionsStore[K]): void;
  /** Everything the next `check.roll` should carry, then reset the one-shots. */
  consume(): { extras: RollExtra[]; advantage: Advantage; secret: boolean; proficientOnly: boolean };
}

export const useRollOptions = create<RollOptionsStore>((set, get) => ({
  extras: [],
  advantage: 'none',
  secret: false,
  proficientOnly: false,

  addExtra: (extra) => set((s) => ({ extras: [...s.extras, extra].slice(0, 8) })),
  removeExtra: (index) => set((s) => ({ extras: s.extras.filter((_, i) => i !== index) })),
  flipExtra: (index) =>
    set((s) => ({
      extras: s.extras.map((x, i) => (i === index ? { ...x, sign: x.sign === 1 ? -1 : 1 } : x)),
    })),
  set: (key, value) => set({ [key]: value } as Partial<RollOptionsStore>),
  consume: () => {
    const { extras, advantage, secret, proficientOnly } = get();
    // Dice and advantage are one-shot; "DM only" and "proficient only" are
    // modes the roller keeps until they change them.
    set({ extras: [], advantage: 'none' });
    return { extras, advantage, secret, proficientOnly };
  },
}));

/** Common reasons for an extra die — the label is free text underneath. */
export const EXTRA_LABELS = ['Guidance', 'Bardic Inspiration', 'Bless', 'Emboldening Bond', 'Other'] as const;
