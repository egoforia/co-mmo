import { Tile, set, type Building, type RegionMap } from '../../world.ts';
import type { TileRect } from '../../floors.ts';
import type { EditKind } from '../kind.ts';
import { thingById } from '../names.ts';
import { OFF_EDGE, clearUnder, floorOf, footprint, inside } from '../tiles.ts';
import type { EditOf, TilePoint } from '../types.ts';

/** A named thing's kind (the middle of its name) in words. */
const THING_WORDS: Record<string, string> = { landmark: 'a piece', building: 'a building', storey: 'a storey', stairway: 'stairs' };

/** True when a rectangle lies wholly inside another. */
function within(inner: TileRect, outer: TileRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** What stands on a tile with no name: a bookmark, a light, a gathering spot, a person or a monster's home. */
function unnamedAt(map: RegionMap, [x, y]: TilePoint, floor: number): (() => void) | undefined {
  const here = (p: { x: number; y: number; floor?: number }) => (p.floor ?? 0) === floor && Math.floor(p.x) === x && Math.floor(p.y) === y;
  const mark = map.bookmarks?.findIndex(here) ?? -1;
  if (mark >= 0) return () => void map.bookmarks!.splice(mark, 1);
  const light = map.lights?.findIndex(here) ?? -1;
  if (light >= 0) return () => void map.lights!.splice(light, 1);
  const spot = floor ? -1 : map.spots.findIndex(here);
  if (spot >= 0) return () => (map.spots.splice(spot, 1), set(map, x, y, Tile.Ground));
  const person = map.npcs.findIndex(here);
  if (person >= 0) return () => void map.npcs.splice(person, 1);
  // A monster's home goes with its whole spawn, when an edit laid it.
  const monster = map.creatures.find(here);
  if (monster) return () => void (map.creatures = map.creatures.filter((c) => c === monster || (monster.spawn && c.spawn === monster.spawn) ? false : true));
  return undefined;
}

/** Takes away what an edit names, with what stands in or on it; false when it is not there. */
function takeAway(map: RegionMap, edit: EditOf<'remove'> | (Omit<EditOf<'remove'>, 'id' | 'by' | 'made'>)): boolean {
  const floor = floorOf(edit);
  const named = thingById(map, edit.target);
  if (edit.target && !named) return false;
  if (!named) {
    const go = unnamedAt(map, edit.at, floor);
    go?.();
    return !!go;
  }
  const drop = <T>(list: T[], gone: (t: T) => boolean) => list.filter((t) => !gone(t));
  const pieceRect = (l: (typeof map.landmarks)[number]) => {
    const f = footprint(l);
    return { x: f.left, y: f.top, width: f.width, height: f.height };
  };
  switch (named.kind) {
    case 'landmark':
      clearUnder(map, footprint(named.thing), named.thing.floor ?? 0);
      map.landmarks = drop(map.landmarks, (l) => l === named.thing);
      return true;
    case 'stairway':
      map.stairways = drop(map.stairways, (s) => s === named.thing);
      return true;
    case 'storey': {
      // Its stairs and furniture go with it.
      const s = named.thing;
      map.storeys = drop(map.storeys, (t) => t === s);
      map.stairways = drop(map.stairways, (w) => (w.lower === s.floor || w.upper === s.floor) && within(w, s));
      map.landmarks = drop(map.landmarks, (l) => (l.floor ?? 0) === s.floor && within(pieceRect(l), s));
      return true;
    }
    case 'building':
      takeBuilding(map, named.thing);
      return true;
  }
}

/** Takes a building away: its walls become open ground; its floors, stairs and furniture go with it. */
export function takeBuilding(map: RegionMap, b: Building): void {
  const pieceRect = (l: (typeof map.landmarks)[number]) => {
    const f = footprint(l);
    return { x: f.left, y: f.top, width: f.width, height: f.height };
  };
  map.buildings = map.buildings.filter((t) => t !== b);
  map.storeys = map.storeys.filter((s) => !within(s, b));
  map.stairways = map.stairways.filter((w) => !within(w, b));
  map.landmarks = map.landmarks.filter((l) => !within(pieceRect(l), b));
  for (let y = b.y; y < b.y + b.height; y++) for (let x = b.x; x < b.x + b.width; x++) set(map, x, y, Tile.Ground);
}

/** Takes away one thing on a land: a building, storey, stairs, piece, spot, person, monster's home or bookmark. */
export const REMOVE: EditKind<'remove'> = {
  kind: 'remove',
  name: 'Take away',
  hint: 'Click a thing to take it away: a building, a storey, stairs, a piece, a gathering spot, a person, a monster’s home, a light or a bookmark.',
  pointer: 'click',
  onFloors: true,
  targets: 'thing',
  fields: [],
  shape: '{"kind":"remove","at":[x,y],"target":"<thing name>"}',
  make: (use) => ({ kind: 'remove', at: use.at, ...(use.target ? { target: use.target } : {}) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (edit.target) return thingById(map, edit.target) ? undefined : 'That is not there any more.';
    return unnamedAt(map, edit.at, floorOf(edit)) ? undefined : 'There is nothing there to take away.';
  },
  apply: takeAway,
  keep: (d) => ({ kind: 'remove', at: d.at }),
  words: (e) => `Took away ${THING_WORDS[e.target?.split(':').at(-2) ?? ''] ?? 'what stood'} at ${e.at.join(', ')}`,
};
