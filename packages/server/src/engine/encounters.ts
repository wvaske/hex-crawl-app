import type { DiceRoll, EncounterTable, Rng, TerrainId } from '@hexcrawl/shared';
import { formatRoll, hexKey, parseDice, rollDice } from '@hexcrawl/shared';
import type { CampaignRuntime } from '../state/runtime.js';

export interface EncounterResult {
  checkRoll: DiceRoll | null;
  triggered: boolean;
  terrain: TerrainId | null;
  table: EncounterTable | null;
  tableRoll: DiceRoll | null;
  entryText: string | null;
  quantityRoll: DiceRoll | null;
  summary: string;
}

/**
 * DMG-style wandering encounter procedure:
 * 1. Roll the map's trigger die; below threshold = no encounter.
 * 2. Choose a table (forced, or matching the hex's terrain, or terrain-agnostic).
 * 3. Roll the table's die and resolve the entry whose [min,max] contains it.
 */
export function rollEncounter(
  runtime: CampaignRuntime,
  opts: {
    mapId: string;
    q: number | null;
    r: number | null;
    tableId: string | null;
    skipCheck: boolean;
  },
  rng: Rng,
): EncounterResult {
  const map = runtime.maps.get(opts.mapId);
  if (!map) throw new Error('Map not found');
  const rt = runtime.requireMap(opts.mapId);

  let checkRoll: DiceRoll | null = null;
  let triggered = true;
  if (!opts.skipCheck) {
    const die = parseDice(map.encounterCheck.die) ? map.encounterCheck.die : '1d20';
    checkRoll = rollDice(die, rng);
    triggered = checkRoll.total >= map.encounterCheck.threshold;
  }

  const terrain =
    opts.q !== null && opts.r !== null ? (rt.hexes.get(hexKey(opts.q, opts.r)) ?? null) : null;

  if (!triggered) {
    return {
      checkRoll,
      triggered: false,
      terrain,
      table: null,
      tableRoll: null,
      entryText: null,
      quantityRoll: null,
      summary: `No encounter (${checkRoll ? formatRoll(checkRoll) : 'skipped'}, needs ${map.encounterCheck.threshold}+)`,
    };
  }

  let table: EncounterTable | null = null;
  if (opts.tableId) {
    // An explicitly chosen table rolls even when disabled.
    table = runtime.encounterTables.get(opts.tableId) ?? null;
  } else {
    const tables = [...runtime.encounterTables.values()].filter((t) => t.enabled);
    table =
      (terrain ? tables.find((t) => t.terrains.includes(terrain)) : undefined) ??
      tables.find((t) => t.terrains.length === 0) ??
      null;
  }

  if (!table || table.entries.length === 0) {
    return {
      checkRoll,
      triggered: true,
      terrain,
      table,
      tableRoll: null,
      entryText: null,
      quantityRoll: null,
      summary: `Encounter triggered${checkRoll ? ` (${formatRoll(checkRoll)})` : ''}, but no ${
        terrain ? `table for ${terrain}` : 'matching table'
      } — improvise!`,
    };
  }

  const tableRoll = rollDice(parseDice(table.die) ? table.die : '1d12', rng);
  const entry =
    table.entries.find((e) => tableRoll.total >= e.min && tableRoll.total <= e.max) ?? null;

  let quantityRoll: DiceRoll | null = null;
  if (entry?.quantity && parseDice(entry.quantity)) {
    quantityRoll = rollDice(entry.quantity, rng);
  }

  const parts = [
    checkRoll ? `Check ${formatRoll(checkRoll)} vs ${map.encounterCheck.threshold}+` : 'Check skipped',
    `Table "${table.name}" ${formatRoll(tableRoll)}`,
    entry ? `→ ${entry.text}` : '→ no entry covers that roll',
  ];
  if (quantityRoll) parts.push(`Quantity ${formatRoll(quantityRoll)}`);

  return {
    checkRoll,
    triggered: true,
    terrain,
    table,
    tableRoll,
    entryText: entry?.text ?? null,
    quantityRoll,
    summary: parts.join(' · '),
  };
}
