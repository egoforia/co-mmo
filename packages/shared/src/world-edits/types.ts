// The shapes of a world edit: what the editor sends (a draft) and what is
// saved (the draft stamped with who made it and when). Kept apart from the
// kinds so every kind, the server and the browser share one vocabulary.

/** A tile position, x east and y south, from the land's top-left corner. */
export type TilePoint = [x: number, y: number];

/** What the paint brush can lay. */
export type PaintTile = 'ground' | 'path' | 'water' | 'tree' | 'rock' | 'wall';

/** Every kind the brush lays, in the order the editor offers them. */
export const PAINT_TILES: PaintTile[] = ['ground', 'path', 'water', 'tree', 'rock', 'wall'];

/** What each brush kind is called in the editor. */
export const PAINT_NAMES: Record<PaintTile, string> = { ground: 'Ground', path: 'Path', water: 'Water', tree: 'Tree', rock: 'Rock', wall: 'Wall' };

/**
 * Where on the land an edit works: its floor, `level` (the ground when missing, as
 * every edit saved before floors were named) and, for edits that change one
 * thing, that thing's name (names.ts). A tile still finds the thing when no
 * name is given.
 */
export interface EditPlace {
  /** The floor it works on (floors.ts numbering); named `level` because a house's `floor` is its size. */
  level?: number;
  target?: string;
}

/** An edit as the editor sends it, before the server stamps who made it and when. */
export type WorldEditDraft = EditPlace & (
  /** Lays one kind of tile on these tiles; a path over water becomes a bridge. */
  | { kind: 'paint'; tile: PaintTile; tiles: TilePoint[] }
  /** Picks up the set piece, tree or rock at `from` and puts it down at `to`, or takes it away when `to` is null. */
  | { kind: 'move'; from: TilePoint; to: TilePoint | null }
  /** A two-tile road from one tile to another, across then down, bridging water. */
  | { kind: 'road'; from: TilePoint; to: TilePoint }
  /** A walled house: its walls' top-left corner, its floor inside them, and its look (a key of BUILDING_STYLES). */
  | { kind: 'house'; at: TilePoint; floor: [width: number, height: number]; style: string }
  /** Monsters of a kind that live around a spot, and come back there after they fall. */
  | { kind: 'spawn'; creature: string; at: TilePoint; count: number }
  /** Sends away every monster living within `radius` tiles of a spot. */
  | { kind: 'clear'; at: TilePoint; radius: number }
  /** Stands a kit set piece (sea-cave-kit.ts) with its footprint's bottom-left tile at `at`. */
  | { kind: 'piece'; piece: string; at: TilePoint }
  /** Gives the building over `at` floors above and below the ground (floors.ts), joined by stairs or ladders; 0 and 0 takes them off. */
  | { kind: 'floors'; at: TilePoint; up: number; down: number; ladders?: boolean }
  /** Gives the set piece or piece of furniture over `at` the tiles it blocks and stands on, still centred under its picture (the Art tab's hit boxes). */
  | { kind: 'footprint'; at: TilePoint; footprint: [width: number, height: number] }
  /** Stands a gathering spot of a kind (gathering.ts) on a tile, or takes away the one there when `spot` is null. */
  | { kind: 'spot'; spot: string | null; at: TilePoint }
  /** A floor above or below the ground over a rectangle, walled round, or an open terrace with low parapets (floors.ts addStorey). */
  | { kind: 'storey'; at: TilePoint; size: [width: number, height: number]; storey: number; style: string; open?: boolean }
  /** A flight of stairs (or a ladder) with its top-left tile at `at`, from floor `from` up to the one above, climbed walking `climbs`. */
  | { kind: 'stairs'; at: TilePoint; size: [width: number, height: number]; from: number; climbs?: 'north' | 'south' | 'east' | 'west'; ladder?: boolean }
  /** A building style's piece of furniture standing on the edit's floor, its picture's bottom centre at `at` (tiles, may be halves); it blocks its footprint unless `walkable`. */
  | { kind: 'furniture'; asset: string; at: TilePoint; footprint: [width: number, height: number]; walkable?: boolean }
);

/** The name of each kind of edit. */
export type EditKindId = WorldEditDraft['kind'];

/** The draft of one kind. */
export type DraftOf<K extends EditKindId> = Extract<WorldEditDraft, { kind: K }>;

/** Who made an edit and when, filled in by the server. */
export interface EditStamp {
  id: string;
  /** The editor's name, for the list of edits. */
  by: string;
  /** When it was made. */
  made: number;
}

/** One saved change to a land; a spawn also keeps its monster's name and picture. */
export type WorldEdit = WorldEditDraft & EditStamp & { name?: string; asset?: string };

/** The saved edit of one kind. */
export type EditOf<K extends EditKindId> = DraftOf<K> & EditStamp & { name?: string; asset?: string };

/** Most tiles one brush stroke may paint. */
export const MAX_STROKE = 400;
/** Most monsters one spawn may hold. */
export const MAX_SPAWN = 12;
/** Widest area the clear tool may empty, in tiles. */
export const MAX_CLEAR_RADIUS = 24;
/** Widest and deepest a set piece's footprint may be, in tiles. */
export const MAX_FOOTPRINT = 8;
/** Smallest and largest floor a house may have, in tiles. */
export const HOUSE_FLOOR = { min: 2, max: 30 };

/**
 * House floors that fall on whole bays of the building kit (two tiles to a
 * bay, the doorway on a bay of its own), so the isometric camera shows each
 * as a kit house when its look has one.
 */
export const KIT_HOUSE_FLOORS: { name: string; floor: [number, number] }[] = [
  { name: 'Small', floor: [6, 6] },
  { name: 'Medium', floor: [10, 8] },
  { name: 'Large', floor: [14, 10] },
];

/** Where a house whose doorstep (the tile just outside its doorway) is at `doorstep` has its walls' top-left corner. */
export function houseCorner(doorstep: TilePoint, floor: [number, number]): TilePoint {
  // building() puts the doorway at left + floor(width / 2) in the south wall, one row above the doorstep.
  return [doorstep[0] - Math.floor(floor[0] / 2), doorstep[1] - floor[1] - 2];
}
