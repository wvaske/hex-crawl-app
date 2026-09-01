/**
 * Sticker library for map markers (issue #67).
 *
 * The SVGs live in `assets/stickers/<category>/<slug>.svg` and are vendored from
 * game-icons.net under CC BY 3.0 — see `assets/stickers/ATTRIBUTION.md`. Vite
 * turns the glob below into emitted asset URLs, so the bundle stays small and
 * each icon is fetched only when it is actually drawn.
 *
 * A sticker id is `<category>/<slug>` and is what `Marker.icon` stores. The
 * catalogue below is generated alongside the assets; keep the two in sync.
 */
import { MARKER_LIBRARY } from '@hexcrawl/shared';

const STICKER_MODULES = import.meta.glob(
  './assets/stickers/**/*.svg',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/** `<category>/<slug>` → emitted asset URL. */
export const STICKER_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(STICKER_MODULES).map(([path, url]) => [
    path.replace('./assets/stickers/', '').replace(/\.svg$/, ''),
    url,
  ]),
);

/** URL for a sticker id, or undefined when the id is unknown (stale data). */
export function stickerUrl(icon: string): string | undefined {
  return icon ? STICKER_URLS[icon] : undefined;
}

export type StickerCategory = {
  id: string;
  label: string;
  /** Emoji categories carry `glyph` instead of a sticker `id`. */
  stickers: { id: string; name: string }[];
  glyphs?: { glyph: string; name: string }[];
};

