import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BIOMES,
  SOUND_EFFECTS,
  MUSIC_SECONDS,
  effectPrompt,
  musicId,
  musicName,
  musicPrompt,
  type BiomeId,
  type SoundEntry,
  type SoundManifest,
} from '@co-mmo/shared';
import { finishEffect, finishMusic, type FinishedSound } from './assets/sound-finish.ts';
import { soundUsd, type SoundProvider } from './assets/sound.ts';
import { plain, type ArtJobHandle, type ArtJobSource, type ArtJobs } from './art-jobs.ts';
import { watched } from './paint-queue.ts';

// Sound effects and music are made by AI sound services from descriptions
// (SOUND_EFFECTS and MUSIC in packages/shared/src/sounds.ts), the way
// building art is painted from BUILDING_STYLES: whatever is missing is made
// when the server starts, and the Owner can have any of it made again from
// the Art tab. Every version is kept on disk, so a worse one can be undone.

/** Where made sounds are served from, under the wished-art directory. */
export const SOUND_PATH = 'wished-art/sounds';

/** A made sound, with the recipe that made it. */
export interface MadeSound extends SoundEntry {
  prompt: string;
  provider: string;
  model: string;
  usd: number;
  at: number;
}

/** One sound as the Art tab shows it. */
export interface SoundItem {
  id: string;
  name: string;
  kind: 'effect' | 'music';
  url?: string;
  /** What the service is asked for. */
  prompt: string;
  /** About what making it again costs. */
  estimateUsd: number;
  /** False when nothing can make it now, with why. */
  makeable: boolean;
  why?: string;
}

export interface SoundMakerOptions {
  /** The sound-effects service chosen in God's View, or undefined when there is none. */
  effects: () => SoundProvider | undefined;
  /** The music service chosen in God's View, or undefined when there is none. */
  music: () => SoundProvider | undefined;
  /** True while spending is paused: this month's budget is spent or today's cap is reached. */
  overBudget: () => boolean;
  /** Records what a sound cost. */
  spend: (usd: number, provider: SoundProvider) => void;
  /** The wished-art directory; sounds go in its sounds/ folder. */
  artDir: string;
  /** The painting log God's View shows. */
  jobs?: ArtJobs;
  /** Trims and levels a made sound; ffmpeg unless a test says otherwise. */
  finish?: { effect: (raw: Buffer) => Promise<FinishedSound>; music: (raw: Buffer) => Promise<FinishedSound> };
}

/** Something to make: an effect or a land's music. */
interface SoundJob {
  id: string;
  name: string;
  kind: 'effect' | 'music';
  prompt: string;
  seconds: number;
}

/** Every sound the game has, effects first, then the launch lands' music, then the rest. */
export function allSounds(): SoundJob[] {
  const effects = Object.values(SOUND_EFFECTS).map((e): SoundJob => ({ id: e.id, name: e.name, kind: 'effect', prompt: effectPrompt(e), seconds: e.seconds }));
  const lands = Object.values(BIOMES).sort((a, b) => Number(b.launch) - Number(a.launch));
  const music = lands.map((b): SoundJob => ({ id: musicId(b.id), name: musicName(b.id as BiomeId), kind: 'music', prompt: musicPrompt(b.id as BiomeId), seconds: MUSIC_SECONDS }));
  return [...effects, ...music];
}

/** Makes and keeps the game's sounds. */
export class SoundMaker {
  private made: Record<string, MadeSound> = {};
  private loaded = false;
  private saving: Promise<void> = Promise.resolve();
  /** The start-up run in progress, so shutdown and tests can wait for it. */
  job?: Promise<void>;
  /** Remakes the Owner asked for, so shutdown and tests can wait for them. */
  readonly pending = new Set<Promise<void>>();

  constructor(private readonly options: SoundMakerOptions) {}

  private get dir(): string {
    return resolve(this.options.artDir, 'sounds');
  }

  /** Every sound made so far, for clients. */
  async manifest(): Promise<SoundManifest> {
    await this.load();
    return Object.fromEntries(Object.entries(this.made).map(([id, s]) => [id, { file: s.file, kind: s.kind, seconds: s.seconds, ...(s.redone ? { redone: s.redone } : {}) }]));
  }

  /** Every sound, made or not, for the Art tab. */
  async list(): Promise<SoundItem[]> {
    await this.load();
    return allSounds().map((job) => {
      const provider = this.providerFor(job);
      const made = this.made[job.id];
      return {
        id: job.id,
        name: job.name,
        kind: job.kind,
        ...(made ? { url: `/${made.file}` } : {}),
        prompt: made?.prompt ?? job.prompt,
        estimateUsd: soundUsd(provider?.model ?? '', job),
        makeable: Boolean(provider),
        ...(provider ? {} : { why: missing(job.kind) }),
      };
    });
  }

  /** The models in use, for the Art tab. */
  models(): { effects: string | null; music: string | null } {
    return { effects: this.options.effects()?.model ?? null, music: this.options.music()?.model ?? null };
  }

