import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BODY_TYPES, FACINGS, ISO_WAYS, walkArt, walkStandArt, type ArtEntry, type ArtManifest, type Facing, type IsoWay } from '@co-mmo/shared';
import { ANCHORS } from './assets/anchors.ts';
import type { ImageProvider, ImageRequest } from './assets/provider.ts';
import { KEY_COLOR } from './assets/style.ts';
import { DEFAULT_VIDEO_MODEL, videoUsd, type VideoProvider } from './assets/video.ts';
import { checkWalk } from './assets/walk-checks.ts';
import { normalizeWalk } from './assets/walk-frames.ts';
import { LOOK_GEAR, soleFigure, type Carried, startFrame, videoFrames, viewPrompt, walkFromFrames, walkVideoPrompt, waysFromSheet, waysSheetPrompt } from './assets/walk-video.ts';
import { estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import { plain, type ArtJobHandle, type ArtJobSource } from './art-jobs.ts';
import { ArtHistory, historyFolder, type ArtVersion } from './art-history.ts';
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

/** A picture a standing picture can be painted from: the approved picture, or the standing picture of a way. */
export type ViewSource = 'approved' | Facing;

/** A walker's standing picture facing one way, which its walk clip (if that way walks) starts and ends on. */
export interface StandingView {
  /** Where the browser loads it; none when it has to be painted first. */
  url?: string;
  /** It is the walker's own approved picture (the front only), not one painted for the walk. */
  approved: boolean;
  recipe?: Recipe;
  /** Earlier standing pictures; "approved" stands for the approved picture itself. */
  versions: ArtVersion[];
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
 * Paints walkers in the four isometric ways when the Owner asks in the Art
 * tab: standing pictures (image model), then each way walking in place
 * (video model), cut down to one cycle. Walks painted before in the
 * top-down directions are still served, put back and cut again, so walkers
 * keep them until their isometric ways are painted.
 */
export class WalkPainter {
  private painted: ArtManifest = {};
  /** The painting run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;
  /** Earlier standing pictures, kept when one is painted again. */
  private readonly history: ArtHistory;

  constructor(private readonly options: WalkPainterOptions) {
    this.history = new ArtHistory(options.artDir, options.recipes);
  }

  private get dir(): string {
    return resolve(this.options.artDir, 'walks');
  }

  /** Walk strips this server painted, for clients to load beside the shipped art. */
  manifest(): ArtManifest {
    return this.painted;
  }

  /** Standing pictures read so far, by file, with when they were written. */
  private standingSeen = new Map<string, { at: number; entry: ArtEntry }>();

  /**
   * Every walker's standing pictures by direction, for clients: a walker
   * stands in the one facing its way while it has no walk that way yet.
   */
  async standingManifest(): Promise<ArtManifest> {
    const out: ArtManifest = {};
    for (const name of await readdir(resolve(this.dir, 'views')).catch(() => [] as string[])) {
      const m = VIEW_FILE.exec(name);
      if (!m) continue;
      const path = resolve(this.dir, 'views', name);
      const at = (await stat(path).catch(() => undefined))?.mtimeMs;
      if (at === undefined) continue;
      let seen = this.standingSeen.get(name);
      if (seen?.at !== at) {
        const { width = 0, height = 0 } = await sharp(path).metadata().catch(() => ({ width: 0, height: 0 }));
        if (!width || !height) continue;
        seen = { at, entry: { file: `${WALK_ART_PATH}/views/${name}?v=${Math.round(at).toString(36)}`, kind: 'stand', width, height } };
        this.standingSeen.set(name, seen);
      }
      out[walkStandArt(m[1]!, m[2] as Facing)] = seen.entry;
    }
    return out;
  }

  /**
   * Gets the painted walks ready at start-up: reads them and cuts old walks
   * again from their clips, for free. Nothing is painted here any more;
   * walkers are painted in their isometric ways from the Art tab, after review.
   */
  start(): Promise<void> {
    this.job ??= this.run()
      .catch((err) => console.error('Getting walks ready stopped:', (err as Error).message))
      .finally(() => (this.job = undefined));
    return this.job;
  }

  /** Reads the walks painted before, so the manifest is right before any painting. */
  async load(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
  }

  private async run(): Promise<void> {
    await this.load();
    await this.recut();
  }

  /**
   * Walks cut before frames were kept where they stood in the clip are cut
   * again from their clips, once and for free, so they stop sliding from
   * frame to frame. A walk whose clip is not the one its frames came from
   * (an earlier version put back) is left as it is.
   */
  async recut(): Promise<void> {
    const path = resolve(this.dir, 'placed.json');
    const done = new Set(JSON.parse(await readFile(path, 'utf8').catch(() => '[]')) as string[]);
    const walkers = new Set<string>();
    for (const [id, entry] of Object.entries(this.painted)) {
      if (entry.kind !== 'walk' || done.has(id)) continue;
      const names = (await this.cached(`frames/${id}.json`)) as string[] | undefined;
      const clip = await this.lastClip(id);
      done.add(id);
      if (!names || !clip) continue;
      try {
        const old = await Promise.all(names.map((n) => readFile(resolve(this.dir, 'frames', n))));
        const { figures, placed } = await walkFromFrames(await (this.options.toFrames ?? videoFrames)(clip), names.length);
        if (!(await sameSizes(figures, old))) continue;
        await Promise.all(placed.map((f, i) => writeFile(resolve(this.dir, 'frames', names[i]!), f)));
        walkers.add(id.slice(0, id.lastIndexOf('-walk-')));
      } catch (err) {
        console.error(`Cutting ${id} again from its clip failed:`, (err as Error).message);
      }
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, JSON.stringify([...done], null, 2));
    for (const walkerId of walkers) {
      const entry = FACINGS.map((d) => this.painted[walkArt(walkerId, d)]).find(Boolean);
      const body = Object.keys(BODY_TYPES).find((k) => BODY_TYPES[k]!.frames === entry?.frames && BODY_TYPES[k]!.cycleSeconds === entry?.cycleSeconds) ?? 'two-legged';
      await this.writeKept({ id: walkerId, name: walkerId, gear: [], body, reference: async () => Buffer.alloc(0) }, true);
    }
  }

  /** Notes that a walk's frames are kept where they stood in its clip, so it is never cut again. */
  private async markPlaced(id: string): Promise<void> {
    const path = resolve(this.dir, 'placed.json');
    const done = new Set(JSON.parse(await readFile(path, 'utf8').catch(() => '[]')) as string[]);
    done.add(id);
    await writeFile(path, JSON.stringify([...done], null, 2));
  }

  /** The clip a walk was last cut from: the later of its first try and its retry. */
  private async lastClip(id: string): Promise<Buffer | undefined> {
    const tries = await Promise.all([`${id}.mp4`, `${id}-retry.mp4`].map(async (n) => ({ n, at: (await stat(resolve(this.dir, 'raw', n)).catch(() => undefined))?.mtimeMs })));
    const last = tries.filter((t) => t.at !== undefined).sort((a, b) => b.at! - a.at!)[0];
    return last ? readFile(resolve(this.dir, 'raw', last.n)) : undefined;
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
   * Exactly what painting a walker standing in one direction would send, on
   * its own so the Owner can look at the picture before any clip is made
   * from it; `prompt` replaces the usual words.
   */
  async previewView(walker: Walker, direction: IsoWay, prompt?: string, from?: readonly ViewSource[]): Promise<Recipe> {
    const image = this.options.provider();
    if (!image) throw new Error(stopReason(this.options));
    const step = await this.options.recipes!.imageStep(`${walker.name} standing, facing ${facingWords(direction)}`, image, await this.viewRequest(walker, direction, prompt, from), estimateImageUsd(image.model));
    const after = 'Only the picture is painted. Its walk clip is made separately, when you ask for it, so you can look at the picture first.';
    return { at: Date.now(), steps: [step], notes: ['A picture that shows more than one figure is painted once more, for about the same again.', after] };
  }

  /** Exactly what painting a walker's four isometric ways together on one sheet would send. */
  async previewWays(walker: Walker): Promise<Recipe> {
    const image = this.options.provider();
    if (!image) throw new Error(stopReason(this.options));
    const step = await this.options.recipes!.imageStep(`${walker.name} standing in the four isometric ways, side by side`, image, await this.waysRequest(walker), estimateImageUsd(image.model));
    return {
      at: Date.now(),
      steps: [step],
      notes: [
        'The four ways are painted together on one sheet, so they keep one look, then cut apart into a standing picture each. The pictures they replace are kept as versions.',
        'A sheet that does not show exactly four figures is painted once more, for about the same again.',
      ],
    };
  }

  /**
   * Exactly what making one direction's walk clip would send: the standing
   * picture there now is its first and last frame; `prompt` replaces the
   * usual words. Refused when there is no standing picture yet.
   */
  async previewClip(walker: Walker, direction: IsoWay, prompt?: string): Promise<Recipe> {
    const video = this.options.video();
    if (!video) throw new Error(stopReason(this.options));
    const start = await this.startView(walker, direction);
    if (!start) throw new Error(`${walker.name} has no standing picture facing ${facingWords(direction)} yet. Paint that first.`);
    const first = { mimeType: 'image/png', data: await startFrame(start.view) };
    const step = await this.options.recipes!.clipStep(`${walker.name} walking ${facingWords(direction)}`, video, { prompt: prompt ?? walkVideoPrompt(walker.gear, direction, walker.body), seconds: CLIP_SECONDS, first }, estimateClipUsd(video.model), this.startName(walker, direction, start.approved));
    const frames = BODY_TYPES[walker.body]?.frames ?? 12;
    return { at: Date.now(), steps: [step], notes: [`A clip whose walk fails the free checks is made once more, for about ${estimateClipUsd(video.model).toFixed(2)} dollars. It is cut down to one cycle of ${frames} frames.`, 'The walk it replaces is kept as an earlier version. The other directions are kept as they are.'] };
  }

  /** A walker's standing picture facing one way, with what made it and the earlier ones. */
  async standing(walker: Walker, direction: Facing, approvedUrl?: string): Promise<StandingView> {
    const key = viewKey(walker, direction);
    const versions = await this.history.versions(key);
    const kept = await stat(this.viewPath(walker, direction)).catch(() => undefined);
    if (kept && !(await this.approvedCopy(walker, direction))) {
      const recipe = await this.options.recipes?.current(key);
      if (direction === 'front' && approvedUrl && (await this.sharpReference(walker))) versions.push({ id: 'approved', url: approvedUrl });
      return { url: `/${WALK_ART_PATH}/views/${walker.id}-${direction}.png?v=${Math.round(kept.mtimeMs).toString(36)}`, approved: false, ...(recipe ? { recipe } : {}), versions };
    }
    if (direction === 'front' && (await this.sharpReference(walker))) return { ...(approvedUrl ? { url: approvedUrl } : {}), approved: true, versions };
    return { approved: false, versions };
  }

  /**
   * Paints a walker standing in one direction, and nothing else: the clip is
   * made later from it, when the Owner asks. The picture it replaces is kept.
   */
  async paintView(walker: Walker, direction: IsoWay, prompt: string | undefined, handle?: ArtJobHandle, from?: readonly ViewSource[]): Promise<boolean> {
    handle?.start();
    const painted = await this.paintStanding(walker, direction, handle, prompt, from);
    if (!painted) return handle?.skip(stopReason(this.options)), false;
    handle?.done(painted.usd);
    if (!(await this.approvedCopy(walker, direction))) await this.history.keep(viewKey(walker, direction), this.viewPath(walker, direction));
    await this.keepView(walker, direction, painted);
    return true;
  }

  /**
   * Paints a walker standing in all four isometric ways together on one
   * sheet and keeps each as that way's standing picture; the pictures they
   * replace are kept as versions.
   */
  async paintWays(walker: Walker, handle?: ArtJobHandle): Promise<boolean> {
    handle?.start();
    let usd = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return handle?.skip(stopReason(this.options)), false;
      const request = await this.waysRequest(walker);
      const image = await watched(provider, handle).generate(request);
      const cost = imageUsd(provider.model, image);
      usd += cost;
      this.options.spend(cost, provider as ImageProvider);
      const ways = await waysFromSheet(image.data).catch((err) => {
        console.error(`The ways sheet of ${walker.id} was refused:`, (err as Error).message);
        return undefined;
      });
      if (!ways) continue;
      for (const way of ISO_WAYS) {
        if (!(await this.approvedCopy(walker, way))) await this.history.keep(viewKey(walker, way), this.viewPath(walker, way));
        // Each way's share of the sheet, so the four add up to what it cost.
        await this.keepView(walker, way, { figure: ways[way], usd: usd / ISO_WAYS.length, request, provider: provider as ImageProvider });
      }
      handle?.done(usd);
      return true;
    }
    const reason = `No clean sheet of ${walker.name}'s four ways: it did not show exactly four figures twice.`;
    handle?.fail(reason);
    throw new Error(reason);
  }

  /**
   * Makes one direction's walk clip from the standing picture there now, and
   * nothing else. The walk it replaces is kept; when it fails twice, the walk
   * stays as it was. The walk strips of every way that walks are made again.
   */
  async makeClip(walker: Walker, direction: IsoWay, prompt: string | undefined, handle?: ArtJobHandle): Promise<boolean> {
    const body = BODY_TYPES[walker.body] ?? BODY_TYPES['two-legged']!;
    const start = await this.startView(walker, direction);
    if (!start) {
      handle?.fail(`${walker.name} has no standing picture facing ${facingWords(direction)} yet.`);
      return true;
    }
    const id = walkArt(walker.id, direction);
    const version = await this.keepVersion(walker, direction);
    const cut = await this.walk(walker, direction, start.view, body.frames, handle, prompt);
    if (!cut || 'stop' in cut) {
      // Nothing changed, so the copy just put aside is not an earlier version.
      if (version) {
        await this.options.recipes?.bringBack(id, version);
        await rm(resolve(this.options.artDir, 'history', historyFolder(id), version), { recursive: true, force: true });
      }
      if (cut) handle?.skip(cut.stop);
      return !cut || !('stop' in cut);
    }
    await this.load();
    await this.writeKept(walker, true);
    return true;
  }

  /** Puts an earlier standing picture back, or with "approved" the walker's own picture (the front). */
  async restoreView(walker: Walker, direction: Facing, version: string): Promise<boolean> {
    const key = viewKey(walker, direction);
    const path = this.viewPath(walker, direction);
    if (version === 'approved') {
      if (direction !== 'front' || !(await exists(path)) || (await this.approvedCopy(walker, direction))) return false;
      await this.history.keep(key, path);
      await rm(path, { force: true });
      await this.options.recipes?.forget(key);
      return true;
    }
    if (await this.approvedCopy(walker, direction)) await rm(path, { force: true });
    await mkdir(resolve(this.dir, 'views'), { recursive: true });
    const restored = await this.history.restore(key, version, path);
    if (restored) this.options.onPainted?.([walkStandArt(walker.id, direction)]);
    return restored;
  }

  /** A walk direction's earlier versions, newest first. */
  async versions(walkerId: string, direction: Facing): Promise<WalkVersion[]> {
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
   * frames of every direction that has some. The walk it replaces is kept.
   */
  async restore(walker: Walker, direction: Facing, version: string): Promise<boolean> {
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
    await this.writeKept(walker, true);
    this.options.onPainted?.([walkStandArt(walker.id, direction)]);
    return true;
  }

  /** Copies one direction's walk aside, with what made it, before it is painted again or replaced. */
  private async keepVersion(walker: Walker, direction: Facing): Promise<string | undefined> {
    const id = walkArt(walker.id, direction);
    const names = (await this.cached(`frames/${id}.json`)) as string[] | undefined;
    if (!names) return undefined;
    await this.load();
    const entry = this.painted[id];
    const strip = resolve(this.dir, `${id}.png`);
    if (!entry || !(await exists(strip))) return undefined;
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
    return version;
  }

  /** A kept standing picture of one way, when there is one. */
  private keptView(walker: Walker, direction: Facing): Promise<Buffer | undefined> {
    return readFile(this.viewPath(walker, direction)).catch(() => undefined);
  }

  /** True when the front's kept standing picture is only the approved picture, kept for the walk (nothing made it). */
  private async approvedCopy(walker: Walker, direction: Facing): Promise<boolean> {
    return direction === 'front' && !(await this.options.recipes?.current(viewKey(walker, direction))) && (await this.sharpReference(walker));
  }

  private viewPath(walker: Walker, direction: Facing): string {
    return resolve(this.dir, 'views', `${walker.id}-${direction}.png`);
  }

  /** What a clip in one direction starts from now: the kept standing picture, or the approved picture for the front. */
  private async startView(walker: Walker, direction: Facing): Promise<{ view: Buffer; approved: boolean } | undefined> {
    const kept = await this.keptView(walker, direction);
    if (kept) return { view: kept, approved: await this.approvedCopy(walker, direction) };
    if (direction === 'front' && (await this.sharpReference(walker))) return { view: await soleFigure(await this.onMagenta(walker)), approved: true };
    return undefined;
  }

  /** What a clip starts from, in words. */
  private startName(walker: Walker, direction: Facing, approved: boolean): string {
    return approved ? `${walker.name}'s approved picture` : `${walker.name} standing, facing ${facingWords(direction)}`;
  }

  /**
   * What painting a walker standing facing one way sends to the image
   * model: painted from its approved picture, or from the pictures chosen in
   * `from` (the approved picture and standing pictures already kept), since
   * the front alone does not show everything, such as how a scarf hangs at
   * the back. Refused when a chosen standing picture is not there.
   */
  private async viewRequest(walker: Walker, direction: IsoWay, prompt?: string, from: readonly ViewSource[] = ['approved']): Promise<ImageRequest> {
    const chosen = [...new Set(from.length ? from : ['approved' as const])];
    const references: ImageRequest['references'] = [];
    const labels: string[] = [];
    for (const source of chosen) {
      if (source === 'approved') {
        references.push({ mimeType: 'image/png', data: await this.onMagenta(walker) });
        labels.push(`${walker.name}'s approved picture, on magenta`);
        continue;
      }
      const view = (await this.approvedCopy(walker, source)) ? undefined : await this.keptView(walker, source);
      if (!view) throw new Error(`${walker.name} has no standing picture facing ${facingWords(source)} to paint from.`);
      references.push({ mimeType: 'image/png', data: await sharp(view).flatten({ background: KEY_COLOR.hex }).png().toBuffer() });
      labels.push(`${walker.name} standing, facing ${facingWords(source)}, on magenta`);
    }
    return {
      prompt: prompt ?? viewPrompt(walker.name, walker.gear, direction, references.length),
      references,
      labels,
      // The pictures are the walker to paint, not only a style to match, so the "do not copy their subjects" note would fight the prompt.
      edit: true,
      aspectRatio: '3:4',
    };
  }


  /** What painting the four isometric ways on one sheet sends: the approved picture, and the sheet's words. */
  private async waysRequest(walker: Walker): Promise<ImageRequest> {
    return {
      prompt: waysSheetPrompt(walker.name, walker.gear),
      references: [{ mimeType: 'image/png', data: await this.onMagenta(walker) }],
      labels: [`${walker.name}'s approved picture, on magenta`],
      edit: true,
      // Four standing figures in a row, with room between them.
      aspectRatio: '16:9',
      size: '2K',
    };
  }

  /** Writes the walk strips of every way a walker has frames for. */
  private async writeKept(walker: Walker, redone: boolean): Promise<void> {
    const walks: [Facing, Buffer[]][] = [];
    // The isometric ways too, so every walk of a look is drawn at one scale.
    for (const d of FACINGS) {
      const frames = (await this.cached(`frames/${walkArt(walker.id, d)}.json`)) as string[] | undefined;
      if (frames) walks.push([d, await Promise.all(frames.map((f) => readFile(resolve(this.dir, 'frames', f))))]);
    }
    if (walks.length) await this.writeStrips(walker, walks, redone);
  }

  /**
   * Writes a walker's walk strips from their frames, all at one scale: every
   * way it walks so far, so a walker uses each walk as soon as it is made.
   */
  private async writeStrips(walker: Walker, walks: [Facing, Buffer[]][], redone: boolean): Promise<void> {
    const body = BODY_TYPES[walker.body] ?? BODY_TYPES['two-legged']!;
    // One scale for the whole look, so it keeps its size when it turns.
    const { strips, frameWidth, frameHeight } = await normalizeWalk(walks.map(([, frames]) => frames));
    await mkdir(this.dir, { recursive: true });
    const now = Date.now();
    for (const [i, [direction]] of walks.entries()) {
      const id = walkArt(walker.id, direction);
      await writeFile(resolve(this.dir, `${id}.png`), strips[i]!);
      const file = `${WALK_ART_PATH}/${id}.png`;
      // A repaint keeps the file name, so the address changes to make browsers fetch it again.
      this.painted[id] = { file: redone ? `${file}?v=${now.toString(36)}` : file, kind: 'walk', width: frameWidth * body.frames, height: frameHeight, frames: body.frames, cycleSeconds: body.cycleSeconds, ...(redone ? { redone: now } : {}) };
    }
    await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
    this.options.onPainted?.(walks.map(([d]) => walkArt(walker.id, d)));
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

  /**
   * Paints the walker standing in one direction, tried twice when the
   * picture shows more than one figure; undefined when painting has to stop.
   */
  private async paintStanding(walker: Walker, direction: IsoWay, handle?: ArtJobHandle, prompt?: string, from?: readonly ViewSource[]): Promise<{ figure: Buffer; usd: number; request: ImageRequest; provider: ImageProvider } | undefined> {
    let usd = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return undefined;
      const request = await this.viewRequest(walker, direction, prompt, from);
      const image = await watched(provider, handle).generate(request);
      const cost = imageUsd(provider.model, image);
      usd += cost;
      this.options.spend(cost, provider as ImageProvider);
      const figure = await soleFigure(image.data).catch((err) => {
        console.error(`The ${direction} view of ${walker.id} was refused:`, (err as Error).message);
        return undefined;
      });
      if (figure) return { figure, usd, request, provider };
    }
    const reason = `No clean ${direction} view of ${walker.name}: the picture showed more than one figure twice.`;
    handle?.fail(reason);
    throw new Error(reason);
  }

  /** Keeps a painted standing picture, with what made it. */
  private async keepView(walker: Walker, direction: Facing, painted: { figure: Buffer; usd: number; request: ImageRequest; provider: ImageProvider }): Promise<void> {
    await mkdir(resolve(this.dir, 'views'), { recursive: true });
    await writeFile(this.viewPath(walker, direction), painted.figure);
    this.options.onPainted?.([walkStandArt(walker.id, direction)]);
    await this.options.recipes?.record(viewKey(walker, direction), { at: Date.now(), steps: [await this.options.recipes.imageStep(`${walker.name} standing, facing ${facingWords(direction)}`, painted.provider, painted.request, painted.usd)] });
  }

  /** One direction's walk cut from a clip, tried twice; `stop` says why when painting has to stop. */
  private async walk(walker: Walker, direction: IsoWay, view: Buffer, count: number, handle?: ArtJobHandle, prompt = walkVideoPrompt(walker.gear, direction, walker.body)): Promise<Buffer[] | { stop: string } | undefined> {
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
        const clip = await watched(provider, handle).generate({ prompt, first, last: first, seconds: CLIP_SECONDS });
        sent = provider;
        const cost = videoUsd(provider.model, clip);
        usd += cost;
        this.options.spendVideo(cost, provider);
        await mkdir(resolve(this.dir, 'raw'), { recursive: true });
        await writeFile(resolve(this.dir, 'raw', `${id}${attempt ? '-retry' : ''}.mp4`), clip.data);
        const { figures, placed } = await walkFromFrames(await (this.options.toFrames ?? videoFrames)(clip.data), count);
        // Neighbouring frames of a smooth clip are meant to be close, so repeats only matter when most frames look alike.
        const check = await checkWalk(figures, view, { samePose: 0.02 });
        const problems = check.problems.filter((p) => !p.includes('repeats'));
        if (check.distinctPoses < count / 3) problems.push('The walker barely moves.');
        if (problems.length) throw new Error(problems.join(' '));
        await mkdir(resolve(this.dir, 'frames'), { recursive: true });
        const names = figures.map((_, i) => `${id}-${String(i + 1).padStart(2, '0')}.png`);
        // Kept where they stood in the clip, so the strips line the cycle up as it was filmed.
        await Promise.all(placed.map((f, i) => writeFile(resolve(this.dir, 'frames', names[i]!), f)));
        await writeFile(resolve(this.dir, 'frames', `${id}.json`), JSON.stringify(names));
        await this.markPlaced(id);
        handle?.done(usd);
        await this.keepRecipe(walker, direction, sent, prompt, first, usd);
        return placed;
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
  private async keepRecipe(walker: Walker, direction: IsoWay, provider: VideoProvider | undefined, prompt: string, first: { mimeType: string; data: Buffer }, usd: number): Promise<void> {
    const recipes = this.options.recipes;
    if (!recipes || !provider) return;
    const view = await recipes.current(viewKey(walker, direction));
    const clip = await recipes.clipStep(`${walker.name} walking ${facingWords(direction)}`, provider, { prompt, seconds: CLIP_SECONDS, first }, usd, this.startName(walker, direction, false));
    await recipes.record(walkArt(walker.id, direction), { at: Date.now(), steps: [...(view?.steps ?? []), clip] });
  }

  private async cached(name: string): Promise<unknown> {
    const text = await readFile(resolve(this.dir, name), 'utf8').catch(() => undefined);
    return text === undefined ? undefined : JSON.parse(text);
  }
}

/** Where the recipe of a walker's standing picture facing one way is kept. */
function viewKey(walker: Walker, direction: Facing): string {
  return `${walker.id}-${direction}-view`;
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

/** Which way a walker faces, in words for the painting log. */
export function facingWords(direction: Facing): string {
  return direction === 'front' ? 'towards us' : direction === 'back' ? 'away' : direction.startsWith('front-') ? `towards us and to the ${direction.slice(6)}` : direction.startsWith('back-') ? `away and to the ${direction.slice(5)}` : direction;
}

/**
 * A standing picture's file: the walker's id, then its way. The longer ways
 * are tried first, so a front-left picture is not read as a left one.
 */
const VIEW_FILE = new RegExp(`^(.+?)-(${[...FACINGS].sort((a, b) => b.length - a.length).join('|')})\\.png$`);

/** Why painting stopped before the end, in plain words. */
function stopReason(options: WalkPainterOptions): string {
  if (options.overBudget()) return "Spending is paused: this month's budget or today's cap is used up.";
  if (!options.provider()) return "No image model is set in God's View.";
  if (!options.video()) return 'No video model: walks need the Google AI Studio key.';
  return 'Painting stopped.';
}

/** True when two sets of pictures have the same sizes, picture by picture: cut from the same clip. */
async function sameSizes(a: Buffer[], b: Buffer[]): Promise<boolean> {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const [x, y] = await Promise.all([sharp(a[i]!).metadata(), sharp(b[i]!).metadata()]);
    if (x.width !== y.width || x.height !== y.height) return false;
  }
  return true;
}
