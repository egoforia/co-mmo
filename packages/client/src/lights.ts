import Phaser from 'phaser';
import { LIGHT_MOD, TILE_PIXELS, lightGlow, lightStrength, modOn, type Light } from '@co-mmo/shared';

// Point lights for things that burn or glow: a soft pool of added light that
// sits above the biome's shade, so a torch brightens the ground around its
// holder. Phaser's point lights are a WebGL effect; without WebGL there is
// simply no glow.

// Phaser multiplies a light's colour as 0-255, not 0-1, by its intensity and
// adds the result to the screen, so an intensity near 1 paints a white disc
// over everything. Dividing by 255 makes the intensity the share of the
// colour added at the centre.
/** Turns a share of the light's colour into Phaser's intensity. */
const PER_CHANNEL = 1 / 255;
/** A falloff that is full at the centre and eases smoothly to nothing at the edge. */
const ATTENUATION = 1;

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
  const point = scene.add.pointlight(0, 0, color, light.radius * TILE_PIXELS, lightGlow(0) * PER_CHANNEL, ATTENUATION).setDepth(depth);
  return { light, point, seed: Math.random() * 100 };
}

/** Moves a light to (x, y) and sets how bright it burns at `ms`, brighter the darker it is (0 day to 1 night). */
export function placeLight(lit: LitPoint, x: number, y: number, ms: number, visible: boolean, dark = 0): void {
  // A Steward can switch the lighting wish off; its lights go dark until it is on again.
  lit.point.setPosition(x, y).setVisible(visible && modOn(LIGHT_MOD));
  lit.point.intensity = lightGlow(dark) * PER_CHANNEL * lightStrength(lit.light, ms, lit.seed);
}
