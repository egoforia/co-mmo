import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ArtPoints, ArtPointsManifest } from '@co-mmo/shared';
import type { ChatModel } from './ai/chat.ts';
import { GRIP, HAND, findPoint, stripFrames } from './assets/points.ts';

// Held items (milestone 10): finds, once per picture, where a walker's free
// hand is in every frame and where each item is gripped, so the client can
// put a player's weapon or charm in their hand. A picture painted again is
// looked at again; a picture with no model to look at it shows no held item.

/** A picture to find points in. */
export interface PointSource {
  /** Its art id, as the client draws it. */
  id: string;
  /** A walker's picture or walk strip (its hand), or an item (its grip). */
  kind: 'hands' | 'grip';
  /** The file it is served from, with any version; a new one means look again. */
  file: string;
  /** A walk strip's frames side by side; a still picture has one. */
  frames: number;
  read: () => Promise<Buffer | undefined>;
}

export interface HandFinderOptions {
  artDir: string;
  /** A model that can see pictures (the style check's judge), or none. */
  model: () => ChatModel | undefined;
  /** Every picture that may need points: walkers, walk strips and held items. */
  sources: () => Promise<PointSource[]>;
  /** True while nothing more should be spent today. */
  paused: () => boolean;
  /** Records what looking cost. */
  spend: (usd: number, model: ChatModel) => void;
}

interface Found extends ArtPoints {
  /** The file the points were found in. */
  from: string;
}

/** Hands and grips found so far, kept on disk beside the painted art. */
export class HandFinder {
  private found: Record<string, Found> = {};
  private loaded?: Promise<void>;
  /** The run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;
  /** Asked again while running: run once more after, for pictures painted meanwhile. */
  private again = false;

  constructor(private readonly options: HandFinderOptions) {}

  private get file(): string {
    return resolve(this.options.artDir, 'points.json');
  }

  private load(): Promise<void> {
    this.loaded ??= readFile(this.file, 'utf8').then(
      (text) => void (this.found = JSON.parse(text) as Record<string, Found>),
      () => undefined,
    );
    return this.loaded;
  }

  /** Points by art id, for clients. */
  async manifest(): Promise<ArtPointsManifest> {
    await this.load();
    return Object.fromEntries(Object.entries(this.found).map(([id, { from: _from, ...points }]) => [id, points]));
  }

  /** Looks at every picture with no points yet, or painted again since. */
  start(): Promise<void> {
    if (this.job) {
      this.again = true;
      return this.job;
    }
    this.job = this.run()
      .catch((err) => console.error('Finding hands stopped:', (err as Error).message))
      .finally(() => {
        this.job = undefined;
        if (this.again) {
          this.again = false;
          void this.start();
        }
      });
    return this.job;
  }

  private async run(): Promise<void> {
    await this.load();
    for (const source of await this.options.sources()) {
      if (this.found[source.id]?.from === source.file) continue;
      const model = this.options.model();
      if (!model || this.options.paused()) return;
      const picture = await source.read().catch(() => undefined);
      if (!picture) continue;
      const pictures = source.frames > 1 ? await stripFrames(picture, source.frames) : [picture];
      const points = [];
      for (const frame of pictures) {
        const { point, usd } = await findPoint(model, frame, source.kind === 'hands' ? HAND : GRIP);
        this.options.spend(usd, model);
        points.push(point ?? null);
      }
      this.found[source.id] = source.kind === 'hands'
        ? { from: source.file, hands: points }
        : { from: source.file, ...(points[0] ? { grip: points[0] } : {}) };
      await mkdir(this.options.artDir, { recursive: true });
      await writeFile(this.file, JSON.stringify(this.found, null, 2));
    }
  }
}
