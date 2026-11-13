import { randomBytes } from 'node:crypto';
import type { Kept } from './kept.ts';

// Every picture and clip the server paints passes through here, so God's View
// can show what is waiting, what is being painted now, what came out and what
// failed, with what each cost. The log lives in memory, and each finished job
// is also kept in the database (kept.ts), so after a restart God's View still
// shows what was painted before it; unfinished work is asked again through
// the requests kept in PaintRequests.

/** Who asked for a painting. */
export type ArtJobSource = 'start-up' | 'gods-view' | 'wish';

/** Queued: in line behind other painting. Waiting: next, but held back by the model's rate limit. */
export type ArtJobStatus = 'queued' | 'waiting' | 'painting' | 'done' | 'failed' | 'skipped';

/** One picture or clip, from asking to done. */
export interface ArtJob {
  id: string;
  /** Art id of what is painted, such as `bramble-cottage-exterior` or `player-mara-walk-left`. */
  asset: string;
  /** What it is, in words: "Mara walking left". */
  label: string;
  /** A picture from the image model, a clip from the video model, or a sound effect or music. */
  media: 'picture' | 'clip' | 'sound';
  source: ArtJobSource;
  status: ArtJobStatus;
  /** About what it will cost, before it is painted. */
  estimateUsd: number;
  /** What it did cost, once painted. */
  usd?: number;
  /** Why it waits, failed or was skipped, in plain words. */
  reason?: string;
  /** HTTP or validation status code when failed (such as 422). */
  statusCode?: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
}

/** A job's handle for the code painting it. */
export interface ArtJobHandle {
  readonly job: ArtJob;
  start(): void;
  /** Held back by the model's rate limit, with why. */
  wait(reason: string): void;
  done(usd: number): void;
  fail(reason: string, statusCode?: number): void;
  skip(reason: string): void;
}

/** Jobs kept in the log; the oldest finished ones go first. */
const KEEP = 200;
/** Kind of the kept documents holding finished jobs, one per job. */
export const ART_JOBS = 'art-job';

/** The painting log God's View shows. */
export class ArtJobs {
  private readonly jobs: ArtJob[] = [];
  /** Told whenever a job changes, so God's View can refresh. */
  onChange?: () => void;

  private writing: Promise<void> = Promise.resolve();

  /** `kept` keeps finished jobs across a restart; without it the log lives in memory only. */
  constructor(private readonly now: () => number = Date.now, private readonly kept?: Kept) {}

  /** Brings back the finished jobs kept before a restart, older than anything logged since. */
  async restore(): Promise<void> {
    if (!this.kept) return;
    const known = new Set(this.jobs.map((j) => j.id));
    const old = (await this.kept.list<ArtJob>(ART_JOBS)).map((r) => r.data).filter((j) => !known.has(j.id)).sort((a, b) => a.queuedAt - b.queuedAt);
    this.jobs.unshift(...old);
    this.trim();
    if (old.length) this.onChange?.();
  }

  /** Resolves once every finished job is kept. */
  async flush(): Promise<void> {
    await this.writing;
  }

  /** Adds a job as waiting its turn. */
  add(asset: string, label: string, media: ArtJob['media'], source: ArtJobSource, estimateUsd: number): ArtJobHandle {
    const job: ArtJob = { id: randomBytes(5).toString('hex'), asset, label, media, source, status: 'queued', estimateUsd, queuedAt: this.now() };
    this.jobs.push(job);
    this.trim();
    const end = (status: ArtJobStatus, patch: Partial<ArtJob>) => {
      if (finished(job)) return;
      Object.assign(job, { status, endedAt: this.now(), ...patch });
      this.keep((kept) => kept.put(ART_JOBS, job.id, job));
      this.onChange?.();
    };
    this.onChange?.();
    return {
      job,
      start: () => {
        if (finished(job)) return;
        job.status = 'painting';
        job.startedAt = this.now();
        delete job.reason;
        this.onChange?.();
      },
      wait: (reason) => {
        if (finished(job) || (job.status === 'waiting' && job.reason === reason)) return;
        job.status = 'waiting';
        job.reason = reason;
        this.onChange?.();
      },
      done: (usd) => end('done', { usd }),
      fail: (reason, statusCode) => end('failed', { reason, ...(statusCode !== undefined ? { statusCode } : {}) }),
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
      const code = (err as { status?: number })?.status;
      handle.fail(plain(err), typeof code === 'number' ? code : undefined);
      throw err;
    }
  }

  /** Newest first. */
  list(): ArtJob[] {
    return [...this.jobs].reverse();
  }

  /** Jobs not finished yet. */
  open(): ArtJob[] {
    return this.jobs.filter((j) => !finished(j));
  }

  private trim(): void {
    while (this.jobs.length > KEEP) {
      const i = this.jobs.findIndex(finished);
      if (i < 0) return;
      const [gone] = this.jobs.splice(i, 1);
      this.keep((kept) => kept.delete(ART_JOBS, gone!.id));
    }
  }

  /** Writes to the database in order; the log carries on if a write fails. */
  private keep(step: (kept: Kept) => Promise<void>): void {
    const kept = this.kept;
    if (!kept) return;
    this.writing = this.writing.then(() => step(kept)).catch((err) => console.error('Keeping the painting log failed:', (err as Error).message));
  }
}

function finished(job: ArtJob): boolean {
  return job.status === 'done' || job.status === 'failed' || job.status === 'skipped';
}

/** An error as a sentence a person can read. */
export function plain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}
