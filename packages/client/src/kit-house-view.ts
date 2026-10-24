import Phaser from 'phaser';
import { buildingKit } from '@co-mmo/shared';
import { PROJECTION } from './projection.ts';
import { STRIP, depthAt, standing, type Floor } from './tile-stand.ts';

// Kit houses in the world, for the isometric camera: the server draws each
// view of a house (its outside, and a cutaway per storey) on one frame, with
// a normal map so the game's light falls on it. Here those pictures are
// loaded and stood on the house's floor, cut into upright strips so a walker
// can pass behind the house and in front of it. Set pieces and furniture
// wider than a tile stand the same way on their footprints.

type KitHouseInfo = buildingKit.KitHouseInfo;
type Frame = NonNullable<KitHouseInfo['frame']>;

/** A region's kit houses, as the server offers them. */
export type HouseSource = (region: string) => Promise<KitHouseInfo[]>;

/** Loads the pictures and normal maps of kit house views, each once, by the URL it came from. */
export class HouseArt {
  private readonly loaded = new Map<string, string>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** The texture key of a house view's picture once it and its normal map have loaded, or undefined if one would not load. */
  async view(info: KitHouseInfo, view: string): Promise<string | undefined> {
    const maps = info.views?.[view];
    if (!maps) return undefined;
    const key = `kit-house-${info.key}-${view}`;
    // The normal map goes first, so the light never works one out for the picture itself.
    const ok = (await this.load(`${key}-normal`, maps.normal)) && (await this.load(key, maps.picture));
    return ok ? key : undefined;
  }

  private async load(key: string, url: string): Promise<boolean> {
    const { textures } = this.scene;
    if (this.loaded.get(key) === url && textures.exists(key)) return true;
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return false;
    }
    if (textures.exists(key)) textures.remove(key);
    textures.addImage(key, img);
    this.loaded.set(key, url);
    return true;
  }
}

/**
 * Stands a house view on its floor as upright strips. Each strip sorts by
 * the house's edge at its place on screen: an outside by its near walls
 * (south and east), so whoever is behind the house is hidden by it all, roof
 * included; a cutaway by its far walls (north and west), so whoever is in
 * the room stands in front of them.
 */
export function standHouse(scene: Phaser.Scene, texture: string, frame: Frame, floor: Floor, outside: boolean): Phaser.GameObjects.Image[] {
  const { left: L, top: T, right: R, bottom: B } = floor;
  // The picture is pinned by the kit's corner, the floor's south-east corner, and scaled so a bay spans its tiles.
  const corner = PROJECTION.toScreen(R, B);
  const scale = (PROJECTION.toScreen(R, B - buildingKit.BAY_TILES).x - corner.x) / frame.u;
  const run: [number, number][] = outside ? [[L, B], [R, B], [R, T]] : [[L, B], [L, T], [R, T]];
  const strips: Phaser.GameObjects.Image[] = [];
  for (let x0 = 0; x0 < frame.width; x0 += STRIP) {
    const w = Math.min(STRIP, frame.width - x0);
    const middle = corner.x + (x0 + w / 2 - frame.origin[0]) * scale;
    const strip = scene.add.image(corner.x, corner.y, texture).setOrigin(frame.origin[0] / frame.width, frame.origin[1] / frame.height);
    strip.setScale(scale).setCrop(x0, 0, w, frame.height).setDepth(depthAt(middle, run));
    strips.push(strip);
  }
  return strips;
}

/**
 * Stands a picture of a thing on the tiles it covers, as `standing` plans
 * it: one picture, or upright strips sorted by the near edges of its tiles.
 */
export function standOnTiles(scene: Phaser.Scene, texture: string, floor: Floor, fitted: boolean): Phaser.GameObjects.Image[] {
  const frame = scene.textures.getFrame(texture);
  const plan = standing(floor, { width: frame.width, height: frame.height }, fitted);
  return plan.strips.map((s) => {
    const img = scene.add.image(plan.x, plan.y, texture).setOrigin(0.5, plan.originY).setScale(plan.scale);
    if (plan.strips.length > 1) img.setCrop(s.x0, 0, s.width, frame.height);
    return img.setDepth(s.depth);
  });
}
