import { describe, expect, it } from 'vitest';
import {
  STEP_WAYS,
  TileClaims,
  Tile,
  anchorNear,
  canStep,
  findTileRoute,
  spotMiddle,
  stepSeconds,
  stridePosition,
  tilesApart,
  wayOf,
  walkTiles,
  bodyList,
  PERSON_RADIUS,
  PLAYER_SPEED,
  TICK_SECONDS,
  type EdgeWall,
  type HitBody,
  type TileWalker,
  type RegionMap,
  type TileSpot,
} from '../src/index.ts';

// Moving on tiles (docs/combat.md): eight-way steps the land allows, one
// body per tile, routes round what is in the way, and steps drawn as slides.

/** A small land of open ground, with trees and walls where a test puts them. */
function land(width = 8, height = 8, trees: [number, number][] = [], edgeWalls: Partial<EdgeWall>[] = []): RegionMap {
  const tiles = new Uint8Array(width * height).fill(Tile.Ground);
  for (const [x, y] of trees) tiles[y * width + x] = Tile.Tree;
  return { width, height, tiles, def: { exits: {} }, storeys: [], edgeWalls: edgeWalls.map((w) => ({ floor: 0, style: 'x', height: 'full', id: 'w', ...w })) } as unknown as RegionMap;
}

const at = (tx: number, ty: number): TileSpot => ({ tx, ty });

describe('the tile grid', () => {
  it('rounds any input to one of eight ways', () => {
    expect(wayOf(1, 0)).toEqual({ dx: 1, dy: 0 });
    expect(wayOf(1, 0.2)).toEqual({ dx: 1, dy: 0 });
    expect(wayOf(-0.7, 0.7)).toEqual({ dx: -1, dy: 1 });
    expect(wayOf(0, 0)).toBeUndefined();
    expect(STEP_WAYS).toHaveLength(8);
  });

  it('puts bodies at the middle of their square and finds the square nearest a point', () => {
    expect(spotMiddle(at(3, 4))).toEqual({ x: 3.5, y: 4.5 });
    expect(spotMiddle(at(3, 4), 2)).toEqual({ x: 4, y: 5 });
    expect(anchorNear(3.4, 4.6)).toEqual(at(3, 4));
    expect(anchorNear(4.1, 5.2, 2)).toEqual(at(3, 4));
  });

  it('counts tiles between squares, a diagonal as one', () => {
    expect(tilesApart(at(0, 0), 1, at(1, 1), 1)).toBe(1);
    expect(tilesApart(at(0, 0), 1, at(2, 0), 1)).toBe(2);
    // A 2×2 creature at (2,2) touches a player at (1,1) and (4,2).
    expect(tilesApart(at(1, 1), 1, at(2, 2), 2)).toBe(1);
    expect(tilesApart(at(4, 2), 1, at(2, 2), 2)).toBe(1);
    expect(tilesApart(at(2, 2), 1, at(2, 2), 2)).toBe(0);
  });
});

describe('steps', () => {
  it('stops at trees and walls, and never cuts a corner', () => {
    const map = land(8, 8, [[3, 2], [2, 3]], [{ x: 5, y: 5, along: 'v' }]);
    expect(canStep(map, at(2, 2), { dx: 1, dy: 0 })).toBe(false);
    expect(canStep(map, at(2, 2), { dx: -1, dy: 0 })).toBe(true);
    // Between two trees touching at a corner.
    expect(canStep(map, at(2, 2), { dx: 1, dy: 1 })).toBe(false);
    // A wall on the line between (4,5) and (5,5): no crossing it, nor round its end diagonally.
    expect(canStep(map, at(4, 5), { dx: 1, dy: 0 })).toBe(false);
    expect(canStep(map, at(4, 5), { dx: 1, dy: 1 })).toBe(false);
    expect(canStep(map, at(4, 5), { dx: 0, dy: 1 })).toBe(true);
  });

  it('needs room for the whole of a big body', () => {
    const map = land(8, 8, [[4, 1]]);
    // A 2×2 body at (1,1) stepping east to (2,1) fits; at (2,1) stepping to (3,1) would put a tile on the tree.
    expect(canStep(map, at(1, 1), { dx: 1, dy: 0 }, 2)).toBe(true);
    expect(canStep(map, at(2, 1), { dx: 1, dy: 0 }, 2)).toBe(false);
  });

  it('takes 1 / speed seconds, diagonals longer, and never when held', () => {
    expect(stepSeconds(4, { dx: 1, dy: 0 })).toBe(0.25);
    expect(stepSeconds(4, { dx: 1, dy: 1 })).toBeCloseTo(0.35);
    expect(stepSeconds(4, { dx: 1, dy: 0 }, 0.5)).toBe(0.5);
    expect(stepSeconds(4, { dx: 1, dy: 0 }, 0)).toBe(Infinity);
  });

  it('slides a body between tile middles while it steps', () => {
    const s = { from: at(1, 1), way: { dx: 1, dy: 0 } as const, at: 1000, ms: 250 };
    expect(stridePosition(s, 1000)).toEqual({ x: 1.5, y: 1.5 });
    expect(stridePosition(s, 1125)).toEqual({ x: 2, y: 1.5 });
    expect(stridePosition(s, 2000)).toEqual({ x: 2.5, y: 1.5 });
  });
});

