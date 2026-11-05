import { createHash } from 'node:crypto';
import { KeptDoc } from './kept-doc.ts';
import type { Kept } from './kept.ts';
import { resolve } from 'node:path';
import { isRetiredArt, type ArtPoint, type ArtPoints, type ArtPointsManifest } from '@co-mmo/shared';
import type { ChatModel } from './ai/chat.ts';
import { GRIP, HAND_QUESTIONS, HAND_VIEWS, POINTS_VERSION, findHands, findPoint, handSystem, mirroredHands, steadyHands, stripFrames, type BothHands, type Facing, type HandView } from './assets/points.ts';

// Held items (milestone 10): finds, once per picture, where a walker's two
// hands are in every frame and where each item is gripped, so the client can
// put a player's weapon or charm in their hand. A picture painted again is
// looked at again; a picture with no model to look at it shows no held item.

/** A picture to find points in. */
export interface PointSource {
  /** Its art id, as the client draws it. */
  id: string;
  /** A walker's picture or walk strip (its hand), or an item (its grip). */
  kind: 'hands' | 'grip';
  /** Which way a walker faces in it; a still picture faces us. */
  facing?: Facing;
  /** The file it is served from, with any version; a new one means look again. */
  file: string;
  /** A walk strip's frames side by side; a still picture has one. */
  frames: number;
  read: () => Promise<Buffer | undefined>;
}

export interface HandFinderOptions {
  artDir: string;
  /** Where the points and the Owner's questions are kept (the database); without it, files in artDir. */
  kept?: Kept;
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
  both?: BothHands[];
  /** The walk these hands were mirrored from, when they were not looked for in this one. */
  mirrored?: string;
}

/** One hand question, for a look's picture or one way of facing, as God's View shows and edits it. */
export interface HandQuestion {
  facing: HandView;
  /** The question asked now: the Owner's words, or the usual ones. */
  prompt: string;
  usual: string;
  own: boolean;
  /** The fixed part: the shape of the answer. */
  system: string;
}

/** What the hand finder is doing, as the Art tab shows it. */
export interface HandFinderStatus {
  running: boolean;
  /** Pictures looked at so far in this run, out of those it set out to look at. */
  done: number;
  total: number;
  /** The art id of the picture being looked at now. */
  looking?: string;
  /** When the last run that looked at anything ended, how many pictures it looked at, and in how many it found points. */
  last?: { at: number; looked: number; found: number };
  /** Why pictures are waiting and not being looked at, in plain words. */
  blocked?: string;
  /** Pictures with no points yet, or painted again since they were looked at. */
  waiting: number;
}

/** How long a count of waiting pictures is trusted before they are counted again. */
const COUNT_MS = 30_000;

/** Hands and grips found so far, kept on disk beside the painted art. */
export class HandFinder {
  private found: Record<string, Found> = {};
  private loaded?: Promise<void>;
  /** The run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;
  /** Asked again while running: run once more after, for pictures painted meanwhile. */
  private again = false;
  private progress: { done: number; total: number; looking?: string } = { done: 0, total: 0 };
  private last?: { at: number; looked: number; found: number };
  /** Pictures counted as waiting, and when they were counted. */
  private counted?: { at: number; waiting: number };

  constructor(private readonly options: HandFinderOptions) {}

  /** Hands and grips found so far. */
  private get points(): KeptDoc<Record<string, Found>> {
    return new KeptDoc(this.options.kept, 'art-hands', 'points', resolve(this.options.artDir, 'points.json'));
  }

  private load(): Promise<void> {
    this.loaded ??= this.points.read().then(
      // Points found in walks facing a retired way are dropped: nothing shows those walks any more.
      (saved) => void (saved && (this.found = Object.fromEntries(Object.entries(saved).filter(([id]) => !isRetiredArt(id))))),
      () => undefined,
    );
    return this.loaded;
  }

  /** Points by art id, for clients. */
  async manifest(): Promise<ArtPointsManifest> {
    await this.load();
    return Object.fromEntries(Object.entries(this.found).map(([id, { from: _from, both: _both, mirrored: _mirrored, ...points }]) => [id, points]));
  }

  /** Walks whose hands were mirrored from another walk, by art id: the walk they came from. */
  async mirrored(): Promise<Record<string, string>> {
    await this.load();
    return Object.fromEntries(Object.entries(this.found).flatMap(([id, f]) => (f.mirrored ? [[id, f.mirrored]] : [])));
  }

