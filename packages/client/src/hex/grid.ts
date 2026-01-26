import { defineHex, Grid, rectangle, Orientation } from 'honeycomb-grid';

/**
 * GameHex extends honeycomb-grid's hex definition with flat-top orientation.
 * 40px circumradius, topLeft origin for PixiJS sprite alignment.
 * offset: -1 gives "odd-q" layout (standard for flat-top hex grids).
 */
export class GameHex extends defineHex({
  dimensions: 40,
  orientation: Orientation.FLAT,
  origin: 'topLeft',
  offset: -1,
}) {
  /** Terrain type assigned to this hex */
  terrain: string = 'grassland';
  /** Terrain variant index for visual variety */
  terrainVariant: number = 0;
}

/**
 * Create a rectangular hex grid with the given dimensions.
 * Always passes a traverser to create a stateful grid (PITFALL 5).
 */
export function createGrid(width: number, height: number): Grid<GameHex> {
  return new Grid(GameHex, rectangle({ width, height }));
}

export { Orientation } from 'honeycomb-grid';
