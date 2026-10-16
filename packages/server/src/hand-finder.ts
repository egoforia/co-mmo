import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ArtPoint, ArtPoints, ArtPointsManifest } from '@co-mmo/shared';
import type { ChatModel } from './ai/chat.ts';
import { GRIP, HAND_QUESTIONS, POINTS_VERSION, findPoint, findRightHand, handSystem, steadyHands, stripFrames, type Facing } from './assets/points.ts';

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
  /** Which way a walker faces in it; a still picture faces us. */
  facing?: 'front' | 'back' | 'left' | 'right';
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
  /** The file the points were found in, and a fingerprint of its pixels. */
  from: string;
  /** Both hands as answered, frame by frame, so one frame found again is set straight with the rest. */
  both?: { point?: ArtPoint; other?: ArtPoint }[];
}

/** One way of facing's hand question, as God's View shows and edits it. */
export interface HandQuestion {
  facing: Facing;
  /** The question asked now: the Owner's words, or the usual ones. */
  prompt: string;
  usual: string;
  own: boolean;
  /** The fixed part: the shape of the answer. */
  system: string;
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
    return Object.fromEntries(Object.entries(this.found).map(([id, { from: _from, both: _both, ...points }]) => [id, points]));
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
      const picture = await source.read().catch(() => undefined);
      if (!picture) continue;
      const from = this.stamp(source, picture);
      if (this.found[source.id]?.from === from) continue;
      const model = this.options.model();
      if (!model || this.options.paused()) return;
      await this.look(source, picture, model);
    }
  }

  /** The file and a fingerprint of its pixels: the same file name can hold a new picture (shipped art updated with the game). */
  private stamp(source: PointSource, picture: Buffer): string {
    return `${source.file}#${createHash('sha1').update(picture).digest('hex').slice(0, 12)}#v${POINTS_VERSION}`;
  }

  /** Looks at one picture's frames (all of them, or just `only`) and keeps what was found. */
  private async look(source: PointSource, picture: Buffer, model: ChatModel, only?: number): Promise<void> {
    const pictures = source.frames > 1 ? await stripFrames(picture, source.frames) : [picture];
    const from = this.stamp(source, picture);
    if (source.kind === 'grip') {
      const { point, usd } = await findPoint(model, pictures[0]!, GRIP);
      this.options.spend(usd, model);
      this.found[source.id] = { from, ...(point ? { grip: point } : {}) };
    } else {
      const facing = source.facing ?? 'front';
      const kept = this.found[source.id];
      // One frame again keeps the others' answers, when they were found in this same picture.
      const both = only !== undefined && kept?.from === from && kept.both?.length === pictures.length ? [...kept.both] : [];
      const question = (await this.questions()).find((q) => q.facing === facing)!.prompt;
      for (const [i, frame] of pictures.entries()) {
        if (only !== undefined && only !== i && both[i]) continue;
        const { point, other, usd } = await findRightHand(model, frame, facing, question);
        this.options.spend(usd, model);
        both[i] = { ...(point ? { point } : {}), ...(other ? { other } : {}) };
      }
      this.found[source.id] = { from, hands: steadyHands(facing, both), both };
    }
    await mkdir(this.options.artDir, { recursive: true });
    await writeFile(this.file, JSON.stringify(this.found, null, 2));
  }

  private get questionsFile(): string {
    return resolve(this.options.artDir, 'hand-questions.json');
  }

  /** The question asked for each way of facing, with the usual words beside the Owner's. */
  async questions(): Promise<HandQuestion[]> {
    const own = JSON.parse(await readFile(this.questionsFile, 'utf8').catch(() => '{}')) as Partial<Record<Facing, string>>;
    return (['front', 'right', 'back', 'left'] as const).map((facing) => ({ facing, prompt: own[facing] ?? HAND_QUESTIONS[facing], usual: HAND_QUESTIONS[facing], own: !!own[facing], system: handSystem(facing) }));
  }

  /** Words the Owner's question for one way of facing; empty goes back to the usual words. Nothing is looked at again until asked. */
  async setQuestion(facing: Facing, prompt: string): Promise<void> {
    const own = JSON.parse(await readFile(this.questionsFile, 'utf8').catch(() => '{}')) as Partial<Record<Facing, string>>;
    const text = prompt.trim().slice(0, 2000);
    if (text && text !== HAND_QUESTIONS[facing]) own[facing] = text;
    else delete own[facing];
    await mkdir(this.options.artDir, { recursive: true });
    await writeFile(this.questionsFile, JSON.stringify(own, null, 2));
  }

  /**
   * Looks again, now, at some pictures by art id: every frame, or with
   * `frame` only that one. Returns how many frames were looked at; refused,
   * in plain words, with no model that can see or while spending is paused.
   */
  async findAgain(ids: string[], frame?: number): Promise<number> {
    await this.load();
    const model = this.options.model();
    if (!model) throw new Error('No model that can see pictures is set, so hands cannot be found. Choose one on the AI models tab.');
    if (this.options.paused()) throw new Error('Spending is paused for now, so hands are not looked for.');
    let looked = 0;
    for (const source of (await this.options.sources()).filter((s) => ids.includes(s.id))) {
      const picture = await source.read().catch(() => undefined);
      if (!picture) continue;
      await this.look(source, picture, model, frame);
      looked += frame === undefined ? source.frames : 1;
    }
    return looked;
  }

}