  /** Makes whatever sounds are missing, effects and music side by side, while the budget allows. */
  start(): Promise<void> {
    this.job ??= this.run()
      .catch((err) => console.error('Making sounds stopped:', (err as Error).message))
      .finally(() => (this.job = undefined));
    return this.job;
  }

  private async run(): Promise<void> {
    await this.load();
    const missingJobs = allSounds().filter((job) => !this.made[job.id]);
    const kinds = (['effect', 'music'] as const).map((kind) => missingJobs.filter((j) => j.kind === kind));
    await Promise.all(kinds.map((jobs) => this.makeAll(jobs)));
  }

  /** Makes one kind of sound in turn; with no service set, says so once in the log rather than per sound. */
  private async makeAll(jobs: SoundJob[]): Promise<void> {
    if (!jobs.length) return;
    if (!this.providerFor(jobs[0]!)) {
      const kind = jobs[0]!.kind;
      this.options.jobs?.add(kind === 'music' ? 'music' : 'sound-effects', kind === 'music' ? `Music for ${jobs.length} lands` : `${jobs.length} sound effects`, 'sound', 'start-up', 0).skip(missing(kind));
      return;
    }
    const queued = jobs.map((job) => this.queueJob(job, 'start-up'));
    for (const [i, job] of jobs.entries()) {
      const provider = this.providerFor(job);
      if (!provider || this.options.overBudget()) {
        for (const left of queued.slice(i)) left?.skip(provider ? "Spending is paused: this month's budget or today's cap is used up." : missing(job.kind));
        return;
      }
      await this.make(job, provider, queued[i]).catch((err) => console.error(`Making ${job.id} failed:`, (err as Error).message));
    }
  }

  /** Puts a remake of one sound in the log, to run with `remake`. */
  queue(id: string, source: ArtJobSource): ArtJobHandle | undefined {
    const job = allSounds().find((j) => j.id === id);
    return job && this.queueJob(job, source);
  }

  /**
   * Makes one sound again at the Owner's request; `note` adds the Owner's own
   * words to the description. The old version stays on disk.
   */
  async remake(id: string, note = '', handle?: ArtJobHandle): Promise<void> {
    const job = allSounds().find((j) => j.id === id);
    if (!job) throw new Error('There is no sound by that name.');
    const provider = this.providerFor(job);
    if (!provider) throw new Error(missing(job.kind));
    await this.load();
    const run = this.make(note.trim() ? { ...job, prompt: `${job.prompt}\nAlso: ${note.trim()}` } : job, provider, handle, true);
    const held = run.catch(() => undefined);
    this.pending.add(held);
    void held.finally(() => this.pending.delete(held));
    await run;
  }

  private queueJob(job: SoundJob, source: ArtJobSource): ArtJobHandle | undefined {
    return this.options.jobs?.add(job.id, job.name, 'sound', source, soundUsd(this.providerFor(job)?.model ?? '', job));
  }

  private providerFor(job: SoundJob): SoundProvider | undefined {
    return job.kind === 'music' ? this.options.music() : this.options.effects();
  }

  private async make(job: SoundJob, provider: SoundProvider, handle?: ArtJobHandle, redone = false): Promise<void> {
    handle?.start();
    try {
      const raw = await watched(provider, handle).generate({ prompt: job.prompt, seconds: job.seconds });
      const usd = soundUsd(provider.model, raw);
      // Paid for once the service answers, even if finishing it fails.
      this.options.spend(usd, provider);
      const version = Date.now().toString(36);
      await mkdir(resolve(this.dir, 'raw'), { recursive: true });
      await writeFile(resolve(this.dir, 'raw', `${job.id}-${version}.mp3`), raw.data);
      const finish = this.options.finish ?? { effect: finishEffect, music: finishMusic };
      const done = await finish[job.kind](raw.data);
      const name = `${job.id}-${version}.mp3`;
      await writeFile(resolve(this.dir, name), done.data);
      this.made[job.id] = {
        file: `${SOUND_PATH}/${name}`, kind: job.kind, seconds: done.seconds,
        prompt: job.prompt, provider: provider.id, model: provider.model, usd, at: Date.now(),
        ...(redone ? { redone: Date.now() } : {}),
      };
      await this.save();
      handle?.done(usd);
    } catch (err) {
      handle?.fail(plain(err));
      throw err;
    }
  }

  /** Writes the manifest; effects and music finish side by side, so writes take turns. */
  private save(): Promise<void> {
    this.saving = this.saving.then(() => writeFile(resolve(this.dir, 'manifest.json'), JSON.stringify(this.made, null, 2)));
    return this.saving;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.made = JSON.parse(await readFile(resolve(this.dir, 'manifest.json'), 'utf8').catch(() => '{}')) as Record<string, MadeSound>;
    this.loaded = true;
  }
}

/** Why a kind of sound cannot be made, in plain words. */
function missing(kind: 'effect' | 'music'): string {
  return kind === 'music'
    ? "No music service is set. Choose one on the AI models tab; Google's Lyria uses the Gemini key."
    : 'No sound-effects service is set. Add ELEVENLABS_API_KEY to the server\'s environment and choose ElevenLabs on the AI models tab.';
}
