import { floorName, type RegionMap } from '@co-mmo/shared';

// The mini map's choices, apart from drawing: how near it looks, which
// floors can be looked at where you stand, and how tiles lie on it for each
// camera. Plain functions, so they are tested without a browser.

/** The mini map's zoom steps: pixels across one tile, from far to near. */
export const MAP_ZOOMS = [1, 1.5, 2, 3, 4, 6, 8] as const;
/** The step it starts at. */
export const MAP_ZOOM_START = 3;

/** The next zoom step nearer (+1) or farther (-1), staying within the steps. */
export function nextZoom(step: number, by: 1 | -1): number {
  return Math.min(MAP_ZOOMS.length - 1, Math.max(0, step + by));
}

/**
 * The floors there are at a tile, highest first: the ground, and every floor
 * of a storey over it (a building's upper floors, the cellars under it). The
 * floor you are on is always among them.
 */
export function floorsAt(map: RegionMap, x: number, y: number, mine: number): number[] {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const floors = new Set([0, mine]);
  for (const s of map.storeys) {
    if (tx >= s.x && ty >= s.y && tx < s.x + s.width && ty < s.y + s.height) floors.add(s.floor);
  }
  return [...floors].sort((a, b) => b - a);
}

/**
 * The floor one up (+1) or down (-1) from the one looked at, among those at
 * this tile; the same floor when there is none further that way.
 */
export function peekStep(floors: number[], looking: number, by: 1 | -1): number {
  const higher = floors.filter((f) => f > looking);
  const lower = floors.filter((f) => f < looking);
  if (by > 0) return higher.length ? Math.min(...higher) : looking;
  return lower.length ? Math.max(...lower) : looking;
}

/** A floor's name with a capital, for the mini map's heading. */
export function floorTitle(floor: number): string {
  const name = floorName(floor);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What the mini map says it is showing: your own floor, or another one you are looking at. */
export function mapCaption(looking: number, mine: number): string {
  if (looking === mine) return floorTitle(mine);
  return `${floorTitle(looking)} (you are on ${floorName(mine)})`;
}

/**
 * How tiles lie on the mini map, as a canvas transform (a, b, c, d, e, f):
 * tile (x, y) is drawn at (a x + c y + e, b x + d y + f). `step` pixels a
 * tile, centred on (cx, cy) in the middle of a map `size` pixels across.
 * Top-down, north is up; in the isometric preview the map turns as the
 * world does on screen, north up and to the right, east down and to the right.
 */
export function mapTransform(camera: 'square' | 'diamond', step: number, cx: number, cy: number, size: number): [number, number, number, number, number, number] {
  // Turned, a tile's diamond is as wide as its square's diagonal, and half as tall.
  const [a, b, c, d] = camera === 'square' ? [step, 0, 0, step] : [step * Math.SQRT1_2, step * Math.SQRT1_2 / 2, -step * Math.SQRT1_2, step * Math.SQRT1_2 / 2];
  const half = size / 2;
  return [a, b, c, d, half - (a * cx + c * cy), half - (b * cx + d * cy)];
}

/** Where tile position (x, y) falls on the map, by a transform from mapTransform. */
export function onMap(t: readonly number[], x: number, y: number): { x: number; y: number } {
  return { x: t[0]! * x + t[2]! * y + t[4]!, y: t[1]! * x + t[3]! * y + t[5]! };
}
