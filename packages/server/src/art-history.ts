import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { Recipe, RecipeBook } from './art-recipes.ts';

// Earlier versions of pictures painted again from God's View (design doc,
// asset tiers: "old versions stay in storage, so a worse result can be
// reverted"). Before a picture is replaced its file is copied here, under
// the picture's id, named by when it was put aside.

/** Where earlier versions are served from, under the wished-art directory. */
export const HISTORY_PATH = 'wished-art/history';

/** One earlier version of a picture. */
export interface ArtVersion {
  /** When it was put aside, as a base-36 time: also its file name. */
  id: string;
  url: string;
  /** What was sent to make it, when that was kept. */
  recipe?: Recipe;
}

/** A picture id as a folder name: wished pictures' "<wish>:<picture>" ids hold a colon. */
export function historyFolder(asset: string): string {
  return asset.replace(/:/g, '~');
}

/** Earlier versions of pictures, kept on disk. */
export class ArtHistory {
  constructor(private readonly artDir: string, private readonly recipes?: RecipeBook) {}

  private dir(asset: string): string {
    return resolve(this.artDir, 'history', historyFolder(asset));
  }

  /**
   * Puts a picture's current file aside before it is replaced, with the
   * recipe that made it (`fallback` when none was kept); nothing happens when
   * there is no file yet. Returns the version it was kept as.
   */
  async keep(asset: string, file: string, fallback?: Recipe): Promise<string | undefined> {
    const exists = await stat(file).then((s) => s.isFile(), () => false);
    if (!exists) return undefined;
    await mkdir(this.dir(asset), { recursive: true });
    // A millisecond apart at least, so two quick repaints keep both.
    let at = Date.now();
    const taken = new Set(await readdir(this.dir(asset)));
    while (taken.has(`${at.toString(36)}${extname(file)}`)) at++;
    await copyFile(file, resolve(this.dir(asset), `${at.toString(36)}${extname(file)}`));
    await this.recipes?.putAside(asset, at.toString(36), fallback);
    return at.toString(36);
  }

  /** A picture's earlier versions, newest first. */
  async versions(asset: string): Promise<ArtVersion[]> {
    const names = await readdir(this.dir(asset)).catch(() => [] as string[]);
    const versions: ArtVersion[] = names
      .filter((n) => /^[0-9a-z]+\.(png|webp)$/.test(n))
      .sort((a, b) => Number.parseInt(b, 36) - Number.parseInt(a, 36))
      .map((n) => ({ id: n.replace(/\.\w+$/, ''), url: `/${HISTORY_PATH}/${historyFolder(asset)}/${n}` }));
    for (const v of versions) {
      const recipe = await this.recipes?.ofVersion(asset, v.id);
      if (recipe) Object.assign(v, { recipe });
    }
    return versions;
  }

  /**
   * Puts an earlier version back in place of `file`. The picture it replaces
   * is put aside first, so going back can itself be undone.
   */
  async restore(asset: string, version: string, file: string, fallback?: Recipe): Promise<boolean> {
    const found = (await readdir(this.dir(asset)).catch(() => [] as string[])).find((n) => n === `${version}.png` || n === `${version}.webp`);
    if (!found) return false;
    await this.keep(asset, file, fallback);
    await copyFile(resolve(this.dir(asset), found), file);
    await this.recipes?.bringBack(asset, version);
    return true;
  }
}