/** Curated sticker catalogue, grouped for the picker UI. */
export const STICKER_CATEGORIES: StickerCategory[] = [
  {
    id: 'hazards',
    label: 'Hazards',
    stickers: [
      { id: 'hazards/wildfire', name: 'Wildfire' },
      { id: 'hazards/storm', name: 'Storm' },
      { id: 'hazards/tornado', name: 'Tornado' },
      { id: 'hazards/freezing', name: 'Freezing' },
      { id: 'hazards/poison', name: 'Poison' },
      { id: 'hazards/corruption', name: 'Corruption' },
      { id: 'hazards/webs', name: 'Webs' },
      { id: 'hazards/quicksand', name: 'Quicksand' },
      { id: 'hazards/rockfall', name: 'Rockfall' },
      { id: 'hazards/snare', name: 'Snare / trap' },
      { id: 'hazards/spikes', name: 'Spikes' },
      { id: 'hazards/brambles', name: 'Brambles' },
      { id: 'hazards/rough-water', name: 'Rough water' },
      { id: 'hazards/swamp', name: 'Swamp' },
      { id: 'hazards/deadly', name: 'Deadly' },
    ],
  },
  {
    id: 'places',
    label: 'Places',
    stickers: [
      { id: 'places/keep', name: 'Keep' },
      { id: 'places/village', name: 'Village' },
      { id: 'places/watchtower', name: 'Watchtower' },
      { id: 'places/cave', name: 'Cave' },
      { id: 'places/ruins', name: 'Ruins' },
      { id: 'places/temple', name: 'Temple' },
      { id: 'places/chapel', name: 'Chapel' },
      { id: 'places/graveyard', name: 'Graveyard' },
      { id: 'places/well', name: 'Well' },
      { id: 'places/windmill', name: 'Windmill' },
      { id: 'places/bridge', name: 'Bridge' },
      { id: 'places/dungeon', name: 'Dungeon gate' },
      { id: 'places/tavern', name: 'Tavern' },
      { id: 'places/mine', name: 'Mine' },
      { id: 'places/stairs', name: 'Stairs' },
      { id: 'places/harbor', name: 'Harbor' },
    ],
  },
  {
    id: 'story',
    label: 'Story',
    stickers: [
      { id: 'story/danger', name: 'Danger' },
      { id: 'story/mystery', name: 'Mystery' },
      { id: 'story/objective', name: 'Objective' },
      { id: 'story/battle', name: 'Battle' },
      { id: 'story/rally-point', name: 'Rally point' },
      { id: 'story/note', name: 'Note' },
      { id: 'story/quest', name: 'Quest' },
      { id: 'story/lead', name: 'Lead / map' },
      { id: 'story/search', name: 'Search here' },
      { id: 'story/watched', name: 'Watched' },
      { id: 'story/tracks', name: 'Tracks' },
      { id: 'story/animal-tracks', name: 'Animal tracks' },
      { id: 'story/crossroads', name: 'Crossroads' },
      { id: 'story/grave', name: 'Grave' },
      { id: 'story/secret', name: 'Secret' },
    ],
  },
  {
    id: 'creatures',
    label: 'Creatures',
    stickers: [
      { id: 'creatures/dragon', name: 'Dragon' },
      { id: 'creatures/wolves', name: 'Wolves' },
      { id: 'creatures/spider', name: 'Spider' },
      { id: 'creatures/serpent', name: 'Serpent' },
      { id: 'creatures/ghost', name: 'Ghost' },
      { id: 'creatures/skeleton', name: 'Skeleton' },
      { id: 'creatures/goblin', name: 'Goblin' },
      { id: 'creatures/orc', name: 'Orc' },
      { id: 'creatures/ogre', name: 'Ogre' },
      { id: 'creatures/minotaur', name: 'Minotaur' },
      { id: 'creatures/wyvern', name: 'Wyvern' },
      { id: 'creatures/bats', name: 'Bats' },
      { id: 'creatures/boar', name: 'Boar' },
      { id: 'creatures/deer', name: 'Deer' },
      { id: 'creatures/kraken', name: 'Kraken' },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    stickers: [
      { id: 'objects/treasure', name: 'Treasure' },
      { id: 'objects/coins', name: 'Coins' },
      { id: 'objects/key', name: 'Key' },
      { id: 'objects/lock', name: 'Lock' },
      { id: 'objects/tome', name: 'Tome' },
      { id: 'objects/crystal-ball', name: 'Crystal ball' },
      { id: 'objects/potion', name: 'Potion' },
      { id: 'objects/cauldron', name: 'Cauldron' },
      { id: 'objects/anvil', name: 'Anvil' },
      { id: 'objects/lantern', name: 'Lantern' },
      { id: 'objects/signpost', name: 'Signpost' },
      { id: 'objects/crate', name: 'Crate' },
      { id: 'objects/crown', name: 'Crown' },
    ],
  },
  {
    id: 'camp',
    label: 'Camp & Travel',
    stickers: [
      { id: 'camp/campfire', name: 'Campfire' },
      { id: 'camp/tent', name: 'Tent' },
      { id: 'camp/forest-camp', name: 'Forest camp' },
      { id: 'camp/cook-pot', name: 'Cook pot' },
      { id: 'camp/supplies', name: 'Supplies' },
      { id: 'camp/rations', name: 'Rations' },
      { id: 'camp/water', name: 'Water' },
      { id: 'camp/compass', name: 'Compass' },
      { id: 'camp/spyglass', name: 'Spyglass' },
      { id: 'camp/boat', name: 'Boat' },
      { id: 'camp/mount', name: 'Mount' },
      { id: 'camp/rest', name: 'Rest / time' },
    ],
  },
  // Emoji stay available so markers placed before the sticker library keep
  // working, and so a DM can reach for a glyph the icon set does not cover.
  {
    id: 'emoji',
    label: 'Emoji',
    stickers: [],
    glyphs: MARKER_LIBRARY.flatMap((g) => g.glyphs),
  },
];

/** Every sticker id the catalogue knows about (search + validation). */
export const STICKER_IDS: string[] = STICKER_CATEGORIES.flatMap((c) =>
  c.stickers.map((s) => s.id),
);

const NAMES = new Map(
  STICKER_CATEGORIES.flatMap((c) => c.stickers.map((s) => [s.id, s.name] as const)),
);

/** Human-readable name for a sticker id; falls back to the id itself. */
export function stickerName(icon: string): string {
  return NAMES.get(icon) ?? icon;
}
