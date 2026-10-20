import Phaser from 'phaser';
import {
  BIOMES,
  BUILDING_STYLES,
  FALLBACK_BUILDING_STYLE,
  TILE_PIXELS,
  Tile,
  buildingArt,
  biomeLook as sharedLook,
  hashString,
  type BiomeId,
  type BiomeLook,
  type BuildingPart,
  type RegionDef,
  type Storey,
} from '@co-mmo/shared';
import { reliefFrom } from './normal-maps.ts';

// Every picture in the world is art painted by the image model: the approved
// anchors, the biome kit and building art. Nothing here is drawn in code; a
// biome or building whose art is missing borrows the Sanctum's or another
// building's until its own is painted.

const T = TILE_PIXELS;
/** Each tile is extruded by this much so filtered tiles never show seams. */
export const TILE_MARGIN = 2;
const TILE_ORDER: Tile[] = [Tile.Ground, Tile.Path, Tile.Water, Tile.Tree, Tile.Rock, Tile.Blocked, Tile.Floor, Tile.Wall, Tile.Door, Tile.Bridge];

/** How a biome is drawn; a wished biome's kit is painted when its first region is wished. */
export function biomeLook(biome: string): BiomeLook {
  return sharedLook((BIOMES[biome as BiomeId] ? biome : 'sanctum') as BiomeId);
}

const SANCTUM = sharedLook('sanctum');
/** The painted planks where a road crosses water. */
const BRIDGE_ART = 'bridge-planks';

export function lightTint(biome: string): number {
  return BIOMES[biome as BiomeId]?.lightTint ?? 0xffffff;
}

/** The first of these art ids that has loaded. */
function loaded(scene: Phaser.Scene, ...ids: string[]): string | undefined {
  return ids.find((id) => scene.textures.exists(id));
}

/**
 * Draws the region's tiles into one strip, indexed by Tile value. Trees and
 * rocks sit on plain ground here; their sprites are placed separately so
 * they can overlap and depth-sort with players.
 */
export function registerTileset(scene: Phaser.Scene, def: RegionDef): string {
  const look = biomeLook(def.biome);
  const sanctum = SANCTUM;
  // Named by the art it uses, so a biome painted later gets a fresh strip.
  const key = `tileset-${def.id}-${[look.ground, look.path, look.water].map((id) => (scene.textures.exists(id) ? 1 : 0)).join('')}`;
  if (scene.textures.exists(key)) return key;
  const ground = loaded(scene, look.ground, sanctum.ground);
  return tileStrip(scene, key, {
    [Tile.Ground]: ground,
    [Tile.Path]: loaded(scene, look.path, sanctum.path),
    [Tile.Water]: loaded(scene, look.water, sanctum.water),
    [Tile.Tree]: ground,
    [Tile.Rock]: ground,
    [Tile.Blocked]: ground,
    // One painted plank bridge serves every land; a road's own tile until it is painted.
    [Tile.Bridge]: loaded(scene, BRIDGE_ART, look.path, sanctum.path),
    ...buildingTiles(scene, FALLBACK_BUILDING_STYLE),
  });
}

/** A strip with a building style's floor, wall and door tiles in their Tile slots. */
export function registerBuildingTileset(scene: Phaser.Scene, style: string): string {
  const key = `tileset-building-${style}`;
  if (scene.textures.exists(key)) return key;
  return tileStrip(scene, key, buildingTiles(scene, style));
}

/**
 * A strip for a floor above or below the ground: its style's tiles, with the
 * kit pieces it names (a sea cave's rock and floor) in their place once painted.
 */
export function registerStoreyTileset(scene: Phaser.Scene, storey: Storey): string {
  const floor = storey.art?.floor && loaded(scene, storey.art.floor);
  const wall = storey.art?.wall && loaded(scene, storey.art.wall);
  if (!floor && !wall) return registerBuildingTileset(scene, storey.style);
  const key = `tileset-storey-${storey.style}-${floor ?? ''}-${wall ?? ''}`;
  if (scene.textures.exists(key)) return key;
  const tiles = buildingTiles(scene, storey.style);
  return tileStrip(scene, key, { ...tiles, ...(floor ? { [Tile.Floor]: floor, [Tile.Door]: floor } : {}), ...(wall ? { [Tile.Wall]: wall } : {}) });
}

/** A building style's inside tiles, each falling back to the fallback style's. */
function buildingTiles(scene: Phaser.Scene, style: string): Partial<Record<Tile, string>> {
  const part = (p: BuildingPart) => loaded(scene, buildingArt(style, p), buildingArt(FALLBACK_BUILDING_STYLE, p));
  return { [Tile.Floor]: part('floor'), [Tile.Wall]: part('wall'), [Tile.Door]: part('door') };
}

/** True when a building style's own outside has been painted and loaded. */
export function hasExterior(scene: Phaser.Scene, style: string): boolean {
  return Boolean(BUILDING_STYLES[style]) && scene.textures.exists(buildingArt(style, 'exterior'));
}

