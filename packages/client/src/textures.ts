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
} from '@co-mmo/shared';

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
