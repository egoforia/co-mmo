import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BODY_TYPES, WALKING_LOOKS, WALK_DIRECTIONS, walkArt, type ArtManifest, type WalkDirection } from '@co-mmo/shared';
import { ANCHORS } from './assets/anchors.ts';
import type { ImageProvider } from './assets/provider.ts';
import { KEY_COLOR } from './assets/style.ts';
import { DEFAULT_VIDEO_MODEL, videoUsd, type VideoProvider } from './assets/video.ts';
import { checkWalk } from './assets/walk-checks.ts';
import { normalizeWalk } from './assets/walk-frames.ts';
import { LOOK_GEAR, soleFigure, type Carried, startFrame, videoFrames, viewPrompt, walkFromFrames, walkVideoPrompt } from './assets/walk-video.ts';
import { estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import { plain, type ArtJobHandle, type ArtJobSource } from './art-jobs.ts';
import { PaintStopped, watched } from './paint-queue.ts';
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
  /** Told which walk strips were just finished or painted again, so open games load them. */
  onPainted?: (ids: string[]) => void;
}

/** Something that can walk: a player look, a creature or a person, and how to paint it. */
export interface Walker {
  /** The art key the game draws it with; its walks are `<id>-walk-<direction>`. */
  id: string;
  name: string;
  /** Its approved picture, on magenta or with a clear background. */
  reference: () => Promise<Buffer>;
  /** What it carries, so each view holds it on the right side. */
  gear: Carried[];
  /** A key of BODY_TYPES. */
  body: string;
}

/** A walker's pictures and clips waiting in the painting log, by direction. */
export interface WalkPlan {
  views: Map<WalkDirection, ArtJobHandle | undefined>;
  clips: Map<WalkDirection, ArtJobHandle | undefined>;
}

/** Seconds of video a walk clip takes. */
const CLIP_SECONDS = 8;

/** About what one walk clip costs with a video model, before it is made. */
export function estimateClipUsd(model: string): number {
  return videoUsd(model || DEFAULT_VIDEO_MODEL, { mimeType: 'video/mp4', data: Buffer.alloc(0), seconds: CLIP_SECONDS });
}

