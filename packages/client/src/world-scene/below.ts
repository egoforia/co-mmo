// The floors under us, seen from upstairs: their walls stand closed at full
// height, so a storey rests on solid walls and no one sees into the rooms
// below through their cut-down near walls.

import Phaser from 'phaser';
import { Tile, type RegionMap, type TileRect } from '@co-mmo/shared';
import { type BuildingView, type DrawnRegion, type FloorView, overlaps, setDepthShade, setShown } from './types.ts';
import { standHouseBottom } from '../kit-house-view.ts';
import { floorLift } from './depth.ts';
import { rockWalls } from './walls.ts';

type Wall = Phaser.GameObjects.Image | Phaser.Tilemaps.TilemapLayer;

/** The closed walls stood for each building's ground floor or each storey, made the first time we look down on it. */
const closed = new WeakMap<BuildingView | FloorView, Wall[]>();
/** Which kit house picture (and how many of its storeys) a building's closed walls were cut from, so they are stood again when that changes. */
const cutFrom = new WeakMap<BuildingView, string | undefined>();

/** How many of a kit house's storeys stand under someone on `mine`: those of its painted outside, up to our floor. */
function kitStoreysUnder(v: BuildingView, mine: number): number {
  return v.kitOutside ? Math.max(1, Math.min(mine, v.kitOutside.storeys)) : 0;
}

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
function closedWalls(scene: Phaser.Scene, region: DrawnRegion, key: BuildingView | FloorView, mine: number): Wall[] {
  const made = closed.get(key);
  const kit = 'building' in key ? key.kitOutside : undefined;
  const cut = kit && 'building' in key ? `${kit.texture}@${kitStoreysUnder(key, mine)}` : undefined;
  if (made && (!('building' in key) || cutFrom.get(key) === cut)) return made;
  // Stood before its kit house arrived (or from an older painting): stand them again.
  if (made) {
    for (const w of made) w.destroy();
    region.objects = region.objects.filter((o) => !made.includes(o as Wall));
  }
  const map: RegionMap = region.map;
  const ox = map.def.at.x * map.width;
  const oy = map.def.at.y * map.height;
  let walls: Wall[];
  if ('building' in key && kit) {
    // A kit house: its own painted outside, cut at our floor, so its storeys under us look the same from upstairs as from outside.
    walls = standHouseBottom(scene, kit.texture, kit.frame, kit.floor, floorLift(kitStoreysUnder(key, mine)));
    cutFrom.set(key, cut);
  } else if ('building' in key) {
    const b = key.building;
    cutFrom.set(key, undefined);
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
  // Kit houses shown under us, and how many of their storeys they stand for.
  const kitUnder: { v: BuildingView; storeys: number }[] = [];
  for (const v of region.buildings) {
    // The same buildings whose inside shows from upstairs (applyFloorView's showUnder).
    const covered = upstairs && Boolean(here && overlaps(here, v.building));
    const under = covered || (upstairs && v.open);
    const walls = under ? closedWalls(scene, region, v, mine) : (closed.get(v) ?? []);
    show(walls, under, mine);
    if (under && v.kitOutside) kitUnder.push({ v, storeys: kitStoreysUnder(v, mine) });
    // Under our feet its rooms are shut in: a kit house's cutaway (planks, low near walls) would draw over the closed walls.
    if (covered && walls.length) for (const o of v.inside) setShown(o, false);
  }
  for (const f of region.floors) {
    const s = f.storey;
    // A storey inside a kit house standing under us is already pictured by the house's own walls.
    const pictured = kitUnder.some((k) => s.floor < k.storeys && overlaps(s, k.v.building));
    const under = upstairs && s.floor > 0 && s.floor < mine && !pictured;
    if (under) show(closedWalls(scene, region, f, mine), true, mine - s.floor);
    else show(closed.get(f) ?? [], false, 0);
    // Its floor and furniture are inside the house: drawn over the house's walls they would cover them.
    if (pictured && upstairs && s.floor > 0 && s.floor < mine) for (const o of f.objects) setShown(o, false);
  }
}
