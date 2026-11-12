import { BUILDING_STYLES, furnitureArt } from '../buildings.ts';
import { shopOf } from '../kit.ts';
import { NPC_GREETINGS } from '../rpg.ts';
import { routineOf } from '../routines.ts';
import { SPOTS } from '../gathering.ts';
import { floorName, stairwayAt, type Heading, type Stairway } from '../floors.ts';
import { setPiece } from '../sea-cave-kit.ts';
import { Tile, storeyAt, type Landmark, type RegionMap } from '../world.ts';
import type { Outline } from './kind.ts';
import { buildingAt, footprint, landmarkAt, tileOn } from './tiles.ts';
import type { TilePoint, WorldEditDraft } from './types.ts';

// The editor's Select tool: what stands on a tile of a floor, picked as one
// thing (a building, a storey, a flight of stairs, a piece, a spot, a person,
// a monster's home or a bookmark), and the edits that take it away, copy it
// or move it elsewhere. Edits made from a pick name the thing when it has a
// name, so they find it again whatever the tile.

/** What can be picked. */
export type PickKind = 'building' | 'storey' | 'stairway' | 'landmark' | 'spot' | 'monster' | 'person' | 'bookmark';

/** A thing picked on a land: what it is, its name there, and its box on the floor. */
export interface Picked {
  kind: PickKind;
  /** Its name on the land (names.ts), for things that have one. */
  id?: string;
  /** What to call it in the editor. */
  name: string;
  /** Its floor, and the box of tiles it covers there; `box.x, box.y` is where a copy's corner goes. */
  level: number;
  box: Outline;
  /** A few more words about it (size, look, floors joined). */
  details: string[];
}

/** The thing standing on a tile of a floor, the smallest and nearest first; undefined on bare ground. */
export function pickAt(map: RegionMap, at: TilePoint, level: number): Picked | undefined {
  const [x, y] = at;
  const tile = (bx: number, by: number, w = 1, h = 1): Outline => ({ x: bx, y: by, w, h });
  const mark = map.bookmarks?.find((b) => b.floor === level && Math.floor(b.x) === x && Math.floor(b.y) === y);
  if (mark) return { kind: 'bookmark', name: `Bookmark “${mark.name}”`, level, box: tile(x, y), details: mark.note ? [mark.note] : [] };
  const spot = !level ? map.spots.find((s) => s.x === x && s.y === y) : undefined;
  if (spot) return { kind: 'spot', name: SPOTS[spot.kind]?.name ?? 'A gathering spot', level, box: tile(x, y), details: [] };
  const person = map.npcs.find((n) => (n.floor ?? 0) === level && Math.floor(n.x) === x && Math.floor(n.y) === y);
  if (person) return { kind: 'person', id: person.id, name: person.name, level, box: tile(x, y), details: ['Where they start the day.'] };
  const monster = map.creatures.find((c) => (c.floor ?? 0) === level && Math.floor(c.x) === x && Math.floor(c.y) === y);
  if (monster) return { kind: 'monster', name: `${monster.name}’s home`, level, box: tile(x, y), details: ['It comes back here after it falls.'] };
  const piece = landmarkAt(map, at, level);
  if (piece) {
    const f = footprint(piece);
    return { kind: 'landmark', ...(piece.id ? { id: piece.id } : {}), name: pieceName(piece), level, box: tile(f.left, f.top, f.width, f.height), details: [`${f.width} × ${f.height} tiles`] };
  }
  const way = stairwayAt(map, x + 0.5, y + 0.5, level);
  if (way) {
    return { kind: 'stairway', ...(way.id ? { id: way.id } : {}), name: way.kind === 'ladder' ? 'A ladder' : 'Stairs', level, box: tile(way.x, way.y, way.width, way.height), details: [`From ${floorName(way.lower)} up to ${floorName(way.upper)}`, `Climbing ${climbing(way)}`] };
  }
  const storey = level ? storeyAt(map, x, y, level) : undefined;
  if (storey) {
    const look = BUILDING_STYLES[storey.style]?.name ?? storey.style;
    return { kind: 'storey', ...(storey.id ? { id: storey.id } : {}), name: storey.open ? 'A terrace' : 'A storey', level, box: tile(storey.x, storey.y, storey.width, storey.height), details: [`${storey.width} × ${storey.height} tiles on ${floorName(level)}`, look] };
  }
  const building = !level ? buildingAt(map, at) : undefined;
  if (building) {
    const look = BUILDING_STYLES[building.style]?.name ?? building.style;
    return { kind: 'building', ...(building.id ? { id: building.id } : {}), name: look, level, box: tile(building.x, building.y, building.width, building.height), details: [`${building.width} × ${building.height} tiles, walls included`] };
  }
  return undefined;
}

/** What a set piece or piece of furniture is called. */
function pieceName(l: Landmark): string {
  const piece = setPiece(l.asset);
  if (piece) return piece.name;
  for (const style of Object.values(BUILDING_STYLES)) {
    for (const [key, f] of Object.entries(style.furniture)) if (furnitureArt(style.id, key) === l.asset) return `${style.name}: ${f.name}`;
  }
  return 'A piece';
}