  /**
   * Gives one walk the hands found in another, mirrored: costs nothing, and
   * is kept until that walk is painted again or its hands are looked for
   * again. Optionally mirrors a single frame (`options.frame`) or one hand side.
   */
  async mirror(fromId: string, toId: string, options?: { frame?: number; fromFrame?: number; side?: 'both' | 'right' | 'left' }): Promise<void> {
    await this.load();
    const found = this.found[fromId];
    if (!found?.hands) throw new Error('No hands have been found in that animation yet, so there is nothing to mirror.');
    const target = (await this.options.sources()).find((s) => s.id === toId && s.kind === 'hands');
    const picture = await target?.read().catch(() => undefined);
    if (!target || !picture) throw new Error('That animation has not been painted yet.');
    const flippedR = mirroredHands(found.hands, target.frames);
    const flippedL = mirroredHands(found.leftHands, target.frames);
    const side = options?.side ?? 'both';
    if (options?.frame === undefined && side === 'both') {
      const both = flippedR.map((right, i) => ({ ...(right ? { right } : {}), ...(flippedL[i] ? { left: flippedL[i]! } : {}) }));
      this.found[toId] = { from: this.stamp(target, picture), hands: flippedR, ...(found.leftHands ? { leftHands: flippedL } : {}), both, mirrored: fromId };
    } else {
      const existing = this.found[toId];
      const hands = Array.from({ length: target.frames }, (_, i) => existing?.hands?.[i] ?? null);
      const leftHands = Array.from({ length: target.frames }, (_, i) => existing?.leftHands?.[i] ?? null);
      if (options?.frame !== undefined) {
        const f = options.frame;
        const srcF = options.fromFrame ?? f;
        if (f >= 0 && f < target.frames) {
          const srcR = found.hands[srcF] ? ([Math.round((1 - found.hands[srcF]![0]) * 1000) / 1000, found.hands[srcF]![1]] as ArtPoint) : null;
          const srcL = found.leftHands?.[srcF] ? ([Math.round((1 - found.leftHands[srcF]![0]) * 1000) / 1000, found.leftHands[srcF]![1]] as ArtPoint) : null;
          if (side === 'both' || side === 'right') hands[f] = srcR;
          if (side === 'both' || side === 'left') leftHands[f] = srcL;
        }
      } else {
        for (let i = 0; i < target.frames; i++) {
          if (side === 'both' || side === 'right') hands[i] = flippedR[i] ?? null;
          if (side === 'both' || side === 'left') leftHands[i] = flippedL[i] ?? null;
        }
      }
      const both = hands.map((right, i) => ({ ...(right ? { right } : {}), ...(leftHands[i] ? { left: leftHands[i]! } : {}) }));
      this.found[toId] = { from: this.stamp(target, picture), hands, leftHands, both, mirrored: fromId };
    }
    await this.points.write(this.found);
  }

