// Spatial visibility rules for avatars (players, creatures, monsters, NPCs, bodies)
// across multiple storeys, underground caverns, terraces and buildings.

import {
  storeyAt,
  type RegionMap,
  type Storey,
  type TileRect,
} from '@co-mmo/shared';

/** True when two tile rectangles overlap. */
export function overlaps(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** True when (x, y) lies inside a tile rectangle. */
export function within(b: Pick<TileRect, 'x' | 'y' | 'width' | 'height'>, x: number, y: number): boolean {
  return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
}

/** Finds a storey on `floor` covering tile (x, y). */
export function floorAt<F extends { storey: Storey }>(floors: F[], x: number, y: number, floor: number): F | undefined {
  return floors.find(({ storey: s }) => s.floor === floor && x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height);
}

export interface VisibleFloor {
  storey: Storey;
  visible?: boolean;
}

export interface VisibleBuilding {
  building: { x: number; y: number; width: number; height: number };
  ox: number;
  oy: number;
  open: boolean;
}

export interface VisibleRegion {
  map: RegionMap;
  floors: VisibleFloor[];
  buildings: VisibleBuilding[];
}

/**
 * True when an avatar (player, creature, NPC, or body) standing at (wx, wy) on
 * `floor` is visible to a player standing at `shown` on `mine`.
 */
export function isAvatarVisible(
  region: VisibleRegion | undefined,
  mine: number,
  shown: { x: number; y: number },
  wx: number,
  wy: number,
  floor: number,
  isNpc = false,
): boolean {
  // NPCs only appear on our own floor.
  if (isNpc && floor !== mine) return false;

  // Underground floors are completely isolated: only our exact floor shows.
  if (floor !== mine && (floor < 0 || mine < 0)) return false;

  if (!region) return floor === mine;

  const ox = region.map.def.at.x * region.map.width;
  const oy = region.map.def.at.y * region.map.height;
  const rx = wx - ox;
  const ry = wy - oy;
  const tx = Math.floor(rx);
  const ty = Math.floor(ry);

  // If the entity is on an upper floor above us:
  if (floor > mine) {
    const f = floorAt(region.floors, tx, ty, floor);
    // Upper storey must exist, be open (terrace/balcony, not an enclosed room), and be visible.
    if (!f || !f.visible || !f.storey.open) return false;
    // An upper storey over a closed building stays hidden from the ground.
    if (region.map.buildings.some((b) => overlaps(f.storey, b))) return false;
    return true;
  }

  // If the entity is on the same floor as us:
  if (floor === mine) {
    if (mine === 0) {
      // People/monsters inside a closed ground-floor building stay hidden until we step close enough to cut it open.
      const inClosedBuilding = region.buildings.some(
        (v) => !v.open && within(v.building, Math.floor(rx), Math.floor(ry)),
      );
      if (inClosedBuilding) return false;
    }
    return true;
  }

  // If the entity is on a lower floor below us (mine > 0 && floor >= 0):
  // Solid floor under our feet covers whoever stands directly beneath us.
  const here = storeyAt(region.map, Math.floor(shown.x), Math.floor(shown.y), mine);
  if (here && within(here, tx, ty)) return false;

  // Ground-floor buildings beneath us remain closed with their roofs on unless cut open.
  if (floor === 0) {
    const inClosedBuilding = region.buildings.some(
      (v) => !v.open && within(v.building, Math.floor(rx), Math.floor(ry)),
    );
    if (inClosedBuilding) return false;
  } else {
    // Intermediate lower terrace must exist and be visible.
    const f = floorAt(region.floors, tx, ty, floor);
    if (!f || !f.visible) return false;
  }

  return true;
}
