/** Seedable RNG + dice notation. */
import type { Advantage, RollDetail, RollExtra } from '../domain.js';

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

export interface CheckSpec {
  modifier: number;
  extras?: RollExtra[];
  advantage?: Advantage;
}

export interface CheckResult {
  /** The d20 that counted. */
  roll: number;
  modifier: number;
  total: number;
  detail: RollDetail;
}

/**
 * A skill check with the trimmings (issue #129): d20 (twice under advantage
 * or disadvantage, keeping the high or low), plus the skill modifier, plus
 * any extra dice or flat bonuses — Guidance, Bardic Inspiration, a penalty
 * die the DM imposes.
 */
export function rollCheck(spec: CheckSpec, rng: Rng): CheckResult {
  const advantage = spec.advantage ?? 'none';
  const d20 = () => 1 + Math.floor(rng() * 20);
  const rolls = advantage === 'none' ? [d20()] : [d20(), d20()];
  const roll = advantage === 'advantage' ? Math.max(...rolls) : Math.min(...rolls);
  const extras = (spec.extras ?? []).map((x) => {
    const sign = x.sign ?? 1;
    if (x.sides === 0) return { ...x, sign, rolls: [], total: sign * x.amount };
    const faces: number[] = [];
    for (let i = 0; i < x.amount; i++) faces.push(1 + Math.floor(rng() * x.sides));
    return { ...x, sign, rolls: faces, total: sign * faces.reduce((a, b) => a + b, 0) };
  });
  const total = roll + spec.modifier + extras.reduce((a, x) => a + x.total, 0);
  return { roll, modifier: spec.modifier, total, detail: { rolls, advantage, extras } };
}

/**
 * "d20 14+3 +1d4[3] Guidance −2 Bane" — the arithmetic behind a total, for
 * log lines and history rows. Advantage shows both dice with the kept one
 * first: "d20 17 (adv, dropped 4)".
 */
export function formatCheck(r: { roll: number; modifier: number; detail?: RollDetail | null }): string {
  const d = r.detail;
  let out = `d20 ${r.roll}`;
  if (d && d.advantage !== 'none' && d.rolls.length > 1) {
    const dropped = d.rolls.filter((x) => x !== r.roll);
    const other = dropped.length ? dropped[0]! : r.roll;
    out += ` (${d.advantage === 'advantage' ? 'adv' : 'dis'}, dropped ${other})`;
  }
  out += `${r.modifier >= 0 ? '+' : ''}${r.modifier}`;
  for (const x of d?.extras ?? []) {
    const sign = x.total < 0 || (x.total === 0 && x.sign < 0) ? '−' : '+';
    const term = x.sides === 0 ? `${x.amount}` : `${x.amount}d${x.sides}[${x.rolls.join(',')}]`;
    out += ` ${sign}${term}${x.label ? ` ${x.label}` : ''}`;
  }
  return out;
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
