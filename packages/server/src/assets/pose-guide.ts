import sharp from 'sharp';
import { WALK_STEPS, WALK_VIEWS, poseAt, project, type BodyType, type RigPoint, type WalkView } from '@co-mmo/shared';

// Draws pose guides: plain grey figures that show the image model one step of
// a walk, from a body type's skeleton and joint angles. This is the one place
// the game draws pictures in code (the Owner's exception, 2026-10-15):
// players never see a guide, it only steers the painting. Limbs on the near
// side are darker than limbs on the far side, so the model can tell which
// leg is forward.

/** Size of one guide picture, matching the frames it guides. */
export const GUIDE_SIZE = { width: 512, height: 512 };

const INK = { near: '#555555', middle: '#8a8a8a', far: '#c2c2c2', body: '#9c9c9c', outline: '#6e6e6e', ground: '#e2e2e2', paper: '#ffffff' };

/** Body units to pixels, and where the body's origin sits, so every step and view of a body share one scale. */
function framing(body: BodyType, size = GUIDE_SIZE): { scale: number; ox: number; oy: number } {
  let minY = Infinity, maxY = -Infinity, maxX = 0;
  for (const view of WALK_VIEWS) {
    for (let step = 0; step < WALK_STEPS; step++) {
      const { parts, limbs } = poseAt(body, step);
      const points: { p: RigPoint; r: number }[] = [
        ...parts.flatMap((p) => [{ p: p.from, r: p.radius }, ...(p.to ? [{ p: p.to, r: p.radius }] : [])]),
        ...limbs.flatMap((l) => l.joints.map((p) => ({ p, r: l.radius }))),
      ];
      for (const { p, r } of points) {
        const s = project(p, view);
        minY = Math.min(minY, s.y - r);
        maxY = Math.max(maxY, s.y + r);
        maxX = Math.max(maxX, Math.abs(s.x) + r);
      }
    }
  }
  const scale = Math.min((size.height * 0.8) / (maxY - minY), (size.width * 0.45) / maxX);
  return { scale, ox: size.width / 2, oy: size.height * 0.1 - minY * scale };
}

/** The guide for one step of one view, as SVG text. */
export function poseGuideSvg(body: BodyType, view: WalkView, step: number, size = GUIDE_SIZE): string {
  const { scale, ox, oy } = framing(body, size);
  const at = (p: RigPoint) => {
    const s = project(p, view);
    return { x: ox + s.x * scale, y: oy + s.y * scale, depth: s.depth };
  };
  const { parts, limbs } = poseAt(body, step);
  const shapes: { depth: number; svg: string }[] = [];
  for (const part of parts) {
    const a = at(part.from);
    const r = part.radius * scale;
    if (!part.to) {
      shapes.push({ depth: a.depth, svg: `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${INK.body}" stroke="${INK.outline}" stroke-width="3"/>${part.face ? faceMarks(part.from, part.radius, view, at, scale) : ''}` });
      continue;
    }
    const b = at(part.to);
    const line = `x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-linecap="round"`;
    shapes.push({ depth: (a.depth + b.depth) / 2, svg: `<line ${line} stroke="${INK.outline}" stroke-width="${(2 * r + 6).toFixed(1)}"/><line ${line} stroke="${INK.body}" stroke-width="${(2 * r).toFixed(1)}"/>` });
  }
  for (const limb of limbs) {
    const [a, b, c] = limb.joints.map(at) as [ReturnType<typeof at>, ReturnType<typeof at>, ReturnType<typeof at>];
    const depth = (a.depth + b.depth + c.depth) / 3;
    const ink = depth > 1 ? INK.near : depth < -1 ? INK.far : INK.middle;
    const w = (2 * limb.radius * scale).toFixed(1);
    const path = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}L${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
    shapes.push({ depth, svg: `<path d="${path}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` });
  }
  shapes.sort((p, q) => p.depth - q.depth);
  const ground = oy;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
    `<rect width="100%" height="100%" fill="${INK.paper}"/>`,
    `<line x1="0" y1="${ground.toFixed(1)}" x2="${size.width}" y2="${ground.toFixed(1)}" stroke="${INK.ground}" stroke-width="2"/>`,
    ...shapes.map((s) => s.svg),
    '</svg>',
  ].join('\n');
}

/**
 * Eyes on the forward side of the head, so the model can tell which way the
 * figure faces: two in front view, one in profile, none from behind.
 */
function faceMarks(head: RigPoint, radius: number, view: WalkView, at: (p: RigPoint) => { x: number; y: number }, scale: number): string {
  if (view === 'back') return '';
  const eye = (dx: number) => at([head[0] + dx * radius, head[1] + radius * 0.1, head[2] + radius * 0.85]);
  const eyes = view === 'front' ? [eye(0.38), eye(-0.38)] : [eye(view === 'right' ? 0.3 : -0.3)];
  const r = (radius * 0.16 * scale).toFixed(1);
  return eyes.map((e) => `<circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="${r}" fill="${INK.near}"/>`).join('');
}

/** The guide for one step of one view, as a PNG. */
export async function poseGuide(body: BodyType, view: WalkView, step: number, size = GUIDE_SIZE): Promise<Buffer> {
  return sharp(Buffer.from(poseGuideSvg(body, view, step, size))).png().toBuffer();
}

/** All 8 steps of one view side by side, for reviewing a body type's walk. */
export async function poseGuideStrip(body: BodyType, view: WalkView, cell = 192): Promise<Buffer> {
  const size = { width: cell, height: cell };
  const steps = await Promise.all(Array.from({ length: WALK_STEPS }, (_, i) => poseGuide(body, view, i, size)));
  return sharp({ create: { width: cell * WALK_STEPS, height: cell, channels: 3, background: INK.paper } })
    .composite(steps.map((input, i) => ({ input, left: i * cell, top: 0 })))
    .png()
    .toBuffer();
}
