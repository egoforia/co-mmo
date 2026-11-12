import { Tile, type RegionMap } from '../world.ts';
import { copyDraft, type Picked } from './select.ts';
import { footprint } from './tiles.ts';
import type { PaintTile, TilePoint, WorldEditDraft } from './types.ts';

// Copying an area of a land to paste elsewhere, or keep as a prefab: its
// paths, water, trees and rocks, then everything standing wholly inside it
// (buildings, floors, stairs, pieces, spots, people, monsters' homes and
// lights; bookmarks name places, so they stay), as edits whose places are counted from the area's
// north-west corner. Pasting moves them to where it is pasted and lays them
// together, all or none.

/** A copied area: how big it is, and the edits that lay it again, from its corner. */
export interface AreaCopy {
  size: [width: number, height: number];
  drafts: WorldEditDraft[];
}

/** The most edits one copied area may hold. */
export const MAX_AREA_EDITS = 120;

/** The ground tiles a copy carries, by what the brush lays (a function: world.ts and the edits load each other, so Tile is not there yet when this module first runs). */
function scenery(t: Tile): PaintTile | undefined {
  return t === Tile.Path ? 'path' : t === Tile.Water ? 'water' : t === Tile.Tree ? 'tree' : t === Tile.Rock ? 'rock' : undefined;
}

/** Copies the area between two corners: undefined when there is nothing in it. */
export function copyArea(map: RegionMap, a: TilePoint, b: TilePoint): AreaCopy | undefined {
  const x0 = Math.min(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const w = Math.abs(a[0] - b[0]) + 1;
  const h = Math.abs(a[1] - b[1]) + 1;
  const within = (x: number, y: number, bw = 1, bh = 1) => x >= x0 && y >= y0 && x + bw <= x0 + w && y + bh <= y0 + h;
  const drafts: WorldEditDraft[] = [];
  // The ground: one paint edit for each kind of tile, counted from the corner.
  const tiles: Partial<Record<PaintTile, TilePoint[]>> = {};
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const kind = scenery(map.tiles[y * map.width + x] as Tile);
      if (kind && !map.buildings.some((bd) => x >= bd.x && y >= bd.y && x < bd.x + bd.width && y < bd.y + bd.height)) (tiles[kind] ??= []).push([x - x0, y - y0]);
    }
  }
  for (const [tile, list] of Object.entries(tiles)) drafts.push({ kind: 'paint', tile: tile as PaintTile, tiles: list });
  // What stands wholly inside, each copied the way Select copies it, to its place from the corner.
  const things: Picked[] = [];
  const thing = (kind: Picked['kind'], level: number, x: number, y: number, bw = 1, bh = 1, id?: string) => {
    if (within(x, y, bw, bh)) things.push({ kind, level, box: { x, y, w: bw, h: bh }, name: kind, details: [], ...(id ? { id } : {}) });
  };
  for (const bd of map.buildings) thing('building', 0, bd.x, bd.y, bd.width, bd.height);
  for (const s of map.storeys) thing('storey', s.floor, s.x, s.y, s.width, s.height);
  for (const s of map.stairways) thing('stairway', s.lower, s.x, s.y, s.width, s.height);
  for (const l of map.landmarks) {
    const f = footprint(l);
    thing('landmark', l.floor ?? 0, f.left, f.top, f.width, f.height);
  }
  for (const s of map.spots) thing('spot', 0, s.x, s.y);
  for (const n of map.npcs) thing('person', n.floor ?? 0, Math.floor(n.x), Math.floor(n.y), 1, 1, n.id);
  for (const c of map.creatures) thing('monster', c.floor ?? 0, Math.floor(c.x), Math.floor(c.y));
  for (const l of map.lights ?? []) thing('light', l.floor, Math.floor(l.x), Math.floor(l.y));
  for (const p of things) {
    const d = copyDraft(map, p, [p.box.x - x0, p.box.y - y0]);
    if (d) drafts.push(p.kind === 'person' || p.kind === 'light' ? { ...d, ...(p.level ? { level: p.level } : {}) } : d);
  }
  return drafts.length ? { size: [w, h], drafts: drafts.slice(0, MAX_AREA_EDITS) } : undefined;
}

/** A draft moved by so many tiles east and south: every place in it. */
export function shiftDraft(d: WorldEditDraft, dx: number, dy: number): WorldEditDraft {
  const move = (p: TilePoint): TilePoint => [p[0] + dx, p[1] + dy];
  const out = structuredClone(d) as WorldEditDraft & Record<string, unknown>;
  if (Array.isArray(out.at)) out.at = move(out.at as TilePoint);
  if (Array.isArray(out.from)) out.from = move(out.from as TilePoint);
  if (Array.isArray(out.to)) out.to = move(out.to as TilePoint);
  if (Array.isArray(out.tiles)) out.tiles = (out.tiles as TilePoint[]).map(move);
  if (Array.isArray(out.route)) out.route = (out.route as TilePoint[]).map(move);
  // A pasted thing is new: it names nothing that was there.
  delete out.target;
  return out;
}

/** The edits that lay a copied area again with its corner at `to`. */
export function pasteArea(copy: AreaCopy, to: TilePoint): WorldEditDraft[] {
  return copy.drafts.map((d) => shiftDraft(d, to[0], to[1]));
}
