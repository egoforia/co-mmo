import Phaser from 'phaser';
import { LIGHT_MOD, TILE_PIXELS, lightGlow, lightStrength, modOn, type Light, type Sun } from '@co-mmo/shared';
import { LIT, LIT_FIGURE, setSun } from './lit-pipeline.ts';

// Lighting for the world. Its pictures are drawn with the Lit pipeline
// (lit-pipeline.ts, Phaser's Light2D plus a sun): each pixel is its painted
// colour times the light that reaches it, the sky's colour, the sun or moon
// on the side facing it and any lamp nearby. So a lantern shows its holder
// and the ground around them in their own colours instead of painting a glow
// over them, and nothing gets brighter than lit paint. Characters get a rim
// light too. This is a WebGL effect; without WebGL the sky shades the scene
// with an overlay instead and lights simply do not show.

/** A light in the world, with the seed that keeps its flicker out of step with others. */
export interface LitPoint {
  light: Light;
  point: Phaser.GameObjects.Light;
  seed: number;
}

/** Game objects that show painted pictures and so can be lit. */
const PICTURES = new Set(['Image', 'Sprite', 'TilemapLayer', 'TileSprite']);

/**
 * Turns on lighting for `scene` and lights every picture added to it that
 * sits below `labelDepth` (names and bars stay readable). Returns false when
 * there is no WebGL, so the caller shades the scene another way.
 */
export function lightScene(scene: Phaser.Scene, labelDepth: number): boolean {
  if (scene.game.renderer.type !== Phaser.WEBGL) return false;
  scene.lights.enable().setAmbientColor(0xffffff);
  let added: Phaser.GameObjects.GameObject[] = [];
  const onAdded = (o: Phaser.GameObjects.GameObject) => { added.push(o); };
  // Depth is set just after an object is added, so its pipeline is chosen
  // once the frame is built, before it is drawn.
  const onPreRender = () => {
    for (const o of added) {
      const pic = o as Phaser.GameObjects.Image;
      // Characters were already given the figure pipeline, with its rim light.
      if (pic.active && PICTURES.has(o.type) && pic.depth < labelDepth && pic.pipeline?.name !== LIT_FIGURE) pic.setPipeline(LIT);
    }
    added = [];
  };
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
  scene.events.on(Phaser.Scenes.Events.PRE_RENDER, onPreRender);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdded);
    scene.events.off(Phaser.Scenes.Events.PRE_RENDER, onPreRender);
  });
  return true;
}

/** Lights a character, creature or what they hold with the rim light that keeps them readable. */
export function litFigure<T extends Phaser.GameObjects.Image>(scene: Phaser.Scene, pic: T): T {
  if (scene.lights.active) pic.setPipeline(LIT_FIGURE);
  return pic;
}

/** Sets the light everything gets with no lamp near: the sky's colour, with the sun or moon and the sky's all-round share. */
export function setSkyLight(scene: Phaser.Scene, color: number, sun: Sun, fill: number): void {
  scene.lights.setAmbientColor(color);
  setSun(sun, fill);
}

/** Makes a light, or nothing when the scene is not lit. */
export function makeLight(scene: Phaser.Scene, light: Light): LitPoint | undefined {
  if (!scene.lights.active) return undefined;
  const color = Phaser.Display.Color.HexStringToColor(light.color).color;
  const point = scene.lights.addLight(0, 0, light.radius * TILE_PIXELS, color, lightGlow(0));
  return { light, point, seed: Math.random() * 100 };
}

/** Puts a light out for good. */
export function dropLight(scene: Phaser.Scene, lit: LitPoint | undefined): void {
  if (lit) scene.lights.removeLight(lit.point);
}

/** Moves a light to (x, y) and sets how bright it burns at `ms`, brighter the darker it is (0 day to 1 night). */
export function placeLight(lit: LitPoint, x: number, y: number, ms: number, visible: boolean, dark = 0): void {
  lit.point.setPosition(x, y);
  // A Steward can switch the lighting wish off; its lights go dark until it is on again.
  lit.point.setVisible(visible && modOn(LIGHT_MOD));
  lit.point.intensity = lightGlow(dark) * lightStrength(lit.light, ms, lit.seed);
}
