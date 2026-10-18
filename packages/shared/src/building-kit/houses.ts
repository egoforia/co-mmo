import { BUILDING_STYLES } from '../buildings.ts';
import { hashString } from '../random.ts';
import type { Building } from '../world.ts';
import { KIT_LOOKS } from './looks.ts';
import type { BuildingSpec, Opening } from './spec.ts';

// The game's buildings the kit builds. In the game a building's walls are a
// ring of wall tiles round its floor; its kit house stands on that floor, its
// walls on the floor's edges (so inside you walk right up to them), one wall
// section (bay) to every two tiles. Where kit axes meet the grid: a runs
// north and b west from the floor's south-east corner, so the kit's front
// wall is the east wall and its left wall is the south wall, with the door.
// A building whose floor or doorway does not fall on whole bays keeps its
// painted picture, as do odd shapes such as Old Bramble's hollow tree.

/** Tiles to one wall section of a kit house (the Owner's choice of 2026-10-18). */
export const BAY_TILES = 2;

/** Bumped when the way houses are laid out changes, so every house is built again. */
const LAYOUT_VERSION = 1;

/** A game building as the kit builds it. */
export interface KitHouse {
  spec: BuildingSpec;
  /** The kit look it is painted in (KIT_LOOKS). */
  look: string;
  /** Its floor inside the wall tiles, in the region's tiles: the kit house's footprint. */
  floor: { left: number; top: number; right: number; bottom: number };
  /** Names its pictures: the same layout in the same look always draws the same. */
  key: string;
}

/** Bays 1, 3, 5... of a wall n bays long, which get windows. */
function everyOther(n: number): Record<number, Opening> {
  const out: Record<number, Opening> = {};
  for (let j = 1; j < n; j += 2) out[j] = 'window';
  return out;
}

/** The kit house for a building, or undefined when its style has no kit look or it does not fall on whole bays. */
export function kitHouse(b: Building): KitHouse | undefined {
  const look = BUILDING_STYLES[b.style]?.kit;
  if (!look || !KIT_LOOKS[look]) return undefined;
  const floor = { left: b.x + 1, top: b.y + 1, right: b.x + b.width - 1, bottom: b.y + b.height - 1 };
  const [across, deep] = [floor.right - floor.left, floor.bottom - floor.top];
  const door = (b.door.x - floor.left) / BAY_TILES;
  // b runs west along the south wall, whose bays count from its west end as seen from outside.
  const D = across / BAY_TILES;
  const W = deep / BAY_TILES;
  if (!Number.isInteger(D) || !Number.isInteger(W) || D < 1 || W < 1) return undefined;
  if (!Number.isInteger(door) || door < 0 || door >= D || b.door.y !== floor.bottom) return undefined;
  // The door, with windows two bays along on either side of it.
  const south: Record<number, Opening> = { [door]: 'door' };
  for (let j = door % 2; j < D; j += 2) if (j !== door) south[j] = 'window';
  const spec: BuildingSpec = {
    W,
    D,
    storeys: [{ left: south, front: everyOther(W), right: everyOther(D), back: everyOther(W) }],
    // Beside the ridge, which runs along the longer side, towards the back.
    chimney: W >= D ? [Math.round(W * 7) / 10, D / 2 + 0.25] : [W / 2 + 0.25, Math.round(D * 7) / 10],
  };
  const key = `${look}-${W}x${D}-${hashString(JSON.stringify({ spec, look, LAYOUT_VERSION })).toString(36)}`;
  return { spec, look, floor, key };
}

/** A kit house as the server offers it to the game, by its building's place in its region's list. */
export interface KitHouseInfo {
  building: number;
  key: string;
  /** 'building' while it is drawn and checked; 'failed' when a check failed or its textures are not painted yet. */
  status: 'ready' | 'building' | 'failed';
  /** Each view's maps (`outside`, `storey-1`...): its colour picture, the way each pixel faces, and what shines by itself. */
  views?: Record<string, { picture: string; normal: string; glow: string }>;
  /** The pictures' size, and where the kit's corner (the floor's south-east corner, on the ground) is in them, in their pixels; u pixels to a bay. */
  frame?: { width: number; height: number; origin: [number, number]; u: number };
  /** Why it is not shown, in words, when it failed. */
  failed?: string[];
}
