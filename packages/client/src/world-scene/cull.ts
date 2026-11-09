// Skips drawing pictures that lie off screen. Phaser draws every visible
// image each frame wherever it stands, and with the Lit pipeline nearly
// every one costs a draw call of its own: in Frostpeak some 6,000 of 7,400
// draw calls a frame went to rocks and walls nobody could see. Culling uses
// the camera filter, not visibility, so it never fights the floor and
// building logic that shows and hides things.

import type Phaser from 'phaser';

// Phaser is only a type here, so the box sums can be tested without a browser.
const PRE_RENDER = 'prerender';
const SHUTDOWN = 'shutdown';

/** A rectangle on the world's screen plane. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Extra room kept round the camera's view, as a share of its size, so pictures are ready before they come in. */
export const CULL_MARGIN = 0.25;

/** The camera's view grown by `margin` of its size on each side. */
export function grownView(view: { x: number; y: number; width: number; height: number }, margin = CULL_MARGIN): Box {
  const dx = view.width * margin;
  const dy = view.height * margin;
  return { left: view.x - dx, top: view.y - dy, right: view.x + view.width + dx, bottom: view.y + view.height + dy };
}

/** Where a picture covers the screen: its size scaled, placed by its origin. */
export function pictureBox(x: number, y: number, width: number, height: number, originX: number, originY: number): Box {
  const left = x - originX * width;
  const top = y - originY * height;
  return { left, top, right: left + width, bottom: top + height };
}

/** True when two boxes share no ground. */
export function apart(a: Box, b: Box): boolean {
  return a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom;
}

/**
 * Before each frame is drawn, keeps the main camera from drawing the plain
 * world images that lie well off screen. Only unrotated images that scroll
 * with the world are judged; tile layers cull their own tiles, and
 * characters, containers and screen-fixed overlays are always drawn.
 */
export function cullOffscreen(scene: Phaser.Scene): void {
  const draw = () => {
    const cam = scene.cameras.main;
    const view = grownView(cam.worldView);
    for (const o of scene.children.list) {
      if (o.type !== 'Image') continue;
      const pic = o as Phaser.GameObjects.Image;
      if (pic.parentContainer || pic.scrollFactorX !== 1 || pic.scrollFactorY !== 1 || pic.rotation !== 0) continue;
      const off = pic.visible && apart(pictureBox(pic.x, pic.y, Math.abs(pic.displayWidth), Math.abs(pic.displayHeight), pic.originX, pic.originY), view);
      // Only our own bit: another camera may still draw it.
      pic.cameraFilter = off ? pic.cameraFilter | cam.id : pic.cameraFilter & ~cam.id;
    }
  };
  scene.events.on(PRE_RENDER, draw);
  scene.events.once(SHUTDOWN, () => scene.events.off(PRE_RENDER, draw));
}
