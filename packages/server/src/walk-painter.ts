import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BODY_TYPES, WALKING_LOOKS, WALK_DIRECTIONS, walkArt, type ArtManifest, type WalkDirection } from '@co-mmo/shared';
import { ANCHORS } from './assets/anchors.ts';
import type { ImageProvider } from './assets/provider.ts';
import { videoUsd, type VideoProvider } from './assets/video.ts';
import { checkWalk } from './assets/walk-checks.ts';
import { normalizeWalk } from './assets/walk-frames.ts';
import { LOOK_GEAR, soleFigure, startFrame, videoFrames, viewPrompt, walkFromFrames, walkVideoPrompt } from './assets/walk-video.ts';
import { imageUsd } from './assets/wish-art.ts';
import type { BuildingPainterOptions } from './building-painter.ts';

/** Where painted walk strips are served from, under the wished-art directory. */
export const WALK_ART_PATH = 'wished-art/walks';

export interface WalkPainterOptions extends BuildingPainterOptions {
  /** The video model, or undefined when there is none. */
  video: () => VideoProvider | undefined;
  /** Records what a clip cost. */
  spendVideo: (usd: number, provider: VideoProvider) => void;
  /** Turns a clip into its frames; ffmpeg unless a test says otherwise. */
  toFrames?: (mp4: Buffer) => Promise<Buffer[]>;
}

/**
 * Paints the walking looks' walks that are missing, when the server starts:
 * each look standing in every direction (image model), then each of those
 * walking in place (video model), cut down to one cycle. Every step is kept
 * on disk, so a run stopped by the budget picks up where it left off. Until a
 * look has all four walks, it glides in its standing pose as before.
 */
export class WalkPainter {
  private painted: ArtManifest = {};
  /** The painting run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;

  constructor(private readonly options: WalkPainterOptions) {}

  private get dir(): string {
    return resolve(this.options.artDir, 'walks');
  }

  /** Walk strips this server painted, for clients to load beside the shipped art. */
  manifest(): ArtManifest {
    return this.painted;
  }

  /** Paints whatever walks are missing, one look at a time, while the budget allows. */
  start(): Promise<void> {
    this.job ??= this.run()
      .catch((err) => console.error('Painting walks stopped:', (err as Error).message))
      .finally(() => (this.job = undefined));
    return this.job;
  }

  private async run(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
    const shipped = await this.options.shipped();
    for (const look of WALKING_LOOKS) {
      if (WALK_DIRECTIONS.every((d) => shipped[walkArt(look, d)] || this.painted[walkArt(look, d)])) continue;
      if (!(await this.paintLook(look))) return;
    }
  }

  /** All four walks of one look; false when painting has to stop (no model, no budget). */
  private async paintLook(look: string): Promise<boolean> {
    const body = BODY_TYPES['two-legged']!;
    const walks: Buffer[][] = [];
    for (const direction of WALK_DIRECTIONS) {
      const frames = (await this.cached(`frames/${walkArt(look, direction)}.json`)) as string[] | undefined;
      if (frames) {
        walks.push(await Promise.all(frames.map((f) => readFile(resolve(this.dir, 'frames', f)))));
        continue;
      }
      const view = await this.view(look, direction);
      if (!view) return false;
      const cut = await this.walk(look, direction, view, body.frames);
      if (cut === 'stop') return false;
      if (!cut) return true; // This look failed twice; try the next one.
      walks.push(cut);
    }
    // One scale for the whole look, so it keeps its size when it turns.
    const { strips, frameWidth, frameHeight } = await normalizeWalk(walks);
    await mkdir(this.dir, { recursive: true });
    for (const [i, direction] of WALK_DIRECTIONS.entries()) {
      const id = walkArt(look, direction);
      await writeFile(resolve(this.dir, `${id}.png`), strips[i]!);
      this.painted[id] = { file: `${WALK_ART_PATH}/${id}.png`, kind: 'walk', width: frameWidth * body.frames, height: frameHeight, frames: body.frames, cycleSeconds: body.cycleSeconds };
    }
    await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
    return true;
  }

  /** The look standing in one direction: its approved picture for the front, painted for the rest. */
  private async view(look: string, direction: WalkDirection): Promise<Buffer | undefined> {
    const path = resolve(this.dir, 'views', `${look}-${direction}.png`);
    const kept = await readFile(path).catch(() => undefined);
    if (kept) return kept;
    const reference = await readFile(resolve(this.options.anchorDir, 'raw', `${look}.png`));
    let figure: Buffer | undefined;
    if (direction === 'front') figure = await soleFigure(reference);
    for (let attempt = 0; !figure && attempt < 2; attempt++) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return undefined;
      const anchor = ANCHORS.find((a) => a.id === look);
      const image = await provider.generate({ prompt: viewPrompt(anchor?.name ?? 'the hero', LOOK_GEAR[look] ?? [], direction), references: [{ mimeType: 'image/png', data: reference }], aspectRatio: '3:4' });
      this.options.spend(imageUsd(provider.model, image), provider as ImageProvider);
      figure = await soleFigure(image.data).catch((err) => {
        console.error(`The ${direction} view of ${look} was refused:`, (err as Error).message);
        return undefined;
      });
    }
    if (!figure) throw new Error(`No clean ${direction} view of ${look}.`);
    await mkdir(resolve(this.dir, 'views'), { recursive: true });
    await writeFile(path, figure);
    return figure;
  }

  /** One direction's walk cut from a clip, tried twice; 'stop' when painting has to stop. */
  private async walk(look: string, direction: WalkDirection, view: Buffer, count: number): Promise<Buffer[] | 'stop' | undefined> {
    const id = walkArt(look, direction);
    const first = { mimeType: 'image/png', data: await startFrame(view) };
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = this.options.video();
      if (!provider || this.options.overBudget()) return 'stop';
      try {
        // The same picture first and last makes the clip loop back to the standing pose.
        const clip = await provider.generate({ prompt: walkVideoPrompt(LOOK_GEAR[look] ?? [], direction), first, last: first, seconds: 8 });
        this.options.spendVideo(videoUsd(provider.model, clip), provider);
        await mkdir(resolve(this.dir, 'raw'), { recursive: true });
        await writeFile(resolve(this.dir, 'raw', `${id}${attempt ? '-retry' : ''}.mp4`), clip.data);
        const { figures } = await walkFromFrames(await (this.options.toFrames ?? videoFrames)(clip.data), count);
        // Neighbouring frames of a smooth clip are meant to be close, so repeats only matter when most frames look alike.
        const check = await checkWalk(figures, view, { samePose: 0.02 });
        const problems = check.problems.filter((p) => !p.includes('repeats'));
        if (check.distinctPoses < count / 3) problems.push('The walker barely moves.');
        if (problems.length) throw new Error(problems.join(' '));
        await mkdir(resolve(this.dir, 'frames'), { recursive: true });
        const names = figures.map((_, i) => `${id}-${String(i + 1).padStart(2, '0')}.png`);
        await Promise.all(figures.map((f, i) => writeFile(resolve(this.dir, 'frames', names[i]!), f)));
        await writeFile(resolve(this.dir, 'frames', `${id}.json`), JSON.stringify(names));
        return figures;
      } catch (err) {
        console.error(`Walk ${id} failed:`, (err as Error).message);
      }
    }
    return undefined;
  }

  private async cached(name: string): Promise<unknown> {
    const text = await readFile(resolve(this.dir, name), 'utf8').catch(() => undefined);
    return text === undefined ? undefined : JSON.parse(text);
  }
}
