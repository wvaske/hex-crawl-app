/**
 * D&D Beyond character sync: fetch a PUBLIC character sheet's JSON and
 * compute skill modifiers. Validated against real sheets; known gaps:
 * half-proficiency (Jack of All Trades), item overrides, custom bonuses.
 */

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const SKILLS: Record<string, string> = {
  acrobatics: 'dexterity',
  'animal-handling': 'wisdom',
  arcana: 'intelligence',
  athletics: 'strength',
  deception: 'charisma',
  history: 'intelligence',
  insight: 'wisdom',
  intimidation: 'charisma',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  performance: 'charisma',
  persuasion: 'charisma',
  religion: 'intelligence',
  'sleight-of-hand': 'dexterity',
  stealth: 'dexterity',
  survival: 'wisdom',
};

export interface DdbSync {
  name: string;
  level: number;
  classes: string;
  skills: Record<string, number>;
}

/** Accepts a raw id or any dndbeyond.com character URL; null if unparseable. */
export function parseDdbId(input: string): string | null {
  const m = input.trim().match(/(?:characters\/)?(\d{4,})/);
  return m ? m[1]! : null;
}

export async function fetchDdbCharacter(ddbId: string): Promise<DdbSync> {
  const res = await fetch(
    `https://character-service.dndbeyond.com/character/v5/character/${ddbId}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (HexCrawl VTT sync)' } },
  );
  if (res.status === 403 || res.status === 401) {
    throw new Error('That D&D Beyond character is private — set its privacy to Public and retry.');
  }
  if (!res.ok) throw new Error(`D&D Beyond returned ${res.status} for character ${ddbId}`);
  const payload = (await res.json()) as { success?: boolean; data?: Record<string, unknown> };
  const d = payload.data;
  if (!payload.success || !d) {
    throw new Error('That D&D Beyond character is private or does not exist.');
  }

  const classes = (d.classes as { level: number; definition: { name: string } }[]) ?? [];
  const level = classes.reduce((s, c) => s + c.level, 0) || 1;
  const prof = Math.ceil(level / 4) + 1;

  const base: Record<string, number> = {};
  (d.stats as { value: number }[]).forEach((s, i) => {
    base[ABILITIES[i]!] = s.value;
  });
  const allMods = Object.values(
    (d.modifiers as Record<string, { type: string; subType: string; value: number | null }[]>) ??
      {},
  ).flat();
  for (const m of allMods) {
    if (!m.subType?.endsWith('-score') || !m.value) continue;
    const ab = m.subType.replace('-score', '');
    if (base[ab] === undefined) continue;
    if (m.type === 'bonus') base[ab] += m.value;
    if (m.type === 'set' && m.value > base[ab]!) base[ab] = m.value;
  }
  const abMod = (v: number) => Math.floor((v - 10) / 2);

  const profs = new Set<string>();
  const expertise = new Set<string>();
  for (const m of allMods) {
    if (m.type === 'proficiency' && SKILLS[m.subType]) profs.add(m.subType);
    if (m.type === 'expertise' && SKILLS[m.subType]) expertise.add(m.subType);
  }

  const skills: Record<string, number> = {};
  for (const [sk, ab] of Object.entries(SKILLS)) {
    const mod =
      abMod(base[ab]!) + (expertise.has(sk) ? 2 * prof : profs.has(sk) ? prof : 0);
    skills[sk.replace(/-/g, ' ')] = Math.max(-10, Math.min(20, mod));
  }

  return {
    name: (d.name as string) ?? 'Unknown',
    level,
    classes: classes.map((c) => `${c.definition.name} ${c.level}`).join('/'),
    skills,
  };
}
