import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ArtManifest } from '@co-mmo/shared';
import { paintWalkArt, walkArtJobs } from './assets/walk-art.ts';
import { imageUsd } from './assets/wish-art.ts';
import type { BuildingPainterOptions } from './building-painter.ts';

/** Where painted walk sheets are served from, under the wished-art directory. */
export const WALK_ART_PATH = 'wished-art/walks';

/**
 * Paints the hero's walk sheets that are missing, with the image model chosen
 * in God's View, when the server starts. Until a sheet is painted, the hero
 * glides in their standing pose as before.
 */
export class WalkPainter {
  private painted: ArtManifest = {};
  /** The painting run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;

  constructor(private readonly options: BuildingPainterOptions) {}

  private get dir(): string {
    return resolve(this.options.artDir, 'walks');
  }

  /** Walk sheets this server painted, for clients to load beside the shipped art. */
  manifest(): ArtManifest {
    return this.painted;
  }

  /** Paints whatever walk sheets are missing, one at a time, while the budget allows. */
  start(): Promise<void> {
    this.job ??= this.run()
      .catch((err) => console.error('Painting walks stopped:', (err as Error).message))
      .finally(() => (this.job = undefined));
    return this.job;
  }

  private async run(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
    const shipped = await this.options.shipped();
    const missing = walkArtJobs().filter((job) => !shipped[job.id] && !this.painted[job.id]);
    for (const job of missing) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return;
      try {
        const { image, entry } = await paintWalkArt(job, provider, {
          anchorDir: this.options.anchorDir,
          rawDir: resolve(this.dir, 'raw'),
          outDir: this.dir,
        });
        this.options.spend(imageUsd(provider.model, image), provider);
        this.painted[job.id] = { ...entry, file: entry.file.replace(/^art\//, `${WALK_ART_PATH}/`) };
        await mkdir(this.dir, { recursive: true });
        await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
      } catch (err) {
        console.error(`Painting ${job.id} failed:`, (err as Error).message);
      }
    }
  }
}
