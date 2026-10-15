import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { BUILDING_STYLES, type ArtManifest } from '@co-mmo/shared';
import { buildingArtJobs, paintBuildingArt, type BuildingArtJob } from './assets/building-art.ts';
import type { ImageProvider } from './assets/provider.ts';
import { estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import { plain, type ArtJobHandle, type ArtJobSource, type ArtJobs } from './art-jobs.ts';
import { watched } from './paint-queue.ts';

/** Where painted building art is served from, under the wished-art directory. */
export const BUILDING_ART_PATH = 'wished-art/buildings';

export interface BuildingPainterOptions {
  /** The image model chosen in God's View, or undefined when there is none. */
  provider: () => ImageProvider | undefined;
  /** True while spending is paused: this month's budget is spent or today's cap is reached. */
  overBudget: () => boolean;
  /** Records what a picture cost. */
  spend: (usd: number, provider: ImageProvider) => void;
  /** Approved anchors, sent as style references. */
  anchorDir: string;
  /** The wished-art directory; building art goes in its buildings/ folder. */
  artDir: string;
  /** Art shipped with the game, already painted: never painted again. */
  shipped: () => Promise<ArtManifest>;
  /** The painting log God's View shows. */
  jobs?: ArtJobs;
}

/** Every picture any building needs, outside first for each building. */
export function allBuildingArt(): BuildingArtJob[] {
  return Object.values(BUILDING_STYLES).flatMap(buildingArtJobs);
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
    await this.load();
    const shipped = await this.options.shipped();
    const missing = allBuildingArt().filter((job) => !shipped[job.id] && !this.painted[job.id]);
    const model = this.options.provider()?.model ?? '';
    const queued = missing.map((job) => this.options.jobs?.add(job.id, label(job), 'picture', 'start-up', estimateImageUsd(model)));
    for (const [i, job] of missing.entries()) {
      const handle = queued[i];
      const provider = this.options.provider();
      if (!provider || this.options.overBudget()) {
        for (const left of queued.slice(i)) left?.skip(provider ? "Spending is paused: this month's budget or today's cap is used up." : 'No image model is set in God\'s View.');
        return;
      }
      try {
        await this.paint(job, provider, handle);
      } catch (err) {
        console.error(`Painting ${job.id} failed:`, (err as Error).message);
        // The outside is every other picture's reference; without it, stop.
        if (job.kind === 'exterior') {
          for (const left of queued.slice(i + 1)) left?.skip('The outside of this building failed, and the inside is painted to match it.');
          return;
        }
      }
    }
  }

  /**
   * Paints one building picture again at the Owner's request, even one that
   * shipped with the game: the new one replaces it. `note` adds the Owner's
   * own words to the prompt.
   */
  async repaint(id: string, note = '', handle?: ArtJobHandle): Promise<void> {
    const job = allBuildingArt().find((j) => j.id === id);
    if (!job) throw new Error('There is no building picture by that name.');
    const provider = this.options.provider();
    if (!provider) throw new Error("No image model is set in God's View.");
    await this.load();
    await this.paint(note.trim() ? { ...job, prompt: `${job.prompt}\nAlso: ${note.trim()}` } : job, provider, handle, true);
  }

  /** The file of a building picture painted here, if there is one. */
  async fileOf(id: string): Promise<string | undefined> {
    await this.load();
    const entry = this.painted[id];
    return entry && resolve(this.dir, basename(entry.file.split('?')[0]!));
  }

  /** Makes browsers load a picture afresh after its file was replaced on disk (an earlier version put back). */
  async touch(id: string): Promise<void> {
    await this.load();
    const entry = this.painted[id];
    if (!entry) return;
    this.painted[id] = { ...entry, file: `${entry.file.split('?')[0]}?v=${Date.now().toString(36)}`, redone: Date.now() };
    await this.save();
  }

  /** Drops what was painted here for a shipped building picture, so the shipped one shows again. */
  async forget(id: string): Promise<void> {
    await this.load();
    delete this.painted[id];
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
  }

  /** Queues a job in the painting log for one building picture. */
  queue(id: string, source: ArtJobSource): ArtJobHandle | undefined {
    const job = allBuildingArt().find((j) => j.id === id);
    return job && this.options.jobs?.add(id, label(job), 'picture', source, estimateImageUsd(this.options.provider()?.model ?? ''));
  }

  private async load(): Promise<void> {
    this.painted = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
  }

  private async paint(job: BuildingArtJob, provider: ImageProvider, handle?: ArtJobHandle, redone = false): Promise<void> {
    handle?.start();
    try {
      const { image, entry } = await paintBuildingArt(job, watched(provider, handle), {
        anchorDir: this.options.anchorDir,
        rawDir: resolve(this.dir, 'raw'),
        outDir: this.dir,
      });
      const usd = imageUsd(provider.model, image);
      this.options.spend(usd, provider);
      const file = entry.file.replace(/^art\//, `${BUILDING_ART_PATH}/`);
      // A repaint keeps the same file name, so the address changes to make browsers fetch it again.
      this.painted[job.id] = { ...entry, file: redone ? `${file}?v=${Date.now().toString(36)}` : file, ...(redone ? { redone: Date.now() } : {}) };
      await mkdir(this.dir, { recursive: true });
      await writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.painted, null, 2));
      handle?.done(usd);
    } catch (err) {
      handle?.fail(plain(err));
      throw err;
    }
  }
}

/** A building picture in words, for the painting log. */
function label(job: BuildingArtJob): string {
  const style = Object.values(BUILDING_STYLES).find((s) => job.id.startsWith(`${s.id}-`));
  if (!style) return job.id;
  const part = job.id.slice(style.id.length + 1).replace(/^furniture-/, '').replace(/-/g, ' ');
  return `${style.name}: ${part === 'exterior' ? 'outside' : part}`;
}
