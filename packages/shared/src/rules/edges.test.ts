import { describe, expect, it } from 'vitest';
import type { CampaignState, HexEdge } from '../domain.js';
import { hexLine, hexNeighbor } from '../hex/coords.js';
import { hexEdgeCorners, nearestEdgeDirection, hexToPixel, type HexLayout } from '../hex/layout.js';
import {
  boundaryEdges,
  directionBetween,
  edgeDifficulty,
  edgesAround,
  indexEdges,
  pathBlocked,
  pathEffort,
  reverseEdge,
  stepCost,
} from './edges.js';
import { filterStateForViewer } from './filter.js';

const O = { q: 0, r: 0 };

describe('edge geometry', () => {
  it('finds the direction between neighbours and nothing else', () => {
    for (let dir = 0; dir < 6; dir++) {
      expect(directionBetween(O, hexNeighbor(O, dir))).toBe(dir);
    }
    expect(directionBetween(O, { q: 2, r: 0 })).toBeNull();
    expect(directionBetween(O, O)).toBeNull();
  });

  it('reverses an edge onto the neighbour, facing back', () => {
    const e = { q: 3, r: -1, dir: 1 };
    const back = reverseEdge(e);
    expect(hexNeighbor(back, back.dir)).toEqual({ q: 3, r: -1 });
    expect(reverseEdge(back)).toEqual(e);
  });

  it('boundary edges are exactly the crossings that leave the footprint', () => {
    // A single hex has six outward edges; a pair shares one edge each way.
    expect(boundaryEdges([O])).toHaveLength(6);
    const pair = [O, hexNeighbor(O, 0)];
    const out = boundaryEdges(pair);
    expect(out).toHaveLength(10);
    expect(out).not.toContainEqual({ q: 0, r: 0, dir: 0 });
    expect(out).not.toContainEqual({ q: 1, r: 0, dir: 3 });
  });

  for (const orientation of ['pointy', 'flat'] as const) {
    it(`picks the shared edge's corners and the nearest edge (${orientation})`, () => {
      const layout: HexLayout = { orientation, size: 20, origin: { x: 0, y: 0 } };
      for (let dir = 0; dir < 6; dir++) {
        const n = hexNeighbor(O, dir);
        const [a, b] = hexEdgeCorners(layout, O, dir);
        // Both corners sit on the perpendicular bisector of the two centres.
        const c0 = hexToPixel(layout, O);
        const c1 = hexToPixel(layout, n);
        for (const c of [a, b]) {
          const d0 = Math.hypot(c.x - c0.x, c.y - c0.y);
          const d1 = Math.hypot(c.x - c1.x, c.y - c1.y);
          expect(Math.abs(d0 - d1)).toBeLessThan(1e-6);
        }
        // A point just inside this edge's midpoint resolves to that direction.
        const mid = { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 };
        const inside = { x: c0.x + (mid.x - c0.x) * 0.8, y: c0.y + (mid.y - c0.y) * 0.8 };
        expect(nearestEdgeDirection(layout, O, inside)).toBe(dir);
      }
    });
  }
});

describe('step cost', () => {
  const east = hexNeighbor(O, 0);
  const edges: HexEdge[] = [
    { q: 0, r: 0, dir: 0, difficulty: 'difficult' },
    { q: 1, r: 0, dir: 0, difficulty: 'very_difficult' },
    { q: 2, r: 0, dir: 0, difficulty: 'impassable' },
  ];
  const index = indexEdges(edges);

  it('is directional: the way back is normal unless marked', () => {
    expect(stepCost(index, O, east)).toBe(2);
    expect(stepCost(index, east, O)).toBe(1);
    expect(edgeDifficulty(index, east, O)).toBeNull();
  });

  it('adds whole hexes of effort per level and forbids impassable', () => {
    expect(stepCost(index, { q: 1, r: 0 }, { q: 2, r: 0 })).toBe(3);
    expect(stepCost(index, { q: 2, r: 0 }, { q: 3, r: 0 })).toBe(Infinity);
    expect(stepCost(index, { q: 2, r: 0 }, { q: 3, r: 0 }, { impassableAs: 3 })).toBe(3);
  });

  it('sums a path and flags a blocked one', () => {
    const path = hexLine(O, { q: 3, r: 0 });
    expect(pathEffort(index, path)).toBe(Infinity);
    expect(pathEffort(index, path, { impassableAs: 3 })).toBe(2 + 3 + 3);
    expect(pathBlocked(index, path)).toBe(true);
    expect(pathBlocked(index, path.slice(0, 3))).toBe(false);
    expect(pathEffort(index, path.slice(0, 3))).toBe(5);
    // A teleport (non-adjacent pair) has no edge and costs a plain step.
    expect(pathEffort(index, [O, { q: 5, r: 5 }])).toBe(1);
  });

  it('lists the marked edges around a hex from both sides', () => {
    const around = edgesAround(index, east);
    expect(around).toEqual([
      { dir: 0, leaving: 'very_difficult', entering: null },
      { dir: 3, leaving: null, entering: 'difficult' },
    ]);
  });
});

describe('player filter', () => {
  it('shows players the edges touching a hex they can see, and no others', () => {
    const state = {
      campaign: {
        id: 'c',
        name: 'c',
        activeMapId: 'm',
        settings: {} as CampaignState['campaign']['settings'],
        time: {} as CampaignState['campaign']['time'],
      },
      seats: [],
      characters: [],
      maps: [],
      mapState: {
        imageLayers: [],
        hexes: [],
        edges: [
          { q: 0, r: 0, dir: 0, difficulty: 'difficult' }, // from explored
          { q: 5, r: 5, dir: 3, difficulty: 'impassable' }, // into explored 4,5
          { q: 9, r: 9, dir: 0, difficulty: 'difficult' }, // hidden both ends
        ],
        fog: [
          { q: 0, r: 0, state: 'explored' },
          { q: 4, r: 5, state: 'visible' },
        ],
        tokens: [],
        markers: [],
        contents: [],
        pendingMoves: [],
        trails: [],
        trailSigns: [],
        visits: [],
        searchAttempts: [],
      },
      discoveries: [],
      trailDiscoveries: [],
      senses: [],
      pendingReveals: [],
      encounterTables: [],
      log: [],
      undoHistory: [],
      ddbGameLog: null,
    } as unknown as CampaignState;
    const view = filterStateForViewer(state, { seatId: 's', role: 'player', characterId: 'ch' });
    expect(view.mapState!.edges.map((e) => `${e.q},${e.r},${e.dir}`)).toEqual(['0,0,0', '5,5,3']);
  });
});
