import { spotMiddle, stepped, type StepWay, type TileSpot } from './grid.ts';

// A step under way: where it started, where it goes, when it began and how
// long it takes. The server keeps one per moving body; the browser draws the
// body sliding from one tile's middle to the next while it lasts.

/** One step being taken. */
export interface Stride {
  from: TileSpot;
  way: StepWay;
  /** Epoch ms the step began. */
  at: number;
  /** How long it takes, in ms. */
  ms: number;
}

/** Where a stride ends. */
export function strideEnd(s: Stride): TileSpot {
  return stepped(s.from, s.way);
}

/** How far through its step a stride is, 0 to 1. */
export function strideDone(s: Stride, now: number): number {
  return s.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - s.at) / s.ms));
}

/** Where a `width`-wide body taking a stride stands at `now`, in tiles. */
export function stridePosition(s: Stride, now: number, width = 1): { x: number; y: number } {
  const a = spotMiddle(s.from, width);
  const b = spotMiddle(strideEnd(s), width);
  const t = strideDone(s, now);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