  /**
   * Manually sets or clears hand coordinates (for a single frame or full strip)
   * or an item's grip point, stamping the current picture so automatic runs preserve it.
   */
  async setPoints(
    id: string,
    update: {
      frame?: number;
      right?: ArtPoint | null;
      left?: ArtPoint | null;
      hands?: (ArtPoint | null)[];
      leftHands?: (ArtPoint | null)[];
      grip?: ArtPoint | null;
    },
  ): Promise<void> {
    await this.load();
    const source = (await this.options.sources()).find((s) => s.id === id);
    const picture = await source?.read().catch(() => undefined);
    const from = source && picture ? this.stamp(source, picture) : (this.found[id]?.from ?? `${id}#manual#v${POINTS_VERSION}`);
    const clamp = (pt: ArtPoint | null | undefined): ArtPoint | null => {
      if (!pt || !Array.isArray(pt) || pt.length < 2) return null;
      const x = Number(pt[0]), y = Number(pt[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [Math.max(0, Math.min(1, Math.round(x * 1000) / 1000)), Math.max(0, Math.min(1, Math.round(y * 1000) / 1000))];
    };
    if (source?.kind === 'grip' || update.grip !== undefined) {
      const grip = clamp(update.grip);
      this.found[id] = { from, ...(grip ? { grip } : {}) };
    } else {
      const existing = this.found[id];
      const frames = source?.frames ?? Math.max(existing?.hands?.length ?? 1, update.hands?.length ?? 0, (update.frame ?? 0) + 1);
      const hands = Array.from({ length: frames }, (_, i) => existing?.hands?.[i] ?? null);
      const leftHands = Array.from({ length: frames }, (_, i) => existing?.leftHands?.[i] ?? null);
      if (Array.isArray(update.hands)) {
        for (let i = 0; i < frames; i++) hands[i] = clamp(update.hands[i]);
      }
      if (Array.isArray(update.leftHands)) {
        for (let i = 0; i < frames; i++) leftHands[i] = clamp(update.leftHands[i]);
      }
      if (update.frame !== undefined && update.frame >= 0 && update.frame < frames) {
        if ('right' in update) hands[update.frame] = clamp(update.right);
        if ('left' in update) leftHands[update.frame] = clamp(update.left);
      }
      const both = hands.map((right, i) => ({ ...(right ? { right } : {}), ...(leftHands[i] ? { left: leftHands[i]! } : {}) }));
      this.found[id] = { from, hands, leftHands, both };
    }
    await this.points.write(this.found);
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
    this.progress = { done: 0, total: 0 };
    let found = 0;
    try {
      const todo = await this.waiting();
      this.progress.total = todo.length;
      for (const { source, picture } of todo) {
        const model = this.options.model();
        if (!model || this.whyNot(model)) return;
        this.progress.looking = source.id;
        await this.look(source, picture, model);
        const points = this.found[source.id];
        if (points?.grip || points?.hands?.some(Boolean) || points?.leftHands?.some(Boolean)) found++;
        this.progress.done++;
        this.counted = { at: Date.now(), waiting: todo.length - this.progress.done };
      }
    } finally {
      if (this.progress.done) this.last = { at: Date.now(), looked: this.progress.done, found };
      this.progress = { done: 0, total: 0 };
    }
  }

  /** Every picture with no points yet, or painted again since, read and ready to look at. */
  private async waiting(): Promise<{ source: PointSource; picture: Buffer }[]> {
    await this.load();
    const todo: { source: PointSource; picture: Buffer }[] = [];
    for (const source of await this.options.sources()) {
      const picture = await source.read().catch(() => undefined);
      if (picture && this.found[source.id]?.from !== this.stamp(source, picture)) todo.push({ source, picture });
    }
    this.counted = { at: Date.now(), waiting: todo.length };
    return todo;
  }

  /** Why nothing can be looked at now, in words for the Owner; none when it can. */
  private whyNot(model: ChatModel | undefined): string | undefined {
    if (!model) return 'No judge model that can read pictures is set, so hands are not being found. Choose one on the AI models tab, under Judge.';
    if (this.options.paused()) return 'Spending is paused for now, so hands are not being found until it starts again.';
    return undefined;
  }

  /** What the hand finder is doing now, and how many pictures still wait for it. */
  async status(): Promise<HandFinderStatus> {
    // Counted again now and then while idle, for pictures painted since the last run.
    if (!this.job && (!this.counted || Date.now() - this.counted.at > COUNT_MS)) await this.waiting();
    const waiting = this.counted?.waiting ?? 0;
    const blocked = waiting ? this.whyNot(this.options.model()) : undefined;
    return {
      running: !!this.job,
      done: this.progress.done,
      total: this.progress.total,
      ...(this.job && this.progress.looking ? { looking: this.progress.looking } : {}),
      ...(this.last ? { last: this.last } : {}),
      ...(blocked ? { blocked } : {}),
      waiting,
    };
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
      const facing = source.facing ?? 'look';
      const kept = this.found[source.id];
      // One frame again keeps the others' answers, when they were found in this same picture.
      const both = only !== undefined && kept?.from === from && kept.both?.length === pictures.length ? [...kept.both] : [];
      const question = (await this.questions()).find((q) => q.facing === facing)!.prompt;
      for (const [i, frame] of pictures.entries()) {
        if (only !== undefined && only !== i && both[i]) continue;
        const { usd, ...hands } = await findHands(model, frame, facing, question);
        this.options.spend(usd, model);
        both[i] = hands;
      }
      const { right, left } = steadyHands(both);
      this.found[source.id] = { from, hands: right, leftHands: left, both };
    }
    await this.points.write(this.found);
  }

  /** The Owner's own words for the hand questions. */
  private get questionsDoc(): KeptDoc<Record<string, string>> {
    return new KeptDoc(this.options.kept, 'art-hands', 'questions', resolve(this.options.artDir, 'hand-questions.json'));
  }

  /** The question asked for a look's picture and each way of facing, with the usual words beside the Owner's. */
  async questions(): Promise<HandQuestion[]> {
    const own = await this.ownQuestions();
    return HAND_VIEWS.map((facing) => ({ facing, prompt: own[facing] ?? HAND_QUESTIONS[facing], usual: HAND_QUESTIONS[facing], own: !!own[facing], system: handSystem(facing) }));
  }

  /** Words the Owner's question for a look's picture or one way of facing; empty goes back to the usual words. Nothing is looked at again until asked. */
  async setQuestion(facing: HandView, prompt: string): Promise<void> {
    const own = await this.ownQuestions();
    const text = prompt.trim().slice(0, 2000);
    if (text && text !== HAND_QUESTIONS[facing]) own[facing] = text;
    else delete own[facing];
    await this.questionsDoc.write(own);
  }

  /**
   * The Owner's own words, by question. Saved before the top-down ways were
   * retired, a look's picture was asked the question for facing `front`, so
   * those words are kept for it; questions for the other retired ways are dropped.
   */
  private async ownQuestions(): Promise<Partial<Record<HandView, string>>> {
    const saved = (await this.questionsDoc.read().catch(() => undefined)) ?? {};
    const own: Partial<Record<HandView, string>> = {};
    for (const facing of HAND_VIEWS) {
      const words = saved[facing] ?? (facing === 'look' ? saved.front : undefined);
      if (typeof words === 'string' && words) own[facing] = words;
    }
    return own;
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
