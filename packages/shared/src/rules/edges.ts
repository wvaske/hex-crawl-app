import { EDGE_EXTRA_COST, type EdgeDifficulty, type HexEdge } from '../domain.js';
import { HEX_DIRECTIONS, hexKey, hexNeighbor, type HexCoord } from '../hex/coords.js';

/**
 * Terrain difficulty on hex edges.
 *
 * Difficulty lives on the DIRECTED edge between two neighbouring hexes, not
 * on either hex: the wall between the canyon floor and the rim costs extra
 * one way and nothing the other, and the same two terrains can meet at a
 * gentle slope elsewhere with no penalty at all. Everything here works on
 * an `EdgeIndex` — a map from `edgeKey(q, r, dir)` to the difficulty of
 * leaving (q, r) toward its neighbour in direction `dir`. The server's
 * `MapRuntime.edges` IS that index; the client builds one from the snapshot.
 *
 * Costs are whole hexes of effort: a normal step is 1, a difficult edge adds
 * 1, a very difficult one adds 2, an impassable one cannot be walked
 * (`Infinity`). Keeping them integers is what lets `findRoute` keep its
 * bucket queue and its hex-distance heuristic.
 */

export type EdgeIndex = Map<string, EdgeDifficulty>;

export function edgeKey(q: number, r: number, dir: number): string {
  return `${q},${r},${dir}`;
}

export function parseEdgeKey(key: string): { q: number; r: number; dir: number } {
  const [q, r, dir] = key.split(',').map(Number);
  return { q: q!, r: r!, dir: dir! };
}

export function indexEdges(edges: Iterable<HexEdge>): EdgeIndex {
  const index: EdgeIndex = new Map();
  for (const e of edges) index.set(edgeKey(e.q, e.r, e.dir), e.difficulty);
  return index;
}

/** Direction index from `from` to an adjacent `to`, or null when not neighbours. */
export function directionBetween(from: HexCoord, to: HexCoord): number | null {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  for (let i = 0; i < HEX_DIRECTIONS.length; i++) {
    const d = HEX_DIRECTIONS[i]!;
    if (d.q === dq && d.r === dr) return i;
  }
  return null;
}

/** The same crossing seen from the other hex: entering (q, r) from `dir` is leaving the neighbour the opposite way. */
export function reverseEdge<T extends { q: number; r: number; dir: number }>(
  edge: T,
): { q: number; r: number; dir: number } {
  const n = hexNeighbor(edge, edge.dir);
  return { q: n.q, r: n.r, dir: (edge.dir + 3) % 6 };
}

/** The difficulty of stepping from `from` to the adjacent `to`, or null when the crossing is normal. */
export function edgeDifficulty(
  index: EdgeIndex,
  from: HexCoord,
  to: HexCoord,
): EdgeDifficulty | null {
  const dir = directionBetween(from, to);
  if (dir === null) return null;
  return index.get(edgeKey(from.q, from.r, dir)) ?? null;
}

export interface StepCostOptions {
  /**
   * What an impassable edge costs when it is walked anyway (a DM dragging a
   * token straight across a cliff). Default `Infinity`: not walkable.
   */
  impassableAs?: number;
}

/**
 * Hexes of effort to step from `from` to the adjacent `to`: 1 plus the edge's
 * extra cost. Non-adjacent pairs (a teleport) cost 1 — there is no edge.
 */
export function stepCost(
  index: EdgeIndex,
  from: HexCoord,
  to: HexCoord,
  opts: StepCostOptions = {},
): number {
  const difficulty = edgeDifficulty(index, from, to);
  if (difficulty === null) return 1;
  const extra = EDGE_EXTRA_COST[difficulty];
  if (extra === Infinity) return opts.impassableAs ?? Infinity;
  return 1 + extra;
}

/** Total effort of a walked path (consecutive hexes); Infinity if it crosses an impassable edge. */
export function pathEffort(index: EdgeIndex, path: HexCoord[], opts: StepCostOptions = {}): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += stepCost(index, path[i - 1]!, path[i]!, opts);
  }
  return total;
}

/** Does the path cross any impassable edge? */
export function pathBlocked(index: EdgeIndex, path: HexCoord[]): boolean {
  for (let i = 1; i < path.length; i++) {
    if (edgeDifficulty(index, path[i - 1]!, path[i]!) === 'impassable') return true;
  }
  return false;
}

/**
 * The outward edges of a footprint: every (member hex, direction) whose
 * neighbour is NOT a member. These are the crossings that LEAVE the region;
 * `reverseEdge` of each is the crossing that enters it.
 */
export function boundaryEdges(cells: HexCoord[]): { q: number; r: number; dir: number }[] {
  const members = new Set(cells.map((c) => hexKey(c.q, c.r)));
  const out: { q: number; r: number; dir: number }[] = [];
  for (const cell of cells) {
    for (let dir = 0; dir < 6; dir++) {
      const n = hexNeighbor(cell, dir);
      if (!members.has(hexKey(n.q, n.r))) out.push({ q: cell.q, r: cell.r, dir });
    }
  }
  return out;
}

/** The marked edges that touch a hex: leaving it, and entering it from each neighbour. */
export function edgesAround(
  index: EdgeIndex,
  hex: HexCoord,
): { dir: number; leaving: EdgeDifficulty | null; entering: EdgeDifficulty | null }[] {
  const out: { dir: number; leaving: EdgeDifficulty | null; entering: EdgeDifficulty | null }[] =
    [];
  for (let dir = 0; dir < 6; dir++) {
    const leaving = index.get(edgeKey(hex.q, hex.r, dir)) ?? null;
    const back = reverseEdge({ q: hex.q, r: hex.r, dir });
    const entering = index.get(edgeKey(back.q, back.r, back.dir)) ?? null;
    if (leaving || entering) out.push({ dir, leaving, entering });
  }
  return out;
}
