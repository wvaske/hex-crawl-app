import { nanoid } from 'nanoid';
import type { Clue, Content } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

/**
 * Sensory clue templates for settlements, scaled by pin prominence
 * (scaleVisibility: 2 = major city, 1 = town, 0 = village/hamlet).
 * All are distance-sensed, directional, and never locate the source —
 * players triangulate from where they've sensed them.
 */
const TEMPLATES: Record<
  number,
  { text: string; skill: string; dc: number; maxDistance: number }[]
> = {
  2: [
    {
      text: 'A brown haze of a thousand chimneys smudges the sky',
      skill: 'perception',
      dc: 8,
      maxDistance: 6,
    },
    {
      text: 'The distant din of a great city — bells, wheels, and countless voices',
      skill: 'perception',
      dc: 12,
      maxDistance: 3,
    },
    {
      text: 'Woodsmoke, dung, and cookfires ride the wind',
      skill: 'survival',
      dc: 10,
      maxDistance: 4,
    },
  ],
  1: [
    {
      text: 'Threads of chimney smoke rise above the treeline',
      skill: 'perception',
      dc: 10,
      maxDistance: 4,
    },
    {
      text: 'Faint sounds of livestock and working folk',
      skill: 'perception',
      dc: 13,
      maxDistance: 2,
    },
    {
      text: 'The smell of hearthfires and tilled earth',
      skill: 'survival',
      dc: 11,
      maxDistance: 3,
    },
  ],
  0: [
    {
      text: 'A thin wisp of hearth smoke curls into the sky',
      skill: 'perception',
      dc: 12,
      maxDistance: 3,
    },
    {
      text: 'A dog barks somewhere; a cock crows',
      skill: 'perception',
      dc: 14,
      maxDistance: 1,
    },
    {
      text: 'A whiff of woodsmoke and cooking',
      skill: 'survival',
      dc: 13,
      maxDistance: 2,
    },
  ],
};

/**
 * Add the standard sensory clues to every settlement on the map that doesn't
 * already carry them (matched by text, so re-running is safe). Returns the
 * touched contents with their prior clue lists for undo.
 */
export function generateSettlementClues(
  runtime: CampaignRuntime,
  mapId: string,
): { content: Content; priorClues: Clue[] }[] {
  const rt = runtime.mapStates.get(mapId);
  if (!rt) return [];
  const touched: { content: Content; priorClues: Clue[] }[] = [];
  for (const content of rt.contents.values()) {
    if (content.type !== 'settlement') continue;
    const templates = TEMPLATES[content.scaleVisibility] ?? TEMPLATES[1]!;
    const existingTexts = new Set(content.clues.map((c) => c.text));
    const fresh = templates.filter((t) => !existingTexts.has(t.text));
    if (!fresh.length) continue;
    const priorClues = [...content.clues];
    const next: Content = {
      ...content,
      clues: [
        ...content.clues,
        ...fresh.map((t, i) => ({
          id: nanoid(10),
          contentId: content.id,
          text: t.text,
          gate: {
            kind: 'skill' as const,
            skill: t.skill,
            dc: t.dc,
            maxDistance: t.maxDistance,
            mode: 'passive' as const,
          },
          sortOrder: content.clues.length + i,
          indicatesDirection: true,
          revealsLocation: true,
        })),
      ],
    };
    runtime.upsertContent(next);
    touched.push({ content: next, priorClues });
  }
  return touched;
}
