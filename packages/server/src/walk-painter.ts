import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BODY_TYPES, WALKING_LOOKS, WALK_DIRECTIONS, walkArt, type ArtManifest, type WalkDirection } from '@co-mmo/shared';
import { ANCHORS } from './assets/anchors.ts';
import type { ImageProvider, ImageRequest } from './assets/provider.ts';
import { KEY_COLOR } from './assets/style.ts';
import { DEFAULT_VIDEO_MODEL, videoUsd, type VideoProvider } from './assets/video.ts';
import { checkWalk } from './assets/walk-checks.ts';
import { normalizeWalk } from './assets/walk-frames.ts';
import { LOOK_GEAR, soleFigure, type Carried, startFrame, videoFrames, viewPrompt, walkFromFrames, walkVideoPrompt } from './assets/walk-video.ts';
import { estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import { plain, type ArtJobHandle, type ArtJobSource } from './art-jobs.ts';
import { historyFolder } from './art-history.ts';
import { keepingImage, keepingVideo, type Recipe, type RecipeStep } from './art-recipes.ts';
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

/** An earlier walk in one direction, kept so it can be put back. */
export interface WalkVersion {
  id: string;
  /** Its walk strip, as it was. */
  url: string;
  frames: number;
  width: number;
  height: number;
  cycleSeconds: number;
  recipe?: Recipe;
}

/** Where earlier walks are served from, under the wished-art directory. */
export const WALK_HISTORY_PATH = 'wished-art/history';

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
      await this.keepVersion(walker, direction);
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

  /**
   * What making a walker's missing walks will ask for: pictures to paint and
   * clips to make; `redo` counts those directions as missing (their standing
   * pictures too with `views`), as forget() would leave them.
   */
  async needs(walker: Walker, redo: readonly WalkDirection[] = [], views = false): Promise<{ views: WalkDirection[]; clips: WalkDirection[] }> {
    const clips: WalkDirection[] = [];
    const paint: WalkDirection[] = [];
    const sharpFront = await this.sharpReference(walker);
    for (const direction of WALK_DIRECTIONS) {
      const again = redo.includes(direction);
      if (!again && (await this.cached(`frames/${walkArt(walker.id, direction)}.json`))) continue;
      clips.push(direction);
      const kept = !(again && views) && (await this.keptView(walker, direction));
      if (!kept && (direction !== 'front' || !sharpFront)) paint.push(direction);
    }
    return { views: paint, clips };
  }

  /**
   * Exactly what making a walker's walks would send, without making them:
   * each standing picture to paint and each clip, with the pictures they
   * start from. Arguments are as for needs().
   */
  async preview(walker: Walker, redo: readonly WalkDirection[] = [], views = false): Promise<Recipe> {
    const image = this.options.provider();
    const video = this.options.video();
    if (!image || !video) throw new Error(stopReason(this.options));
    const recipes = this.options.recipes!;
    const need = await this.needs(walker, redo, views);
    const steps: RecipeStep[] = [];
    for (const direction of need.clips) {
      // As view() will find it: painted below, kept from before, or the approved picture itself.
      let view: Buffer | undefined;
      let approved = false;
      if (need.views.includes(direction)) {
        steps.push(await recipes.imageStep(`${walker.name} standing, facing ${facingWords(direction)}`, image, await this.viewRequest(walker, direction), estimateImageUsd(image.model)));
      } else {
        view = redo.includes(direction) && views ? undefined : await this.keptView(walker, direction);
        if (!view) {
          view = await soleFigure(await this.onMagenta(walker));
          approved = true;
        }
      }
      const first = view && { mimeType: 'image/png', data: await startFrame(view) };
      steps.push(await recipes.clipStep(`${walker.name} walking ${facingWords(direction)}`, video, { prompt: walkVideoPrompt(walker.gear, direction, walker.body), seconds: CLIP_SECONDS, ...(first ? { first } : {}) }, estimateClipUsd(video.model), this.startName(walker, direction, approved)));
    }
    const notes = [
      ...(need.views.length ? ['A standing picture that shows more than one figure is painted once more, for about the same again.'] : []),
      ...(need.clips.length ? [`A clip whose walk fails the free checks is made once more, for about ${estimateClipUsd(video.model).toFixed(2)} dollars. Each clip is cut down to one cycle of ${BODY_TYPES[walker.body]?.frames ?? 12} frames.`] : []),
    ];
    return { at: Date.now(), steps, ...(notes.length ? { notes } : {}) };
  }

  /** A walk direction's earlier versions, newest first. */
  async versions(walkerId: string, direction: WalkDirection): Promise<WalkVersion[]> {
    const id = walkArt(walkerId, direction);
    const dir = resolve(this.options.artDir, 'history', historyFolder(id));
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^[0-9a-z]+$/.test(n));
    const out: WalkVersion[] = [];
    for (const name of names.sort((a, b) => Number.parseInt(b, 36) - Number.parseInt(a, 36))) {
      const meta = JSON.parse(await readFile(resolve(dir, name, 'meta.json'), 'utf8').catch(() => 'null')) as Omit<WalkVersion, 'id' | 'url' | 'recipe'> | null;
      if (!meta) continue;
      const recipe = await this.options.recipes?.ofVersion(id, name);
      out.push({ id: name, url: `/${WALK_HISTORY_PATH}/${historyFolder(id)}/${name}/strip.png`, ...meta, ...(recipe ? { recipe } : {}) });
    }
    return out;
  }

  /**
   * Puts an earlier walk back in one direction, for free: its frames and
   * standing picture return, and the walk strips are made again from the
   * frames once every direction has some. The walk it replaces is kept.
   */
  async restore(walker: Walker, direction: WalkDirection, version: string): Promise<boolean> {
    const id = walkArt(walker.id, direction);
    const dir = resolve(this.options.artDir, 'history', historyFolder(id), version);
    const names = JSON.parse(await readFile(resolve(dir, 'frames.json'), 'utf8').catch(() => 'null')) as string[] | null;
    if (!names) return false;
    await this.keepVersion(walker, direction);
    await mkdir(resolve(this.dir, 'frames'), { recursive: true });
    await Promise.all(names.map((n) => copyFile(resolve(dir, 'frames', n), resolve(this.dir, 'frames', n))));
    await writeFile(resolve(this.dir, 'frames', `${id}.json`), JSON.stringify(names));
    if (await exists(resolve(dir, 'view.png'))) {
      await mkdir(resolve(this.dir, 'views'), { recursive: true });
      await copyFile(resolve(dir, 'view.png'), resolve(this.dir, 'views', `${walker.id}-${direction}.png`));
    }
    await this.options.recipes?.bringBack(id, version);
    await this.load();
    const walks: Buffer[][] = [];
    for (const d of WALK_DIRECTIONS) {
      const frames = (await this.cached(`frames/${walkArt(walker.id, d)}.json`)) as string[] | undefined;
      if (!frames) return true;
      walks.push(await Promise.all(frames.map((f) => readFile(resolve(this.dir, 'frames', f)))));
    }
    await this.writeStrips(walker, walks, true);
    return true;
  }

  /** Copies one direction's walk aside, with what made it, before it is painted again or replaced. */
  private async keepVersion(walker: Walker, direction: WalkDirection): Promise<void> {
    const id = walkArt(walker.id, direction);
    const names = (await this.cached(`frames/${id}.json`)) as string[] | undefined;
    if (!names) return;
    await this.load();
    const entry = this.painted[id];
    const strip = resolve(this.dir, `${id}.png`);
    if (!entry || !(await exists(strip))) return;
    const version = Date.now().toString(36);
    const dir = resolve(this.options.artDir, 'history', historyFolder(id), version);
    await mkdir(resolve(dir, 'frames'), { recursive: true });
    await copyFile(strip, resolve(dir, 'strip.png'));
    await Promise.all(names.map((n) => copyFile(resolve(this.dir, 'frames', n), resolve(dir, 'frames', n))));
    await writeFile(resolve(dir, 'frames.json'), JSON.stringify(names));
    const view = resolve(this.dir, 'views', `${walker.id}-${direction}.png`);
    if (await exists(view)) await copyFile(view, resolve(dir, 'view.png'));
    await writeFile(resolve(dir, 'meta.json'), JSON.stringify({ frames: entry.frames ?? names.length, width: entry.width, height: entry.height, cycleSeconds: entry.cycleSeconds ?? 0.6 }));
    await this.options.recipes?.putAside(id, version);
  }

  /** A kept standing picture of one direction, when there is one. */
  private keptView(walker: Walker, direction: WalkDirection): Promise<Buffer | undefined> {
    return readFile(resolve(this.dir, 'views', `${walker.id}-${direction}.png`)).catch(() => undefined);
  }

  /** What a clip starts from, in words. */
  private startName(walker: Walker, direction: WalkDirection, approved: boolean): string {
    return approved ? `${walker.name}'s approved picture` : `${walker.name} standing, facing ${facingWords(direction)}`;
  }

  /** What painting a walker standing in one direction sends to the image model. */
  private async viewRequest(walker: Walker, direction: WalkDirection): Promise<ImageRequest> {
    return {
      prompt: viewPrompt(walker.name, walker.gear, direction),
      references: [{ mimeType: 'image/png', data: await this.onMagenta(walker) }],
      labels: [`${walker.name}'s approved picture, on magenta`],
      aspectRatio: '3:4',
    };
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
    await this.writeStrips(walker, walks, redone);
    return true;
  }

  /** Writes a walker's four walk strips from their frames, all at one scale. */
  private async writeStrips(walker: Walker, walks: Buffer[][], redone: boolean): Promise<void> {
    const body = BODY_TYPES[walker.body] ?? BODY_TYPES['two-legged']!;
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
    let figure: Buffer | undefined;
    if (direction === 'front' && (await this.sharpReference(walker))) figure = await soleFigure(await this.onMagenta(walker));
    let usd = 0;
    let sent: { request: ImageRequest; provider: ImageProvider } | undefined;
    handle?.start();
    for (let attempt = 0; !figure && attempt < 2; attempt++) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return undefined;
      const request = await this.viewRequest(walker, direction);
      const image = await watched(provider, handle).generate(request);
      const cost = imageUsd(provider.model, image);
      usd += cost;
      this.options.spend(cost, provider as ImageProvider);
      sent = { request, provider };
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
    if (sent) await this.options.recipes?.record(viewKey(walker, direction), { at: Date.now(), steps: [await this.options.recipes.imageStep(`${walker.name} standing, facing ${facingWords(direction)}`, sent.provider, sent.request, usd)] });
    else await this.options.recipes?.forget(viewKey(walker, direction));
    return figure;
  }

  /** One direction's walk cut from a clip, tried twice; `stop` says why when painting has to stop. */
  private async walk(walker: Walker, direction: WalkDirection, view: Buffer, count: number, handle?: ArtJobHandle): Promise<Buffer[] | { stop: string } | undefined> {
    const id = walkArt(walker.id, direction);
    const first = { mimeType: 'image/png', data: await startFrame(view) };
    let usd = 0;
    let reason = '';
    let sent: VideoProvider | undefined;
    handle?.start();
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = this.options.video();
      if (!provider || this.options.overBudget()) return { stop: stopReason(this.options) };
      try {
        // The same picture first and last makes the clip loop back to the standing pose.
        const clip = await watched(provider, handle).generate({ prompt: walkVideoPrompt(walker.gear, direction, walker.body), first, last: first, seconds: CLIP_SECONDS });
        sent = provider;
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
        await this.keepRecipe(walker, direction, sent, first, usd);
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

  /** Keeps what made one direction's walk: its standing picture's recipe, if it was painted, then the clip's. */
  private async keepRecipe(walker: Walker, direction: WalkDirection, provider: VideoProvider | undefined, first: { mimeType: string; data: Buffer }, usd: number): Promise<void> {
    const recipes = this.options.recipes;
    if (!recipes || !provider) return;
    const view = await recipes.current(viewKey(walker, direction));
    const clip = await recipes.clipStep(`${walker.name} walking ${facingWords(direction)}`, provider, { prompt: walkVideoPrompt(walker.gear, direction, walker.body), seconds: CLIP_SECONDS, first }, usd, this.startName(walker, direction, !view && direction === 'front'));
    await recipes.record(walkArt(walker.id, direction), { at: Date.now(), steps: [...(view?.steps ?? []), clip] });
  }

  private async cached(name: string): Promise<unknown> {
    const text = await readFile(resolve(this.dir, name), 'utf8').catch(() => undefined);
    return text === undefined ? undefined : JSON.parse(text);
  }
}

/** Where the recipe of a walker's standing picture in one direction is kept. */
function viewKey(walker: Walker, direction: WalkDirection): string {
  return `${walker.id}-${direction}-view`;
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
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