describe('tile claims', () => {
  it('keeps one body per tile, first come first', () => {
    const claims = new TileClaims();
    expect(claims.claim({ id: 'a', anchor: at(1, 1), width: 1, floor: 0 })).toBe(true);
    expect(claims.claim({ id: 'b', anchor: at(1, 1), width: 1, floor: 0 })).toBe(false);
    expect(claims.claim({ id: 'b', anchor: at(1, 1), width: 1, floor: 1 })).toBe(true);
    expect(claims.at(1, 1)).toBe('a');
    // Stepping on frees the tile left behind.
    expect(claims.claim({ id: 'a', anchor: at(2, 1), width: 1, floor: 0 })).toBe(true);
    expect(claims.claim({ id: 'b', anchor: at(1, 1), width: 1, floor: 0 })).toBe(true);
  });

  it('lets a big body stand only where its whole square is free', () => {
    const claims = new TileClaims();
    claims.claim({ id: 'p', anchor: at(3, 3), width: 1, floor: 0 });
    expect(claims.claim({ id: 'golem', anchor: at(2, 2), width: 2, floor: 0 })).toBe(false);
    expect(claims.claim({ id: 'golem', anchor: at(1, 1), width: 2, floor: 0 })).toBe(true);
    expect(claims.inTheWay('p', at(1, 1), 2)).toEqual(['golem']);
  });

  it('lets someone pass those they may pass, and gives the tile back when they go', () => {
    const claims = new TileClaims();
    claims.claim({ id: 'a', anchor: at(1, 1), width: 1, floor: 0 });
    expect(claims.claim({ id: 'b', anchor: at(1, 1), width: 1, floor: 0 }, (o) => o === 'a')).toBe(true);
    expect(claims.allAt(1, 1)).toEqual(['a', 'b']);
    claims.release('a');
    expect(claims.at(1, 1)).toBe('b');
    claims.release('b');
    expect(claims.at(1, 1)).toBeUndefined();
    expect(claims.size).toBe(0);
  });
});

describe('routes', () => {
  it('walks round a wall of trees to a tile', () => {
    const map = land(8, 8, [[3, 0], [3, 1], [3, 2], [3, 3]]);
    const goal = at(5, 1);
    const route = findTileRoute(map, { from: at(1, 1), toward: goal, arrived: (t) => t.tx === goal.tx && t.ty === goal.ty })!;
    expect(route).toBeDefined();
    let t = at(1, 1);
    for (const w of route) {
      expect(canStep(map, t, w)).toBe(true);
      t = { tx: t.tx + w.dx, ty: t.ty + w.dy };
    }
    expect(t).toEqual(goal);
  });

  it('goes round someone in the way and stops beside its prey', () => {
    const map = land();
    const busy = new Set(['2,1']);
    const prey = at(5, 1);
    const route = findTileRoute(map, {
      from: at(1, 1),
      toward: prey,
      arrived: (t) => tilesApart(t, 1, prey, 1) === 1,
      free: (t) => !busy.has(`${t.tx},${t.ty}`) && !(t.tx === prey.tx && t.ty === prey.ty),
    })!;
    expect(route.length).toBe(3);
    expect(route[0]).not.toEqual({ dx: 1, dy: 0 });
  });

  it('gives up when there is no way', () => {
    const map = land(8, 8, [[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7]]);
    expect(findTileRoute(map, { from: at(1, 1), toward: at(5, 1), arrived: (t) => t.tx === 5 && t.ty === 1 })).toBeUndefined();
    expect(findTileRoute(map, { from: at(1, 1), toward: at(1, 1), arrived: (t) => t.tx === 1 && t.ty === 1 })).toEqual([]);
  });
});

