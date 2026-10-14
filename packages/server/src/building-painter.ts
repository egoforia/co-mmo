import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BUILDING_STYLES, type ArtManifest } from '@co-mmo/shared';
import { buildingArtJobs, paintBuildingArt } from './assets/building-art.ts';
import type { ImageProvider } from './assets/provider.ts';
import { imageUsd } from './assets/wish-art.ts';

/** Where painted building art is served from, under the wished-art directory. */
export const BUILDING_ART_PATH = 'wished-art/buildings';

export interface BuildingPainterOptions {
  /** The image model chosen in God's View, or undefined when there is none. */
  provider: () => ImageProvider | undefined;
  /** True once this month's budget is spent. */
  overBudget: () => boolean;
  /** Records what a picture cost. */
  spend: (usd: number, provider: ImageProvider) => void;
  /** Approved anchors, sent as style references. */
  anchorDir: string;
  /** The wished-art directory; building art goes in its buildings/ folder. */
  artDir: string;
  /** Art shipped with the game, already painted: never painted again. */
  shipped: () => Promise<ArtManifest>;
}

/**
 * Paints art for buildings that do not have it yet, such as one an Engine
 * wish added: the code only describes the building (BUILDING_STYLES), and the
 * image model chosen in God's View paints it when the server starts.
 */
export class BuildingPainter {
  private painted: ArtManifest = {};
  /** The painting run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;

  constructor(private readonly options: BuildingPainterOptions) {}

  private get dir(): string {
    return resolve(this.options.artDir, 'buildings');
  }

  /** Building art this server painted, for clients to load beside the shipped art. */
  manifest(): ArtManifest {
    return this.painted;
  }

  /** Paints whatever building art is missing, one picture at a time, while the budget allows. */
  start(): Promise<void> {
    this.job ??= this.run()
      .catch((err) => console.error('Painting buildings stopped:', (err as Error).message))
      .finally(() => (this.job = undefined));
    return this.job;
  }

  private async run(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
    const shipped = await this.options.shipped();
    const missing = Object.values(BUILDING_STYLES)
      .flatMap(buildingArtJobs)
      .filter((job) => !shipped[job.id] && !this.painted[job.id]);
    for (const job of missing) {
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) return;
      try {
        const { image, entry } = await paintBuildingArt(job, provider, {
          anchorDir: this.options.anchorDir,
          rawDir: resolve(this.dir, 'raw'),
          outDir: this.dir,
        });
        this.options.spend(imageUsd(provider.model, image), provider);
        this.painted[job.id] = { ...entry, file: entry.file.replace(/^art\//, `${BUILDING_ART_PATH}/`) };
        await mkdir(this.dir, { recursive: true });
        await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
      } catch (err) {
        console.error(`Painting ${job.id} failed:`, (err as Error).message);
        // The outside is every other picture's reference; without it, stop.
        if (job.kind === 'exterior') return;
      }
    }
  }
}
