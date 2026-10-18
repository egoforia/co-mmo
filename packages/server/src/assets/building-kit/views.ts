import { buildingKit } from '@co-mmo/shared';
import { lightNeutralMaps, type KitMaps } from './maps.ts';
import { pictureChecks } from './picture-checks.ts';
import { KitCanvas, render, type Texture } from './raster.ts';

type BuildingSpec = buildingKit.BuildingSpec;
type KitCheck = buildingKit.KitCheck;

// Every view of one kit building, the outside and each storey's cutaway, on
// one pixel frame so they line up, each with its maps and every check.

/** One view: its name, its maps, and every check on its shapes and its picture. */
export interface KitView {
  /** 'outside', or 'storey-1', 'storey-2'... for the cutaways. */
  view: string;
  maps: KitMaps;
  /** Where the kit's corner, (0, 0) on the ground, falls in the maps, in their pixels: where the game pins the picture. */
  origin: [number, number];
  checks: KitCheck[];
  ok: boolean;
}

/** How to draw a building: pixels per bay in the maps, the anti-aliasing factor, and the kit's sizes. */
export interface ViewOptions {
  u: number;
  ss?: number;
  k?: buildingKit.KitSizes;
  tiles?: buildingKit.TileSizes;
}

/** Builds, draws and checks every view of a building. Nothing is shown unless every view is ok. */
export function buildingViews(spec: BuildingSpec, textures: Record<string, Texture>, opts: ViewOptions): KitView[] {
  const cuts = [null, ...spec.storeys.map((_, i) => i)];
  const buildings = cuts.map((cut) => new buildingKit.KitBuilding(spec, { cut, k: opts.k, tiles: opts.tiles }));
  const cv = new KitCanvas(buildings[0]!.faces, opts.u, opts.ss ?? 2);
  return buildings.map((b) => {
    const r = render(b.faces, textures, cv);
    const checks = [...buildingKit.shapeChecks(b), ...pictureChecks(b, r)];
    const origin: [number, number] = [cv.origin[0] / cv.ss, cv.origin[1] / cv.ss];
    return { view: b.cut === null ? 'outside' : `storey-${b.cut + 1}`, maps: lightNeutralMaps(r), origin, checks, ok: checks.every((c) => c.ok) };
  });
}
