import sharp from 'sharp';
import type { Footprint } from '@co-mmo/shared';
import { KEY_COLOR } from './style.ts';

// The footprint guide sent with every painting of a thing that stands on
// tiles (a set piece, a prop with a footprint, furniture): the patch it
// stands on, outlined on the key colour at the game's exact 2:1 angle and
// proportions. Told only in words, the image models guessed the angle (a
// herb rack came back with its base edges at about 16 degrees where the
// tiles slope at 27) and the depth. Like the building doorway sketch, the
// guide only steers the model and is never shown to players. It is thin
// lines and dots, not a filled shape: a filled patch is painted as a floor.

/** The guide's size in pixels: square, like the paintings it goes with. */
export const GUIDE_SIZE = 1024;
/** How wide the patch is drawn, as a share of the guide: room above it for a tall thing. */
const PATCH_SHARE = 0.5;
/** Where the patch's front corner sits, as a share of the guide's height from the top. */
const FRONT_AT = 0.9;
/** Line and dot colour: plain white, far from the key so the model reads it as marks. */
const MARK = '#ffffff';

/** A point in the guide's pixels. */
export interface GuidePoint {
  x: number;
  y: number;
}

/** The patch's corners as drawn, and how wide half a tile is on it. */
export interface GuidePatch {
  left: GuidePoint;
  front: GuidePoint;
  right: GuidePoint;
  back: GuidePoint;
  /** Half a tile's width in guide pixels (a tile's diamond is twice this across and this high). */
  half: number;
}

/**
 * Where a footprint's patch is drawn on the guide. Its width runs from the
 * left corner down to the front corner and its height from the front corner
 * up to the right corner, as in the game's camera (`footprintWords`), each
 * edge sloping one down for two across.
 */
export function guidePatch(fp: Footprint): GuidePatch {
  const half = (GUIDE_SIZE * PATCH_SHARE) / (fp.width + fp.height);
  const x0 = (GUIDE_SIZE - (fp.width + fp.height) * half) / 2;
  const front = { x: x0 + fp.width * half, y: GUIDE_SIZE * FRONT_AT };
  const left = { x: x0, y: front.y - (fp.width * half) / 2 };
  const right = { x: x0 + (fp.width + fp.height) * half, y: front.y - (fp.height * half) / 2 };
  const back = { x: x0 + fp.height * half, y: left.y - (fp.height * half) / 2 };
  return { left, front, right, back, half };
}

/** The guide as SVG: the patch's outline, faint lines between its tiles, and a dot on each corner. */
export function guideSvg(fp: Footprint): string {
  const p = guidePatch(fp);
  const n = (v: number) => Math.round(v * 10) / 10;
  const line = (a: GuidePoint, b: GuidePoint, width: number, dash = '') =>
    `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${MARK}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
  const along = (a: GuidePoint, b: GuidePoint, t: number): GuidePoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const inner: string[] = [];
  // Lines between tiles, so the model sees how many tiles each side is.
  for (let i = 1; i < fp.width; i++) inner.push(line(along(p.left, p.front, i / fp.width), along(p.back, p.right, i / fp.width), 2, '10 10'));
  for (let i = 1; i < fp.height; i++) inner.push(line(along(p.front, p.right, i / fp.height), along(p.left, p.back, i / fp.height), 2, '10 10'));
  const edges = [[p.left, p.front], [p.front, p.right], [p.right, p.back], [p.back, p.left]] as const;
  const dots = [p.left, p.front, p.right, p.back].map((c) => `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="9" fill="${MARK}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GUIDE_SIZE}" height="${GUIDE_SIZE}">
<rect width="100%" height="100%" fill="${KEY_COLOR.hex}"/>
${inner.join('\n')}
${edges.map(([a, b]) => line(a, b, 4)).join('\n')}
${dots.join('\n')}
</svg>`;
}

/** The guide as a PNG, ready to send with a painting. */
export async function footprintGuide(fp: Footprint): Promise<Buffer> {
  return sharp(Buffer.from(guideSvg(fp))).png().toBuffer();
}

/** What the guide is, as God's View lists it beside the other references. */
export const GUIDE_LABEL = 'Footprint guide: the tiles it stands on';
