import { wallBetween } from '../edge-walls.ts';
import { floorChecks, floorName, otherEnd, stairwayAt } from '../floors.ts';
import { isBlocking, tileAt, type RegionMap } from '../world.ts';
import { kitProblems } from './kinds/kit.ts';

// The editor's checks panel: what is wrong with a land as it now stands, in
// plain words, so a Steward finds it before players do. Shape checks are the
// floors' and the kit's own; the walk check follows a player from where they
// arrive, across every floor the stairs join, to everyone, every doorway and
// every gathering spot.

/** What the checks found in a land: each list empty when all is well. */
export interface LandChecks {
  /** Floors, stairs and kit buildings that do not hold together. */
  shapes: string[];
  /** People, doorways and gathering spots a player cannot walk to from where they arrive (bookmarks are places to look from, so they may float). */
  walks: string[];
}

/** The most walk problems listed, so a land shut away by one wall does not bury the panel. */
const MAX_WALKS = 20;

/** Checks a land's shapes and walks. */
export function landChecks(map: RegionMap): LandChecks {
  const shapes = [...floorChecks(map)];
  for (const b of map.buildings) {
    if (b.kit) for (const p of kitProblems(b.kit)) shapes.push(`The building at (${b.x}, ${b.y}): ${p}`);
  }
  const reached = walkable(map);
  const near = (x: number, y: number, floor = 0) => {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    // Standing beside it is enough: people and spots may stand where no one else can.
    return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reached.has(key(map, floor, tx + dx!, ty + dy!)));
  };
  const walks: string[] = [];
  const where = (x: number, y: number, floor = 0) => `(${Math.floor(x)}, ${Math.floor(y)})${floor ? ` on ${floorName(floor)}` : ''}`;
  for (const n of map.npcs) if (!near(n.x, n.y, n.floor)) walks.push(`${n.name} at ${where(n.x, n.y, n.floor)} cannot be walked to.`);
  for (const b of map.buildings) if (!near(b.door.x, b.door.y + 1)) walks.push(`The way into the building at (${b.x}, ${b.y}) cannot be walked to.`);
  for (const s of map.spots) if (!near(s.x, s.y)) walks.push(`The ${s.kind} to gather at ${where(s.x, s.y)} cannot be walked to.`);
  if (walks.length > MAX_WALKS) walks.splice(MAX_WALKS, walks.length, `…and ${walks.length - MAX_WALKS} more.`);
  return { shapes, walks };
}

const key = (map: RegionMap, floor: number, x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? -1 : (floor + 16) * map.width * map.height + y * map.width + x);

/** Every open tile a player can walk to from where they arrive, as keys by floor; the stairs carry them between floors. */
function walkable(map: RegionMap): Set<number> {
  const reached = new Set<number>();
  const queue: [number, number, number][] = [];
  const visit = (floor: number, x: number, y: number) => {
    const k = key(map, floor, x, y);
    if (k < 0 || reached.has(k) || isBlocking(tileAt(map, x, y, floor))) return;
    reached.add(k);
    queue.push([floor, x, y]);
  };
  visit(0, Math.floor(map.spawn.x), Math.floor(map.spawn.y));
  for (let i = 0; i < queue.length; i++) {
    const [floor, x, y] = queue[i]!;
    // A wall on a tile's side (edge-walls.ts) stops the step across it.
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!wallBetween(map, x, y, dx, dy, floor)) visit(floor, x + dx, y + dy);
    // Stepping onto stairs or a ladder carries you to its landing on the other floor (floors.ts walkOn).
    const stairs = stairwayAt(map, x + 0.5, y + 0.5, floor);
    if (stairs) {
      const end = otherEnd(stairs, floor);
      visit(end.floor, Math.floor(end.x), Math.floor(end.y));
    }
  }
  return reached;
}
