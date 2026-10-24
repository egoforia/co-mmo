// Where a figure stands in its picture: the rows its solid pixels span, and
// which frame of a walk strip sets the line its feet rest on.

/** Pixels see-through up to this alpha are background, not figure. */
const SOLID_ALPHA = 16;

/** The rows a figure spans inside one frame, counted from the frame's top. */
export interface FigureRows {
  top: number;
  bottom: number;
}

/** A frame's rectangle inside its picture. */
export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The first and last rows of `frame` holding a solid pixel, in RGBA pixels
 * `data` of a picture `width` wide; undefined when the frame is empty.
 */
export function figureRows(data: ArrayLike<number>, width: number, frame: FrameRect): FigureRows | undefined {
  const solid = (y: number) => {
    const row = (frame.y + y) * width;
    for (let x = frame.x; x < frame.x + frame.width; x++) if (data[(row + x) * 4 + 3]! > SOLID_ALPHA) return true;
    return false;
  };
  let top = 0;
  let bottom = frame.height - 1;
  while (top < frame.height && !solid(top)) top++;
  if (top === frame.height) return undefined;
  while (bottom > top && !solid(bottom)) bottom--;
  return { top, bottom };
}

/**
 * The frame a walk stands on: the one whose lowest foot is highest. In a
 * walk filmed in place, that is where the legs pass and the foot under the
 * body is planted; in the other frames the lowest foot is the one stepping
 * toward us, so it reaches lower. Standing every frame on this one keeps
 * each foot on or in front of the shadow, never lifted above it, whichever
 * pose the strip happens to start with.
 */
export function groundFrame(frames: (FigureRows | undefined)[]): number {
  let best = -1;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f && (best < 0 || f.bottom < frames[best]!.bottom)) best = i;
  }
  return Math.max(0, best);
}

/**
 * How tall a figure is and the vertical origin that rests its feet on the
 * ground, for a frame `frameHeight` tall: the origin sits a little above
 * the lowest row so the feet sink just into the shadow.
 */
export function standingMetrics(rows: FigureRows | undefined, frameHeight: number): { height: number; originY: number } {
  if (!rows) return { height: frameHeight, originY: 1 };
  const height = rows.bottom - rows.top + 1;
  const originY = Math.min(1, Math.max(0, (rows.bottom - Math.round(height * 0.03)) / frameHeight));
  return { height, originY };
}
