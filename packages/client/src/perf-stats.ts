// The sums behind the performance overlay, kept apart from the page and
// Phaser so they can be tested: frame times, rates over a few seconds, and
// how big the pictures held for the GPU are.

/** A frame that takes longer than this is one players see as a stutter. */
export const LONG_FRAME_MS = 50;

/** How a run of frames went. */
export interface FrameSummary {
  /** Frames a second, from the average time between frames. */
  fps: number;
  /** The frame rate of the slowest one frame in a hundred: what a stutter feels like. */
  lowFps: number;
  /** Average and slowest time between frames, ms. */
  frameMs: number;
  worstMs: number;
  /** Average time the game spent working out and drawing a frame, ms; the rest is waiting for the screen. */
  workMs: number;
  /** Frames slower than LONG_FRAME_MS. */
  longFrames: number;
  /** The time between frames, oldest first, for the chart. */
  recent: number[];
}

/** Keeps the last few hundred frames: how long between them, and how long the game worked on each. */
export class FrameStats {
  private gaps: number[] = [];
  private work: number[] = [];

  constructor(private readonly kept = 300) {}

  /** Records one frame: the time since the last one and the time spent on it, ms. */
  frame(gapMs: number, workMs: number): void {
    this.gaps.push(gapMs);
    this.work.push(workMs);
    if (this.gaps.length > this.kept) this.gaps.shift();
    if (this.work.length > this.kept) this.work.shift();
  }

  /** Forgets every frame, as after a pause (a hidden tab) that would read as one huge frame. */
  clear(): void {
    this.gaps = [];
    this.work = [];
  }

  summary(): FrameSummary {
    const gaps = this.gaps;
    if (!gaps.length) return { fps: 0, lowFps: 0, frameMs: 0, worstMs: 0, workMs: 0, longFrames: 0, recent: [] };
    const frameMs = average(gaps);
    // The slowest 1%: at least the single slowest frame.
    const sorted = [...gaps].sort((a, b) => b - a);
    const slow = sorted.slice(0, Math.max(1, Math.floor(gaps.length / 100)));
    return {
      fps: frameMs ? 1000 / frameMs : 0,
      lowFps: 1000 / average(slow),
      frameMs,
      worstMs: sorted[0]!,
      workMs: average(this.work),
      longFrames: gaps.filter((g) => g > LONG_FRAME_MS).length,
      recent: [...gaps],
    };
  }
}

/** Counts something over the last few seconds (messages, bytes), to say how much of it comes a second. */
export class Rate {
  private events: { at: number; n: number }[] = [];

  constructor(private readonly windowMs = 5000) {}

  add(n: number, at: number): void {
    this.events.push({ at, n });
  }

  perSecond(now: number): number {
    const since = now - this.windowMs;
    while (this.events.length && this.events[0]!.at < since) this.events.shift();
    return (this.events.reduce((sum, e) => sum + e.n, 0) * 1000) / this.windowMs;
  }
}

/** A picture held for the GPU: its size in pixels. */
export interface TextureSize {
  key: string;
  width: number;
  height: number;
}

/** Phaser's own small textures, there in every game: not ours to count. */
const BUILT_IN = new Set(['__DEFAULT', '__MISSING', '__WHITE', '__NORMAL']);

/** How many of our pictures are held and roughly how much GPU memory they take (four bytes a pixel), in MB. */
export function textureMemory(sizes: TextureSize[]): { count: number; mb: number } {
  const ours = sizes.filter((s) => !BUILT_IN.has(s.key));
  const bytes = ours.reduce((sum, s) => sum + s.width * s.height * 4, 0);
  return { count: new Set(ours.map((s) => s.key)).size, mb: bytes / 1_048_576 };
}

/** The biggest pictures first, to find the ones worth making smaller. */
export function biggestTextures(sizes: TextureSize[], count = 5): TextureSize[] {
  return sizes.filter((s) => !BUILT_IN.has(s.key)).sort((a, b) => b.width * b.height - a.width * a.height).slice(0, count);
}

/** The middle of a few recent round trips, ms: one slow answer does not swing it. */
export function middle(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Points for a chart of frame times: x from 0 to `width`, y from the bottom
 * (`height`) up, with `topMs` at the top; slower frames stay at the top.
 */
export function chartPoints(times: number[], width: number, height: number, topMs: number): string {
  if (times.length < 2) return '';
  const step = width / (times.length - 1);
  return times.map((t, i) => `${(i * step).toFixed(1)},${(height - (Math.min(t, topMs) / topMs) * height).toFixed(1)}`).join(' ');
}

/**
 * Where a slow frame's time goes, in a sentence, when frames are slow: the
 * game's own work (code, building what to draw), or waiting on the graphics
 * card and the browser after it.
 */
export function whereTimeGoes(fps: number, frameMs: number, workMs: number): string | undefined {
  if (!fps || fps >= 50) return undefined;
  if (workMs > frameMs / 2) return 'Most of each frame is the game working out and sending what to draw: fewer objects and draw calls help.';
  return 'Most of each frame waits on the graphics card or the browser: fewer lights, smaller pictures or a smaller window help.';
}

function average(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