/** A picture smaller than this is too soft to start a clip from, so its front view is painted too. */
const SHARP_ENOUGH = 256;

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

  /** Reads the walks painted before, so the manifest is right before any painting. */
  async load(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
  }

  private async run(): Promise<void> {
    await this.load();
    // Nothing can be painted without an image model; the Art tab says so, so the log stays quiet.
    if (!this.options.provider()) return;
    const shipped = await this.options.shipped();
    const madeFrom = JSON.parse(await readFile(resolve(this.dir, 'looks.json'), 'utf8').catch(() => '{}')) as Record<string, string>;
    for (const look of WALKING_LOOKS) {
      const walker = this.anchorWalker(look);
      // A look whose approved picture changed (say, painted again with empty hands) walks again from the new one.
      const stamp = createHash('sha1').update(await walker.reference()).digest('hex').slice(0, 12);
      const painted = WALK_DIRECTIONS.some((d) => this.painted[walkArt(look, d)]);
      const changed = painted && madeFrom[look] !== stamp;
      if (changed) await this.forget(walker, WALK_DIRECTIONS, true);
      else if (WALK_DIRECTIONS.every((d) => shipped[walkArt(look, d)] || this.painted[walkArt(look, d)])) continue;
      if (!(await this.paintWalker(walker, 'start-up', changed))) return;
      madeFrom[look] = stamp;
      await mkdir(this.dir, { recursive: true });
      await writeFile(resolve(this.dir, 'looks.json'), JSON.stringify(madeFrom, null, 2));
    }
  }

  /** A walker for one of the approved anchors: a player look, a creature or a person. */
  anchorWalker(id: string, body = 'two-legged'): Walker {
    const anchor = ANCHORS.find((a) => a.id === id);
    return {
      id,
      name: anchor?.name ?? 'the hero',
      gear: LOOK_GEAR[id] ?? [],
      body,
      reference: async () => {
        const raw = await readFile(resolve(this.options.anchorDir, 'raw', `${id}.png`)).catch(() => undefined);
        return raw ?? readFile(resolve(this.options.anchorDir, `${id}.png`));
      },
    };
  }

  /**
   * Forgets a walker's walks in some directions, so the next painting makes
   * them again: their clips, and their standing views too when `views` is
   * set. Every other direction's frames are kept and reused for free.
   */
  async forget(walker: Walker, directions: readonly WalkDirection[], views: boolean): Promise<void> {
    for (const direction of directions) {
      await rm(resolve(this.dir, 'frames', `${walkArt(walker.id, direction)}.json`), { force: true });
      if (views) await rm(resolve(this.dir, 'views', `${walker.id}-${direction}.png`), { force: true });
    }
  }

  /** Adds what a walker still needs to the painting log, as waiting its turn. */
  async plan(walker: Walker, source: ArtJobSource): Promise<WalkPlan> {
    const { views, clips } = await this.needs(walker);
    const imageModel = this.options.provider()?.model ?? '';
    const videoModel = this.options.video()?.model ?? '';
    const jobs = this.options.jobs;
    return {
      views: new Map(views.map((d) => [d, jobs?.add(`${walker.id}-${d}`, `${walker.name} standing, facing ${facingWords(d)}`, 'picture', source, estimateImageUsd(imageModel))])),
      clips: new Map(clips.map((d) => [d, jobs?.add(walkArt(walker.id, d), `${walker.name} walking ${facingWords(d)}`, 'clip', source, estimateClipUsd(videoModel))])),
    };
  }

  /** What making a walker's missing walks will ask for: pictures to paint and clips to make. */
  async needs(walker: Walker): Promise<{ views: WalkDirection[]; clips: WalkDirection[] }> {
    const clips: WalkDirection[] = [];
    const views: WalkDirection[] = [];
    const sharpFront = await this.sharpReference(walker);
    for (const direction of WALK_DIRECTIONS) {
      if (await this.cached(`frames/${walkArt(walker.id, direction)}.json`)) continue;
      clips.push(direction);
      const kept = await readFile(resolve(this.dir, 'views', `${walker.id}-${direction}.png`)).catch(() => undefined);
      if (!kept && (direction !== 'front' || !sharpFront)) views.push(direction);
    }
    return { views, clips };
  }

  /** All four walks of one walker; false when painting has to stop (no model, no budget). */
  async paintWalker(walker: Walker, source: ArtJobSource, redone = false, planned?: WalkPlan): Promise<boolean> {
    const body = BODY_TYPES[walker.body] ?? BODY_TYPES['two-legged']!;
    const { views: viewJobs, clips: clipJobs } = planned ?? (await this.plan(walker, source));
    const skipRest = (reason: string) => {
      for (const handle of [...viewJobs.values(), ...clipJobs.values()]) handle?.skip(reason);
    };
    const walks: Buffer[][] = [];
    try {
      for (const direction of WALK_DIRECTIONS) {
        const frames = (await this.cached(`frames/${walkArt(walker.id, direction)}.json`)) as string[] | undefined;
        if (frames) {
          walks.push(await Promise.all(frames.map((f) => readFile(resolve(this.dir, 'frames', f)))));
          continue;
        }
        const view = await this.view(walker, direction, viewJobs.get(direction));
        if (!view) return skipRest(stopReason(this.options)), false;
        const cut = await this.walk(walker, direction, view, body.frames, clipJobs.get(direction));
        if (cut && 'stop' in cut) return skipRest(cut.stop), false;
        if (!cut) return skipRest(`Another of ${walker.name}'s walks failed twice, so the rest wait.`), true;
        walks.push(cut);
      }
    } catch (err) {
      skipRest(`Painting ${walker.name} stopped: ${plain(err)}`);
      throw err;
    }
    // One scale for the whole look, so it keeps its size when it turns.
    const { strips, frameWidth, frameHeight } = await normalizeWalk(walks);
    await mkdir(this.dir, { recursive: true });
    const now = Date.now();
    for (const [i, direction] of WALK_DIRECTIONS.entries()) {
      const id = walkArt(walker.id, direction);
      await writeFile(resolve(this.dir, `${id}.png`), strips[i]!);
      const file = `${WALK_ART_PATH}/${id}.png`;
      // A repaint keeps the file name, so the address changes to make browsers fetch it again.
      this.painted[id] = { file: redone ? `${file}?v=${now.toString(36)}` : file, kind: 'walk', width: frameWidth * body.frames, height: frameHeight, frames: body.frames, cycleSeconds: body.cycleSeconds, ...(redone ? { redone: now } : {}) };
    }
    await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
    this.options.onPainted?.(WALK_DIRECTIONS.map((d) => walkArt(walker.id, d)));
    return true;
  }

  /** The walker's picture on magenta, the way the image and video models are given it. */
  private async onMagenta(walker: Walker): Promise<Buffer> {
    return sharp(await walker.reference()).flatten({ background: KEY_COLOR.hex }).png().toBuffer();
  }

  /** True when the walker's own picture is big enough to start the front walk from. */
  private async sharpReference(walker: Walker): Promise<boolean> {
    const picture = await walker.reference().catch(() => undefined);
    if (!picture) return false;
    const { height = 0 } = await sharp(picture).metadata();
    return height >= SHARP_ENOUGH;
  }

  /** The walker standing in one direction: its approved picture for the front, painted for the rest. */
  private async view(walker: Walker, direction: WalkDirection, handle?: ArtJobHandle): Promise<Buffer | undefined> {
    const path = resolve(this.dir, 'views', `${walker.id}-${direction}.png`);
    const kept = await readFile(path).catch(() => undefined);
    if (kept) return kept;
    const reference = await this.onMagenta(walker);
    let figure: Buffer | undefined;
    if (direction === 'front' && (await this.sharpReference(walker))) figure = await soleFigure(reference);
    let usd = 0;
    handle?.start();
    for (let attempt = 0; !figure && attempt < 2; attempt++) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return undefined;
      const image = await watched(provider, handle).generate({ prompt: viewPrompt(walker.name, walker.gear, direction), references: [{ mimeType: 'image/png', data: reference }], aspectRatio: '3:4' });
      const cost = imageUsd(provider.model, image);
      usd += cost;
      this.options.spend(cost, provider as ImageProvider);
      figure = await soleFigure(image.data).catch((err) => {
        console.error(`The ${direction} view of ${walker.id} was refused:`, (err as Error).message);
        return undefined;
      });
    }
    if (!figure) {
      const reason = `No clean ${direction} view of ${walker.name}: the picture showed more than one figure twice.`;
      handle?.fail(reason);
      throw new Error(reason);
    }
    handle?.done(usd);
    await mkdir(resolve(this.dir, 'views'), { recursive: true });
    await writeFile(path, figure);
    return figure;
  }

  /** One direction's walk cut from a clip, tried twice; `stop` says why when painting has to stop. */
  private async walk(walker: Walker, direction: WalkDirection, view: Buffer, count: number, handle?: ArtJobHandle): Promise<Buffer[] | { stop: string } | undefined> {
    const id = walkArt(walker.id, direction);
    const first = { mimeType: 'image/png', data: await startFrame(view) };
    let usd = 0;
    let reason = '';
    handle?.start();
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = this.options.video();
      if (!provider || this.options.overBudget()) return { stop: stopReason(this.options) };
      try {
        // The same picture first and last makes the clip loop back to the standing pose.
        const clip = await watched(provider, handle).generate({ prompt: walkVideoPrompt(walker.gear, direction, walker.body), first, last: first, seconds: CLIP_SECONDS });
        const cost = videoUsd(provider.model, clip);
        usd += cost;
        this.options.spendVideo(cost, provider);
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
        handle?.done(usd);
        return figures;
      } catch (err) {
        // A used-up daily limit is not this walk's fault: trying again cannot help until it resets.
        if (err instanceof PaintStopped) return { stop: err.message };
        reason = plain(err);
        console.error(`Walk ${id} failed:`, reason);
      }
    }
    handle?.fail(`Tried twice. ${reason}`);
    return undefined;
  }

  private async cached(name: string): Promise<unknown> {
    const text = await readFile(resolve(this.dir, name), 'utf8').catch(() => undefined);
    return text === undefined ? undefined : JSON.parse(text);
  }
}

/** Which way a direction faces, in words for the painting log. */
function facingWords(direction: WalkDirection): string {
  return direction === 'front' ? 'towards us' : direction === 'back' ? 'away' : direction;
}

/** Why painting stopped before the end, in plain words. */
function stopReason(options: WalkPainterOptions): string {
  if (options.overBudget()) return "Spending is paused: this month's budget or today's cap is used up.";
  if (!options.provider()) return "No image model is set in God's View.";
  if (!options.video()) return 'No video model: walks need the Google AI Studio key.';
  return 'Painting stopped.';
}
