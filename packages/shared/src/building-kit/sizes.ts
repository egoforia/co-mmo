// The kit's sizes and its camera. Every joint sits on a number from one set
// of sizes, so a building is only a layout and its parts cannot drift apart.
// Units are wall sections (bays): a wall runs whole bays from post to post.

import type { Mapping, Vec3 } from './geometry.ts';

/** The camera looks down 30 degrees and is turned 45, so ground lines are true 2:1 diagonals. */
export const C30 = Math.cos(Math.PI / 6);
export const S30 = Math.sin(Math.PI / 6);
export const R2 = Math.SQRT2;
/** Screen right, screen up and towards the camera, in kit space. */
export const RIGHT: Vec3 = [1 / R2, -1 / R2, 0];
export const UP: Vec3 = [S30 / R2, S30 / R2, C30];
export const VIEW: Vec3 = [-C30 / R2, -C30 / R2, S30];

/** A kit point on screen, u pixels per bay along a ground line. */
export function project(p: Vec3, u: number, origin: readonly [number, number] = [0, 0]): [number, number] {
  const k = R2 * u;
  return [origin[0] + k * (p[0] * RIGHT[0] + p[1] * RIGHT[1]), origin[1] - k * (p[0] * UP[0] + p[1] * UP[1] + p[2] * UP[2])];
}

/** Larger means nearer the camera (the depth test). */
export function nearness(p: Vec3): number {
  return p[0] * VIEW[0] + p[1] * VIEW[1] + p[2] * VIEW[2];
}

/** One kit style's sizes, in bays. */
export interface KitSizes {
  /** Wall thickness; walls are centred on grid lines, which are also the blocking lines. */
  t: number;
  /** Square posts at every grid point of a wall; they cover every wall joint. */
  post: number;
  /** The beam along the top of each storey's walls, a little wider than the posts it rests on. */
  plateW: number;
  plateH: number;
  /** Stone footing under the ground storey, proud on the outside only. */
  plinthH: number;
  plinthOut: number;
  /** Storey height, floor of one storey to floor of the next. */
  H: number;
  /** Ground floor top above the ground; upper floors sit floorUp above their beam. */
  floor: number;
  floorUp: number;
  /**
   * A cutaway cuts the near walls this high above the floor. On the ground
   * floor that is level with the top of the footing, so no sliver of wall
   * shows above the stone, and the strip of floor hidden behind a cut wall
   * (cut / tan 30 / sqrt 2, about 0.18 deep) leaves stairs beside it in view.
   */
  cut: number;
  doorW: number;
  doorH: number;
  doorFacets: number;
  winW: number;
  winH: number;
  /** Sill height above the floor. */
  winSill: number;
  /** A door leaf or window pane, in the middle of the wall. */
  leaf: number;
  /** Timber trim round openings, proud of the wall. */
  trimW: number;
  trimD: number;
  sillD: number;
  /** Roof pitch in degrees. */
  pitch: number;
  roofT: number;
  eave: number;
  verge: number;
  ridge: number;
  /** Half width of the king post on a gable, as wide as the posts it stands over. */
  king: number;
  chimney: number;
  chimneyUp: number;
  stairW: number;
  stairGo: number;
  stairN: number;
}

/** The timber-frame kit's sizes. */
export const K: KitSizes = {
  t: 0.12,
  post: 0.18,
  plateW: 0.2,
  plateH: 0.1,
  plinthH: 0.25,
  plinthOut: 0.06,
  H: 1.6,
  floor: 0.1,
  floorUp: 0.05,
  cut: 0.15,
  doorW: 0.55,
  doorH: 1.2,
  doorFacets: 8,
  winW: 0.45,
  winH: 0.5,
  winSill: 0.55,
  leaf: 0.02,
  trimW: 0.06,
  trimD: 0.03,
  sillD: 0.06,
  pitch: 45,
  roofT: 0.08,
  eave: 0.1,
  verge: 0.2,
  ridge: 0.07,
  king: 0.09,
  chimney: 0.36,
  chimneyUp: 0.45,
  stairW: 0.5,
  stairGo: 0.22,
  stairN: 8,
};

/** World size of one repeat of each tiled texture; a painted sheet may give its own. */
export type TileSizes = Record<string, readonly [number, number]>;

export const TILE: TileSizes = {
  plaster: [1, 1],
  timber: [1.5, 0.35],
  stone: [1, 0.5],
  floor: [1, 1],
  roof: [1.5, 1],
};

/** A tiled texture's mapping, its grain along a direction when given. */
export function tile(name: string, grain?: Vec3, tiles: TileSizes = TILE): Mapping {
  const size = tiles[name];
  if (!size) throw new Error(`no tile size for ${name}`);
  return grain ? { kind: 'tile', s: size[0], t: size[1], grain } : { kind: 'tile', s: size[0], t: size[1] };
}

/** A building's four walls. */
export type Side = 'front' | 'right' | 'back' | 'left';
export const SIDES: readonly Side[] = ['front', 'right', 'back', 'left'];

/**
 * Each wall's outward normal and where its bay 0 starts; bays count left to
 * right as seen from outside. 'front' and 'left' are the walls nearest the camera.
 */
export const RUNS: Record<Side, { out: Vec3; start: (W: number, D: number) => [number, number] }> = {
  front: { out: [0, -1, 0], start: () => [0, 0] },
  right: { out: [1, 0, 0], start: (W) => [W, 0] },
  back: { out: [0, 1, 0], start: (W, D) => [W, D] },
  left: { out: [-1, 0, 0], start: (_W, D) => [0, D] },
};
