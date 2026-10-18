import type { buildingKit } from '@co-mmo/shared';
import { saveMaps } from './maps.ts';
import type { Texture } from './raster.ts';
import { buildingViews } from './views.ts';

// Drawing one kit house: every view built, drawn and checked, and its maps
// saved only when every check passed. Run in a worker (house-worker.ts).

/** One house to draw: its layout, its look's textures and their tile sizes, the detail, and the folder its maps go in. */
export interface HouseJob {
  spec: buildingKit.BuildingSpec;
  textures: Record<string, Texture>;
  tiles: buildingKit.TileSizes;
  u: number;
  ss: number;
  dir: string;
}

/** What drawing a house made: its views, the frame they share, and every check that failed. */
export interface HouseDrawn {
  views: string[];
  frame?: { width: number; height: number; origin: [number, number]; u: number };
  failed: string[];
}

/** Draws and checks every view of a house; its maps are saved, as `<view>.png` with `-normal` and `-glow`, only when nothing failed. */
export async function drawHouse(job: HouseJob): Promise<HouseDrawn> {
  const views = buildingViews(job.spec, job.textures, { u: job.u, ss: job.ss, tiles: job.tiles });
  const failed = views.flatMap((v) => v.checks.filter((c) => !c.ok).map((c) => `${v.view}: ${c.check}`));
  if (!failed.length) for (const v of views) await saveMaps(job.dir, v.view, v.maps);
  const { maps, origin } = views[0]!;
  return { views: views.map((v) => v.view), frame: { width: maps.width, height: maps.height, origin, u: job.u }, failed };
}
