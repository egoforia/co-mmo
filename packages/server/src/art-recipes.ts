import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { REFERENCE_NOTE } from './assets/gemini.ts';
import type { GeneratedImage, ImageProvider, ImageRequest } from './assets/provider.ts';
import type { VideoProvider, VideoRequest } from './assets/video.ts';
import { historyFolder } from './art-history.ts';

// What was sent to an AI model to make each picture, clip or sound: the
// prompt, the pictures that went with it, the model and what it cost. God's
// View shows it before anything is painted (so the Owner can approve it) and
// keeps it with every version, so an old version can be compared with the
// current one by what made it as well as by how it looks.

/** Where the pictures sent along are kept and served from, under the wished-art directory. */
export const RECIPE_PICTURES_PATH = 'wished-art/recipes/pictures';

/** A picture sent along with a request. */
export interface RecipePicture {
  /** What it is, in words: "Mara's approved picture". */
  name: string;
  /** Where the browser loads a copy from (shown smaller than it was sent). */
  url?: string;
  /** Not made yet: an earlier step of the same request paints it. */
  later?: boolean;
}

/** One call to an AI model. */
export interface RecipeStep {
  /** What the call makes, in words: "Standing picture, facing left". */
  label: string;
  media: 'picture' | 'clip' | 'sound';
  provider: string;
  model: string;
  prompt: string;
  /** Words the service sends along with the pictures, before the prompt. */
  note?: string;
  /** Pictures sent along, in order. */
  pictures: RecipePicture[];
  /** Other things sent: shape, size, length. */
  settings: string[];
  /** About what it costs, or what it did cost once made. */
  usd: number;
}

/** Everything sent to make one version of a picture, walk or sound. */
export interface Recipe {
  /** When it was made, or for a review, when it was worked out. */
  at: number;
  steps: RecipeStep[];
  /** What else may happen, such as retries after a failed style check. */
  notes?: string[];
  /** Kept from before recipes were: only what is known. */
  partial?: boolean;
}

/** The total a recipe costs. */
export function recipeUsd(recipe: Recipe): number {
  return recipe.steps.reduce((n, s) => n + s.usd, 0);
}

/** Thrown by a dry provider in place of painting: the request is all that was wanted. */
export class Previewed extends Error {
  constructor() {
    super('Only a preview: nothing was painted.');
  }
}

/** An image provider that keeps the request it is given and paints nothing, to show what painting would send. */
export function dryImage(provider: ImageProvider): ImageProvider & { sent?: ImageRequest } {
  const dry: ImageProvider & { sent?: ImageRequest } = {
    id: provider.id,
    model: provider.model,
    generate: async (request) => {
      dry.sent = request;
      throw new Previewed();
    },
  };
  return dry;
}

/** An image provider that paints as usual and keeps the last request it sent, for the version's recipe. */
export function keepingImage(provider: ImageProvider): ImageProvider & { sent?: ImageRequest } {
  const kept: ImageProvider & { sent?: ImageRequest } = {
    id: provider.id,
    model: provider.model,
    generate: (request) => {
      kept.sent = request;
      return provider.generate(request);
    },
  };
  return kept;
}

/** The same for a video provider. */
export function keepingVideo(provider: VideoProvider): VideoProvider & { sent?: VideoRequest } {
  const kept: VideoProvider & { sent?: VideoRequest } = {
    id: provider.id,
    model: provider.model,
    generate: (request) => {
      kept.sent = request;
      return provider.generate(request);
    },
  };
  return kept;
}

/** Recipes of the current versions, and copies of the pictures they sent. */
export class RecipeBook {
  constructor(private readonly artDir: string) {}

  private get picturesDir(): string {
    return resolve(this.artDir, 'recipes', 'pictures');
  }

  private file(asset: string): string {
    return resolve(this.artDir, 'recipes', `${historyFolder(asset)}.json`);
  }

