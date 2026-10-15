import { randomBytes } from 'node:crypto';

// Every picture and clip the server paints passes through here, so God's View
// can show what is waiting, what is being painted now, what came out and what
// failed, with what each cost. The log lives in memory: after a restart it
// starts again with whatever start-up painting there is.

/** Who asked for a painting. */
export type ArtJobSource = 'start-up' | 'gods-view' | 'wish';

export type ArtJobStatus = 'queued' | 'painting' | 'done' | 'failed' | 'skipped';

/** One picture or clip, from asking to done. */
export interface ArtJob {
  id: string;
  /** Art id of what is painted, such as `bramble-cottage-exterior` or `player-mara-walk-left`. */
  asset: string;
  /** What it is, in words: "Mara walking left". */
  label: string;
  /** A picture from the image model or a clip from the video model. */
  media: 'picture' | 'clip';
  source: ArtJobSource;
  status: ArtJobStatus;
  /** About what it will cost, before it is painted. */
  estimateUsd: number;
  /** What it did cost, once painted. */
  usd?: number;
  /** Why it failed or was skipped, in plain words. */
  reason?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
}

/** A job's handle for the code painting it. */
export interface ArtJobHandle {
  readonly job: ArtJob;
  start(): void;
  done(usd: number): void;
  fail(reason: string): void;
  skip(reason: string): void;
}

/** Jobs kept in the log; the oldest finished ones go first. */
const KEEP = 200;

/** The painting log God's View shows. */
export class ArtJobs {
  private readonly jobs: ArtJob[] = [];
  /** Told whenever a job changes, so God's View can refresh. */
  onChange?: () => void;

  constructor(private readonly now: () => number = Date.now) {}

  /** Adds a job as waiting its turn. */
  add(asset: string, label: string, media: ArtJob['media'], source: ArtJobSource, estimateUsd: number): ArtJobHandle {
    const job: ArtJob = { id: randomBytes(5).toString('hex'), asset, label, media, source, status: 'queued', estimateUsd, queuedAt: this.now() };
    this.jobs.push(job);
    this.trim();
    const end = (status: ArtJobStatus, patch: Partial<ArtJob>) => {
      if (job.status === 'done' || job.status === 'failed' || job.status === 'skipped') return;
      Object.assign(job, { status, endedAt: this.now(), ...patch });
      this.onChange?.();
    };
    this.onChange?.();
    return {
      job,
      start: () => {
        job.status = 'painting';
        job.startedAt = this.now();
        this.onChange?.();
      },
      done: (usd) => end('done', { usd }),
      fail: (reason) => end('failed', { reason }),
      skip: (reason) => end('skipped', { reason }),
    };
  }

  /** Paints one thing under a job: started, then done with its cost or failed with the reason. */
  async run<T>(handle: ArtJobHandle, paint: () => Promise<{ value: T; usd: number }>): Promise<T> {
    handle.start();
    try {
      const { value, usd } = await paint();
      handle.done(usd);
      return value;
    } catch (err) {
      handle.fail(plain(err));
      throw err;
    }
  }

  /** Newest first. */
  list(): ArtJob[] {
    return [...this.jobs].reverse();
  }

  /** Jobs not finished yet. */
  open(): ArtJob[] {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'painting');
  }

  private trim(): void {
    while (this.jobs.length > KEEP) {
      const i = this.jobs.findIndex((j) => j.status !== 'queued' && j.status !== 'painting');
      if (i < 0) return;
      this.jobs.splice(i, 1);
    }
  }
}

/** An error as a sentence a person can read. */
export function plain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}
