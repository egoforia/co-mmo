// The floors under us, seen from upstairs: their walls stand closed at full
// height, so a storey rests on solid walls and no one sees into the rooms
// below through their cut-down near walls.

import Phaser from 'phaser';
import { Tile, type RegionMap, type TileRect } from '@co-mmo/shared';
import { type BuildingView, type DrawnRegion, type FloorView, overlaps, setDepthShade, setShown } from './types.ts';
import { rockWalls } from './walls.ts';

type Wall = Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer;

/** The closed walls stood for each building's ground floor or each storey, made the first time we look down on it. */
const closed = new WeakMap<BuildingView | FloorView, Wall[]>();

/** A rectangle of one floor's tiles, row by row. */
function rowsOf(tiles: Uint8Array, rowWidth: number, rect: TileRect, from: { x: number; y: number }): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < rect.height; y++) {
    const start = (from.y + y) * rowWidth + from.x;
    rows.push(Array.from(tiles.subarray(start, start + rect.width), (t) => (t === Tile.Blocked ? Tile.Floor : t)));
  }
  return rows;
}

/** The closed walls for a building's ground floor or a storey, stood once and kept with the region so they go when it does. */
function closedWalls(scene: Phaser.Scene, region: DrawnRegion, key: BuildingView | FloorView): Wall[] {
  const made = closed.get(key);
  if (made) return made;
  const map: RegionMap = region.map;
  const ox = map.def.at.x * map.width;
  const oy = map.def.at.y * map.height;
  let walls: Wall[];
  if ('building' in key) {
    const b = key.building;
    walls = rockWalls(scene, rowsOf(map.tiles, map.width, b, b), ox + b.x, oy + b.y, b.style, b.art, region.tilemaps, true, false, false, 0);
  } else {
    const s = key.storey;
    walls = rockWalls(scene, rowsOf(s.tiles, s.width, s, { x: 0, y: 0 }), ox + s.x, oy + s.y, s.style, s.art, region.tilemaps, true, false, false, s.floor);
  }
  for (const w of walls) w.setData('shell', false).setVisible(false);
  region.objects.push(...walls);
  closed.set(key, walls);
  return walls;
}

/** Shows or hides a set of closed walls, dimmed by how many floors below us they are. */
function show(walls: Wall[], shown: boolean, delta: number): void {
  for (const w of walls) {
    setShown(w, shown);
    if (shown) setDepthShade(w, delta);
  }
}

/** Every closed wall stood so far in a region, so the plain scenery pass leaves them to us. */
export function closedWallsIn(region: DrawnRegion): Wall[] {
  return [...region.buildings, ...region.floors].flatMap((v) => closed.get(v) ?? []);
}

/**
 * Upstairs, stands the walls of every floor beneath us closed and full
 * height: the ground floor of a building we are over or close to, and each
 * lower storey that is drawn. On the ground or underground they all hide.
 * `here` is the storey we stand on, if any.
 */
export function showFloorsBelow(
  scene: Phaser.Scene,
  region: DrawnRegion,
  current: boolean,
  mine: number,
  here: TileRect | undefined,
): void {
  const upstairs = current && mine > 0;
  for (const v of region.buildings) {
    // The same buildings whose inside shows from upstairs (applyFloorView's showUnder).
    const covered = upstairs && Boolean(here && overlaps(here, v.building));
    const under = covered || (upstairs && v.open);
    const walls = under ? closedWalls(scene, region, v) : (closed.get(v) ?? []);
    show(walls, under, mine);
    // Under our feet its rooms are shut in: a kit house's cutaway (planks, low near walls) would draw over the closed walls.
    if (covered && walls.length) for (const o of v.inside) setShown(o, false);
  }
  for (const f of region.floors) {
    const under = upstairs && f.storey.floor > 0 && f.storey.floor < mine;
    if (under) show(closedWalls(scene, region, f), true, mine - f.storey.floor);
    else show(closed.get(f) ?? [], false, 0);
  }
}
