import Phaser from 'phaser';
import { TILE_PIXELS, lightStrength, type Light } from '@co-mmo/shared';

// Point lights for things that burn or glow: a soft pool of added light that
// sits above the biome's shade, so a torch brightens the ground around its
// holder. Phaser's point lights are a WebGL effect; without WebGL there is
// simply no glow.

/** How bright a light is at full strength. */
const INTENSITY = 0.45;
/** How fast it fades towards its edge; Phaser's default. */
const ATTENUATION = 0.1;

/** A light in the world, with the seed that keeps its flicker out of step with others. */
export interface LitPoint {
  light: Light;
  point: Phaser.GameObjects.PointLight;
  seed: number;
}

/** Makes a light at `depth`, or nothing where WebGL is missing. */
export function makeLight(scene: Phaser.Scene, light: Light, depth: number): LitPoint | undefined {
  if (scene.game.renderer.type !== Phaser.WEBGL) return undefined;
  const color = Phaser.Display.Color.HexStringToColor(light.color).color;
  const point = scene.add.pointlight(0, 0, color, light.radius * TILE_PIXELS, INTENSITY, ATTENUATION).setDepth(depth);
  return { light, point, seed: Math.random() * 100 };
}

/** Moves a light to (x, y) and sets how bright it burns at `ms`. */
export function placeLight(lit: LitPoint, x: number, y: number, ms: number, visible: boolean): void {
  lit.point.setPosition(x, y).setVisible(visible);
  lit.point.intensity = INTENSITY * lightStrength(lit.light, ms, lit.seed);
}
