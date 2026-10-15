import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

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
}

/** A picture id as a folder name: wished pictures' "<wish>:<picture>" ids hold a colon. */
export function historyFolder(asset: string): string {
  return asset.replace(/:/g, '~');
}

/** Earlier versions of pictures, kept on disk. */
export class ArtHistory {
  constructor(private readonly artDir: string) {}

  private dir(asset: string): string {
    return resolve(this.artDir, 'history', historyFolder(asset));
  }

  /** Puts a picture's current file aside before it is replaced; nothing happens when there is none yet. */
  async keep(asset: string, file: string): Promise<void> {
    const exists = await stat(file).then((s) => s.isFile(), () => false);
    if (!exists) return;
    await mkdir(this.dir(asset), { recursive: true });
    // A millisecond apart at least, so two quick repaints keep both.
    let at = Date.now();
    const taken = new Set(await readdir(this.dir(asset)));
    while (taken.has(`${at.toString(36)}${extname(file)}`)) at++;
    await copyFile(file, resolve(this.dir(asset), `${at.toString(36)}${extname(file)}`));
  }

  /** A picture's earlier versions, newest first. */
  async versions(asset: string): Promise<ArtVersion[]> {
    const names = await readdir(this.dir(asset)).catch(() => [] as string[]);
    return names
      .filter((n) => /^[0-9a-z]+\.(png|webp)$/.test(n))
      .sort((a, b) => Number.parseInt(b, 36) - Number.parseInt(a, 36))
      .map((n) => ({ id: n.replace(/\.\w+$/, ''), url: `/${HISTORY_PATH}/${historyFolder(asset)}/${n}` }));
  }

  /**
   * Puts an earlier version back in place of `file`. The picture it replaces
   * is put aside first, so going back can itself be undone.
   */
  async restore(asset: string, version: string, file: string): Promise<boolean> {
    const found = (await readdir(this.dir(asset)).catch(() => [] as string[])).find((n) => n.replace(/\.\w+$/, '') === version);
    if (!found) return false;
    await this.keep(asset, file);
    await copyFile(resolve(this.dir(asset), found), file);
    return true;
  }
}
