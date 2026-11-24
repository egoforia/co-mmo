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

/** Pictures are judged a slice a frame, this many slices to a sweep: judging thousands every frame cost several milliseconds a frame. */
export const CULL_SLICES = 6;
/** How far the camera may jump, as a share of the margin, before every picture is judged at once (a teleport, a zoom). */
export const JUMP_SHARE = 0.5;

/** Where the camera looked when pictures were last judged. */
export interface Culled {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * True when every picture must be judged now rather than a slice: the first
 * frame, a zoom or resize, or a jump of half the margin. At walking pace the
 * camera moves a few pixels a frame, far less than the margin a sweep of
 * slices has time for.
 */
export function cullAll(last: Culled | undefined, view: Culled): boolean {
  if (!last || view.width !== last.width || view.height !== last.height) return true;
  return Math.abs(view.x - last.x) > view.width * CULL_MARGIN * JUMP_SHARE || Math.abs(view.y - last.y) > view.height * CULL_MARGIN * JUMP_SHARE;
}

/** The part of a list of `count` to judge this frame: from `start`, `CULL_SLICES` frames to go round. */
export function cullSlice(start: number, count: number): { from: number; to: number } {
  const from = start >= count ? 0 : start;
  return { from, to: Math.min(count, from + Math.ceil(count / CULL_SLICES)) };
}

/**
 * Before each frame is drawn, keeps the main camera from drawing the plain
 * world images that lie well off screen. Only unrotated images that scroll
 * with the world are judged; tile layers cull their own tiles, and
 * characters, containers and screen-fixed overlays are always drawn.
 * A slice is judged each frame (cullSlice), all of them after a jump (cullAll).
 */
export function cullOffscreen(scene: Phaser.Scene): void {
  let last: Culled | undefined;
  let next = 0;
  const draw = () => {
    const cam = scene.cameras.main;
    const seen = { x: cam.worldView.x, y: cam.worldView.y, width: cam.worldView.width, height: cam.worldView.height };
    const list = scene.children.list;
    const all = cullAll(last, seen);
    if (all) last = seen;
    const { from, to } = all ? { from: 0, to: list.length } : cullSlice(next, list.length);
    next = to;
    // Measured from where the camera looks now, so each slice is judged right.
    const view = grownView(cam.worldView);
    const bit = cam.id;
    for (let i = from; i < to; i++) {
      const o = list[i]!;
      if (o.type !== 'Image') continue;
      const pic = o as Phaser.GameObjects.Image;
      // Hidden ones cost nothing to draw: only take our bit off, so they show when shown.
      if (!pic.visible) {
        if (pic.cameraFilter & bit) pic.cameraFilter &= ~bit;
        continue;
      }
      if (pic.parentContainer || pic.scrollFactorX !== 1 || pic.scrollFactorY !== 1 || pic.rotation !== 0) continue;
      // pictureBox and apart, without making a box for every picture.
      const width = Math.abs(pic.displayWidth);
      const height = Math.abs(pic.displayHeight);
      const left = pic.x - pic.originX * width;
      const top = pic.y - pic.originY * height;
      const off = left + width < view.left || left > view.right || top + height < view.top || top > view.bottom;
      // Only our own bit: another camera may still draw it.
      pic.cameraFilter = off ? pic.cameraFilter | bit : pic.cameraFilter & ~bit;
    }
    // Each slice is judged from the camera's place now; a jump is measured from the last full judging.
    if (!all && to >= list.length) last = seen;
  };
  scene.events.on(PRE_RENDER, draw);
  scene.events.once(SHUTDOWN, () => scene.events.off(PRE_RENDER, draw));
}