/** Copies art tiles into one strip texture, each extruded so filtered tiles never show seams. */
function tileStrip(scene: Phaser.Scene, key: string, sources: Partial<Record<Tile, string>>): string {
  const step = T + TILE_MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = step * (Math.max(...TILE_ORDER) + 1);
  canvas.height = step;
  const ctx = canvas.getContext('2d')!;
  // Pixel art stays crisp when the art is scaled to the tile.
  ctx.imageSmoothingEnabled = false;
  for (const tile of TILE_ORDER) {
    const art = sources[tile];
    if (!art) continue;
    const source = scene.textures.get(art).getSourceImage() as CanvasImageSource;
    const x = tile * step;
    ctx.drawImage(source, x + TILE_MARGIN, TILE_MARGIN, T, T);
    // Extrude the edges so linear filtering samples matching colours.
    ctx.drawImage(canvas, x + TILE_MARGIN, TILE_MARGIN, T, 1, x + TILE_MARGIN, 0, T, TILE_MARGIN);
    ctx.drawImage(canvas, x + TILE_MARGIN, TILE_MARGIN + T - 1, T, 1, x + TILE_MARGIN, T + TILE_MARGIN, T, TILE_MARGIN);
    ctx.drawImage(canvas, x + TILE_MARGIN, 0, 1, step, x, 0, TILE_MARGIN, step);
    ctx.drawImage(canvas, x + TILE_MARGIN + T - 1, 0, 1, step, x + T + TILE_MARGIN, 0, TILE_MARGIN, step);
  }
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** How far each diamond runs past its edges, in the square tile's pixels, so neighbours overlap and no seam shows between them. */
const DIAMOND_BLEED = 3;
/** Room round each diamond in its strip, so filtering at its tips reads its own paint. */
export const DIAMOND_PAD = 8;

/**
 * The tiles of a square tile strip turned 45 degrees and squashed to half
 * height, for the isometric camera: each painted tile becomes a diamond
 * `width` by `height`, in the same slot. The square's top-left corner is the
 * diamond's top, its east edge runs down to the right and its south edge
 * down to the left. Nothing new is painted: these are the same tiles, turned.
 */
export function registerDiamondTileset(scene: Phaser.Scene, square: string, width: number, height: number): string {
  const key = `${square}-diamond`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get(square).getSourceImage() as HTMLCanvasElement;
  const step = T + TILE_MARGIN * 2;
  const slots = Math.round(source.width / step);
  const [slotW, slotH] = [width + DIAMOND_PAD * 2, height + DIAMOND_PAD * 2];
  const strip = () => {
    const canvas = document.createElement('canvas');
    canvas.width = slotW * slots;
    canvas.height = slotH;
    return canvas;
  };
  const art = strip();
  // The same diamonds running on to fill their slots: the light's map is
  // worked out from these, so a diamond's edge does not read as an outline.
  const shape = strip();
  // One tile three by three, so a diamond can run past its edges into the paint that repeats there.
  const tiled = document.createElement('canvas');
  tiled.width = tiled.height = T * 3;
  const slot = document.createElement('canvas');
  [slot.width, slot.height] = [slotW, slotH];
  const tctx = tiled.getContext('2d')!;
  const sctx = slot.getContext('2d')!;
  // Room enough to fill a slot's corners, which lie this far past the square's edges.
  const fill = Math.ceil(T / 2 + DIAMOND_PAD * T * (1 / width + 1 / height)) + 2;
  for (let k = 0; k < slots; k++) {
    tctx.clearRect(0, 0, tiled.width, tiled.height);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) tctx.drawImage(source, k * step + TILE_MARGIN, TILE_MARGIN, T, T, i * T, j * T, T, T);
    }
    for (const [out, grow] of [[art, DIAMOND_BLEED], [shape, fill]] as const) {
      // Drawn in a slot of its own first, whose edges keep it out of its neighbours' slots.
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, slotW, slotH);
      sctx.setTransform(width / 2 / T, height / 2 / T, -width / 2 / T, height / 2 / T, DIAMOND_PAD + width / 2, DIAMOND_PAD);
      sctx.drawImage(tiled, T - grow, T - grow, T + grow * 2, T + grow * 2, -grow, -grow, T + grow * 2, T + grow * 2);
      out.getContext('2d')!.drawImage(slot, k * slotW, 0);
    }
  }
  reliefFrom(art, shape);
  scene.textures.addCanvas(key, art);
  return key;
}

/**
 * A tree, palm, cactus or rock for a biome, from its biome kit; a biome
 * without one borrows the Sanctum's.
 */
export function propTexture(scene: Phaser.Scene, biome: string, kind: 'tree' | 'rock', variant: number): string | undefined {
  for (const look of [biomeLook(biome), SANCTUM]) {
    const art = (kind === 'rock' ? look.rocks : look.trees).filter((id) => scene.textures.exists(id));
    if (art.length) return art[variant % art.length]!;
  }
  return undefined;
}

/** Which of the two approved player looks a player wears. */
export function playerArt(playerId: string): string {
  return hashString(playerId) % 2 === 0 ? 'player-mara' : 'player-ilya';
}