  /** A version's recipe file, beside the version it describes. */
  private versionFile(asset: string, version: string): string {
    return resolve(this.artDir, 'history', historyFolder(asset), `${version}.json`);
  }

  /** Keeps a smaller copy of a picture sent along, once per picture, and says where it is served. */
  async picture(data: Buffer): Promise<string> {
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 16);
    const path = resolve(this.picturesDir, `${hash}.webp`);
    if (!(await stat(path).then(() => true, () => false))) {
      await mkdir(this.picturesDir, { recursive: true });
      const small = await sharp(data).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
      await writeFile(path, small);
    }
    return `/${RECIPE_PICTURES_PATH}/${hash}.webp`;
  }

  /** One image request as a recipe step; `names` say what each picture sent along is. */
  async imageStep(label: string, provider: { id: string; model: string }, request: ImageRequest, usd: number): Promise<RecipeStep> {
    const pictures = await Promise.all((request.references ?? []).map(async (r, i) => ({ name: request.labels?.[i] ?? `Picture ${i + 1}`, url: await this.picture(r.data) })));
    const settings = [request.aspectRatio ? `shape ${request.aspectRatio}` : 'square', `size ${request.size ?? '1K'}`];
    if (request.edit) settings.push('the pictures show the subject itself, not only the style');
    const note = provider.id === 'gemini' && pictures.length && !request.edit ? REFERENCE_NOTE : undefined;
    return { label, media: 'picture', provider: provider.id, model: provider.model, prompt: request.prompt, ...(note ? { note } : {}), pictures, settings, usd };
  }

  /**
   * One video request as a recipe step. Walk clips start and end on the same
   * picture, so it loops; `start` says what that picture is, and with no
   * `first` it is painted by an earlier step of the same request.
   */
  async clipStep(label: string, provider: { id: string; model: string }, request: Pick<VideoRequest, 'prompt' | 'seconds' | 'resolution'> & { first?: GeneratedImage }, usd: number, start: string): Promise<RecipeStep> {
    const name = `First and last frame: ${start}`;
    const pictures = [request.first ? { name, url: await this.picture(request.first.data) } : { name, later: true }];
    const settings = [`${request.seconds} seconds`, request.resolution ?? '720p', 'wide (16:9)', 'ends on its first frame, so it loops'];
    return { label, media: 'clip', provider: provider.id, model: provider.model, prompt: request.prompt, pictures, settings, usd };
  }

  /** The recipe of what is shown now, when it was kept. */
  async current(asset: string): Promise<Recipe | undefined> {
    return readJson(this.file(asset));
  }

  /** Keeps the recipe of what was just made. */
  async record(asset: string, recipe: Recipe): Promise<void> {
    await mkdir(resolve(this.artDir, 'recipes'), { recursive: true });
    await writeFile(this.file(asset), JSON.stringify(recipe, null, 2));
  }

  /** Moves the current recipe beside an earlier version that was just put aside; `fallback` when none was kept. */
  async putAside(asset: string, version: string, fallback?: Recipe): Promise<void> {
    const current = this.file(asset);
    if (await stat(current).then(() => true, () => false)) {
      await mkdir(resolve(this.artDir, 'history', historyFolder(asset)), { recursive: true });
      await rename(current, this.versionFile(asset, version));
    } else if (fallback) {
      await writeFile(this.versionFile(asset, version), JSON.stringify(fallback, null, 2));
    }
  }

  /** An earlier version's recipe. */
  async ofVersion(asset: string, version: string): Promise<Recipe | undefined> {
    return readJson(this.versionFile(asset, version));
  }

  /** Makes an earlier version's recipe the current one again, after that version was put back. */
  async bringBack(asset: string, version: string): Promise<void> {
    const recipe = await this.ofVersion(asset, version);
    if (recipe) await this.record(asset, recipe);
    else await rm(this.file(asset), { force: true });
  }

  /** Forgets the current recipe, when what it made is gone (the shipped picture shows again). */
  async forget(asset: string): Promise<void> {
    await rm(this.file(asset), { force: true });
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}