/** Which way a flight is climbed, from where its top landing lies. */
function climbing(s: Stairway): Heading {
  if (s.top.y < s.y) return 'north';
  if (s.top.y >= s.y + s.height) return 'south';
  return s.top.x < s.x ? 'west' : 'east';
}

/** The edit that takes a picked thing away. */
export function removeDraft(p: Picked): WorldEditDraft {
  return { kind: 'remove', at: [p.box.x, p.box.y], level: p.level, ...(p.id ? { target: p.id } : {}) };
}

/**
 * The edit that lays a copy of a picked thing with its box's corner at `to`,
 * or undefined when it cannot be copied. Read from the land
 * as it stands, so a copy of a generated house is a house of its size and look.
 */
export function copyDraft(map: RegionMap, p: Picked, to: TilePoint): WorldEditDraft | undefined {
  const [dx, dy] = [to[0] - p.box.x, to[1] - p.box.y];
  const [x, y] = [p.box.x, p.box.y];
  switch (p.kind) {
    case 'building': {
      const b = buildingAt(map, [x, y]);
      return b && { kind: 'house', at: [b.x + dx, b.y + dy], floor: [b.width - 2, b.height - 2], style: b.style };
    }
    case 'storey': {
      const s = storeyAt(map, x, y, p.level);
      return s && { kind: 'storey', at: [s.x + dx, s.y + dy], size: [s.width, s.height], storey: s.floor, style: s.style, ...(s.open ? { open: true } : {}) };
    }
    case 'stairway': {
      const s = stairwayAt(map, x + 0.5, y + 0.5, p.level);
      return s && { kind: 'stairs', at: [s.x + dx, s.y + dy], size: [s.width, s.height], from: s.lower, climbs: climbing(s), ...(s.kind === 'ladder' ? { ladder: true } : {}) };
    }
    case 'landmark': {
      const l = landmarkAt(map, [x, y], p.level);
      if (!l) return undefined;
      const level = p.level ? { level: p.level } : {};
      if (setPiece(l.asset)) return { kind: 'piece', piece: l.asset, at: [x + dx, y + dy + l.footprint.height - 1], ...level };
      // It was walked through when the tiles under it are not blocked.
      const walkable = tileOn(map, [x, y], p.level) !== Tile.Blocked;
      return { kind: 'furniture', asset: l.asset, at: [l.x + dx, l.y + dy], footprint: [l.footprint.width, l.footprint.height], ...(walkable ? { walkable: true } : {}), ...level };
    }
    case 'spot': {
      const s = map.spots.find((g) => g.x === x && g.y === y);
      return s && { kind: 'spot', spot: s.kind, at: to };
    }
    case 'monster': {
      const c = map.creatures.find((m) => (m.floor ?? 0) === p.level && Math.floor(m.x) === x && Math.floor(m.y) === y);
      return c && { kind: 'spawn', creature: c.kind, at: to, count: 1, ...(p.level ? { level: p.level } : {}) };
    }
    case 'person': {
      // Someone new, the same in every way but their name on the land.
      const n = map.npcs.find((m) => m.id === p.id);
      return n && { kind: 'person', at: to, name: n.name, look: n.asset, ...(n.greeting ?? NPC_GREETINGS[n.id] ? { greeting: n.greeting ?? NPC_GREETINGS[n.id] } : {}), ...(shopOf(n) ? { shop: structuredClone(shopOf(n)!) } : {}), routine: routineOf(n.id, n.routine), ...(p.level ? { level: p.level } : {}) };
    }
    case 'bookmark': {
      const b = map.bookmarks?.find((m) => m.floor === p.level && Math.floor(m.x) === x && Math.floor(m.y) === y);
      // Names are one to a land: a copy takes the next free number.
      const taken = new Set(map.bookmarks?.map((m) => m.name));
      let n = 2;
      while (taken.has(`${b?.name} ${n}`)) n++;
      return b && { kind: 'bookmark', at: [b.x + dx, b.y + dy], name: `${b.name} ${n}`.slice(-40), ...(b.note ? { note: b.note } : {}), level: p.level };
    }
    default:
      return undefined;
  }
}

/**
 * The edits that move a picked thing so its box's corner lands on `to`: a set
 * piece or piece of furniture moves itself, and so does a person (keeping who
 * they are, on the floor shown); anything else is taken away and laid again
 * there, both in one step.
 */
export function moveDrafts(map: RegionMap, p: Picked, to: TilePoint, level = p.level): WorldEditDraft[] | undefined {
  if (p.kind === 'landmark') return [{ kind: 'move', from: [p.box.x, p.box.y], to, level: p.level, ...(p.id ? { target: p.id } : {}) }];
  if (p.kind === 'person') return p.id ? [{ kind: 'person', at: to, target: p.id, ...(level ? { level } : {}) }] : undefined;
  const copy = copyDraft(map, p, to);
  return copy && [removeDraft(p), copy];
}
