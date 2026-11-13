import type Phaser from 'phaser';
import type { Outline, RegionMap } from '@co-mmo/shared';
import type { WorldScene } from '../world-scene.ts';

// How edit mode hears the world: the pointer over it, the wheel, a right or
// middle drag to pan, and each frame (for the pan keys and the marks); and
// how it draws its outlines there. Plain wiring, so in-game.ts keeps to what
// the editor does with it.

/** Above everything in the world, labels included. */
export const OUTLINE_DEPTH = 1_000_010;
const TONES: Record<NonNullable<Outline['tone']>, number> = { aim: 0xf2dc6b, held: 0x6fd08c, warn: 0xf6757a };

/** What a pointer did over the world. */
export type PointerKind = 'hover' | 'down' | 'drag' | 'up';

/** What edit mode does with what the world hears. */
export interface WorldHooks {
  open(): boolean;
  zoom(direction: 1 | -1): void;
  pointer(p: Phaser.Input.Pointer, kind: PointerKind): void;
  /** Each frame while the scene runs, with its length in ms. */
  frame(deltaMs: number): void;
}

/** Listens to a running scene for edit mode. */
export function hearWorld(scene: WorldScene, hooks: WorldHooks): void {
  scene.events.on('update', (_time: number, delta: number) => {
    if (hooks.open()) hooks.frame(delta);
  });
  // The wheel zooms; dragging with the right or middle button pans.
  scene.input.mouse?.disableContextMenu();
  scene.input.on('wheel', (_p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
    if (hooks.open() && dy) hooks.zoom(dy > 0 ? -1 : 1);
  });
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (hooks.open() && (p.rightButtonDown() || p.middleButtonDown())) return scene.panCamera(p.prevPosition.x - p.x, p.prevPosition.y - p.y);
    hooks.pointer(p, p.isDown ? 'drag' : 'hover');
  });
  scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
    if (p.leftButtonDown()) hooks.pointer(p, 'down');
  });
  scene.input.on('pointerup', (p: Phaser.Input.Pointer) => hooks.pointer(p, 'up'));
}

/** Draws boxes of tiles over a land, each in its tone, after clearing what was drawn before. */
export function strokeOutlines(g: Phaser.GameObjects.Graphics | undefined, scene: WorldScene, map: RegionMap, outlines: Outline[]): void {
  if (!g) return;
  g.clear();
  for (const o of outlines) {
    g.lineStyle(2, TONES[o.tone ?? 'aim'], 0.95);
    g.strokePoints(scene.tileCorners(map, o.x, o.y, o.w, o.h), true);
  }
}
