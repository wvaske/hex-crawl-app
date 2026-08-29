/** Seedable RNG + dice notation. */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for game dice. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
}

const DICE_RE = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

/** Parse notation like "d20", "2d6", "1d8+2", "3d6-1". Returns null if invalid. */
export function parseDice(notation: string): DiceSpec | null {
  const m = DICE_RE.exec(notation);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2]!, 10);
  const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
  return { count, sides, modifier };
}

export interface DiceRoll {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
}

export function rollDice(notation: string, rng: Rng): DiceRoll {
  const spec = parseDice(notation);
  if (!spec) throw new Error(`Invalid dice notation: ${notation}`);
  const rolls: number[] = [];
  for (let i = 0; i < spec.count; i++) {
    rolls.push(1 + Math.floor(rng() * spec.sides));
  }
  const total = rolls.reduce((a, b) => a + b, 0) + spec.modifier;
  return { notation, rolls, modifier: spec.modifier, total };
}

export function rollD20(modifier: number, rng: Rng): { roll: number; total: number } {
  const roll = 1 + Math.floor(rng() * 20);
  return { roll, total: roll + modifier };
}

/** Min/max possible totals for a notation (for table validation). */
export function diceBounds(notation: string): { min: number; max: number } | null {
  const spec = parseDice(notation);
  if (!spec) return null;
  return { min: spec.count + spec.modifier, max: spec.count * spec.sides + spec.modifier };
}

export function formatRoll(r: DiceRoll): string {
  const parts = r.rolls.join(' + ');
  const mod = r.modifier === 0 ? '' : r.modifier > 0 ? ` + ${r.modifier}` : ` − ${-r.modifier}`;
  return `${r.notation}: [${parts}]${mod} = ${r.total}`;
}