describe('walking on tiles', () => {
  const ticksPerTile = Math.round(1 / (PLAYER_SPEED * TICK_SECONDS));

  it('walks from tile middle to tile middle while a key is held', () => {
    const map = land();
    let w: TileWalker = { x: 1.5, y: 1.5, floor: 0 };
    w = walkTiles(map, w, 1, 0);
    expect(w.to).toEqual(at(2, 1));
    for (let i = 1; i < ticksPerTile * 2; i++) w = walkTiles(map, w, 1, 0);
    expect(w.x).toBeCloseTo(3.5);
    expect(w.y).toBe(1.5);
  });

  it('finishes a step once begun, key or no key', () => {
    const map = land();
    let w: TileWalker = walkTiles(map, { x: 1.5, y: 1.5, floor: 0 }, 1, 0);
    for (let i = 0; i < ticksPerTile; i++) w = walkTiles(map, w, 0, 0);
    expect(w).toEqual({ x: 2.5, y: 1.5, floor: 0 });
  });

  it('slides along a wall of trees when walking into it at a slant', () => {
    const map = land(8, 8, [[2, 2], [3, 2], [4, 2]]);
    const w = walkTiles(map, { x: 2.5, y: 1.5, floor: 0 }, 1, 1);
    expect(w.to).toEqual(at(3, 1));
  });

  it('stops at a tile someone stands on or is stepping onto, unless it may pass them', () => {
    // Trees either side, so there is no way round.
    const map = land(8, 8, [[2, 0], [2, 2]]);
    const other: HitBody = { x: 2.5, y: 1.5, floor: 0, r: PERSON_RADIUS, kind: 'player' };
    const among = { self: { r: PERSON_RADIUS, kind: 'player' as const, floor: 0 }, bodies: bodyList([other]) };
    const still: TileWalker = { x: 1.5, y: 1.5, floor: 0 };
    expect(walkTiles(map, still, 1, 0, 1, among)).toBe(still);
    expect(walkTiles(map, still, 1, 0, 1, { ...among, passes: () => true }).to).toEqual(at(2, 1));
    // Someone halfway into the next tile holds it, and so does someone just setting off for it.
    const coming: HitBody = { x: 3.4, y: 1.5, floor: 0, r: PERSON_RADIUS, kind: 'player', to: at(2, 1) };
    expect(walkTiles(map, still, 1, 0, 1, { ...among, bodies: bodyList([coming]) })).toBe(still);
  });

  it('stays put when someone stands on the tile asked for, straight or diagonal, never slipping round them', () => {
    const map = land(8, 8, []);
    const other: HitBody = { x: 2.5, y: 2.5, floor: 0, r: PERSON_RADIUS, kind: 'creature' };
    const among = { self: { r: PERSON_RADIUS, kind: 'player' as const, floor: 0 }, bodies: bodyList([other]) };
    const west: TileWalker = { x: 1.5, y: 2.5, floor: 0 };
    expect(walkTiles(map, west, 1, 0, 1, among)).toBe(west);
    const corner: TileWalker = { x: 1.5, y: 1.5, floor: 0 };
    expect(walkTiles(map, corner, 1, 1, 1, among)).toBe(corner);
    // A diagonal the land blocks still slides along the wall, round no one.
    const walled = land(8, 8, [[2, 1]]);
    expect(walkTiles(walled, corner, 1, 1, 1, { ...among, bodies: bodyList([]) }).to).toEqual(at(1, 2));
  });

  it('turns to face a monster on the diagonal asked for even when a tree on its corner blocks the diagonal', () => {
    // A tree east of the walker: the diagonal south-east is cut by it, and the monster stands at its end.
    const walled = land(8, 8, [[2, 1]]);
    const other: HitBody = { x: 2.5, y: 2.5, floor: 0, r: PERSON_RADIUS, kind: 'creature' };
    const among = { self: { r: PERSON_RADIUS, kind: 'player' as const, floor: 0 }, bodies: bodyList([other]) };
    const corner: TileWalker = { x: 1.5, y: 1.5, floor: 0 };
    // No slide south along the tree towards the monster's side: the walker stays put.
    expect(walkTiles(walled, corner, 1, 1, 1, among)).toBe(corner);
    // Walking for many ticks never moves them either.
    let w = corner;
    for (let i = 0; i < 30; i++) w = walkTiles(walled, w, 1, 1, 1, among);
    expect(w).toBe(corner);
  });
});
