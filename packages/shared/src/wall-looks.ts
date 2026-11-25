import { BUILDING_STYLES } from './buildings.ts';
import type { Storey } from './floors.ts';
import { Tile, storeyAt, tileAt, type Building, type RegionMap } from './world.ts';

// One wall tile of a walled building or storey (a cave, a tomb, a tree, a
// galleon, any floor off the ground) in a look of its own, beside the look
// the rest of its walls keep. A building or storey with none draws exactly
// as before. Kit houses build their walls as whole bays, one look per house,
// so their wall tiles are not changed one by one.

/** Something whose walls are wall tiles: a building on the ground or a storey. */
export type WallTiles = (Building | Storey) & { wallLooks?: Record<string, string> };

const key = (x: number, y: number) => `${x},${y}`;

/** The look (a key of BUILDING_STYLES) a wall tile of a building or storey is drawn in: its own, else the building's. */
export function wallLookAt(owner: WallTiles, x: number, y: number): string {
  return owner.wallLooks?.[key(x, y)] ?? owner.style;
}

/** Gives one wall tile its own look; the building's own look takes the tile's own away. */
export function setWallLook(owner: WallTiles, x: number, y: number, look: string): void {
  if (look === owner.style) {
    if (owner.wallLooks) delete owner.wallLooks[key(x, y)];
    if (owner.wallLooks && !Object.keys(owner.wallLooks).length) delete owner.wallLooks;
    return;
  }
  (owner.wallLooks ??= {})[key(x, y)] = look;
}

/** True when a building is a kit house, or a storey is one of a kit house's: its walls change together. */
export function isKitHouse(map: RegionMap, owner: WallTiles): boolean {
  const kit = (b: Building) => Boolean(BUILDING_STYLES[b.style]?.kit);
  if ('door' in owner) return kit(owner);
  return map.buildings.some((b) => kit(b) && owner.x >= b.x && owner.y >= b.y && owner.x + owner.width <= b.x + b.width && owner.y + owner.height <= b.y + b.height);
}

/** The building (on the ground) or storey (off it) whose wall tile (x, y) is on a floor, if it is one. */
export function wallTileOwner(map: RegionMap, x: number, y: number, floor: number): WallTiles | undefined {
  if (floor) {
    const s = storeyAt(map, x, y, floor);
    return s && tileAt(map, x, y, floor) === Tile.Wall ? s : undefined;
  }
  const b = map.buildings.find((o) => x >= o.x && y >= o.y && x < o.x + o.width && y < o.y + o.height);
  return b && map.tiles[y * map.width + x] === Tile.Wall ? b : undefined;
}
