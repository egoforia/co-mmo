import { ProviderError } from './assets/provider.ts';
import type { ImageProvider } from './assets/provider.ts';
import type { SoundProvider } from './assets/sound.ts';
import type { VideoProvider, VideoRequest } from './assets/video.ts';

// Every picture and clip the server asks for takes a turn here, so the image
// and video services are never asked faster than they allow. Google refuses
// a request over its limit with "You exceeded your current quota"; a refusal
// for asking too often is waited out and asked again, while a daily cap stops
// that model until Google resets it, since retrying cannot help.
//
// The queue lives in memory, which is enough for one server. Several servers
// sharing one key would need the turns kept somewhere shared (Redis): a class
// implementing PaintQueue can replace this one without touching the painters.

/** How often a model may be asked, and how many requests it may have going at once. */
export interface RateLimit {
  perMinute: number;
  atOnce: number;
}

/**
 * Limits for the models the game uses, by name prefix, first match wins.
 * Veo allows 2 requests a minute on this key; image models allow far more,
 * but painting a few at a time keeps a burst of wishes from tripping them.
 * Models not listed (test stand-ins, future providers) are not held back.
 */
export const MODEL_LIMITS: [prefix: string, limit: RateLimit][] = [
  ['veo-', { perMinute: 2, atOnce: 1 }],
  ['gemini-', { perMinute: 10, atOnce: 2 }],
  ['imagen-', { perMinute: 10, atOnce: 2 }],
  ['lyria-', { perMinute: 10, atOnce: 1 }],
  // ElevenLabs' free and starter plans take a few requests at a time.
  ['eleven_', { perMinute: 30, atOnce: 2 }],
];

/** A model's limit, or undefined when it has none. */
export function limitFor(model: string): RateLimit | undefined {
  return MODEL_LIMITS.find(([prefix]) => model.startsWith(prefix))?.[1];
}

/** What a request tells the painting log while it waits for its turn and once it starts. */
export interface PaintTurnWatcher {
  wait(reason: string): void;
  start(): void;
}

/** Turns at the image and video services; a shared (Redis) queue can replace the in-memory one. */
export interface PaintQueue {
  /** Runs `call` when `model` has a free turn, asking again after refusals for asking too often. */
  turn<T>(model: string, call: () => Promise<T>, watcher?: PaintTurnWatcher): Promise<T>;
  /** Refuses every waiting request and any new one, so the server can shut down without waiting out the limits. */
  close(): void;
}

/** How long to wait before asking again after each refusal that says nothing more; about 15 minutes in all. */
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000];

/** What kind of limit a refusal was. */
export type Refusal = 'minute' | 'day';

/**
 * Whether an error is the service refusing to start a request for asking too
 * much, and which limit. Only a refused start counts: asking again after a
 * clip was already made would pay for it twice.
 *
 * Google names the quota when it can. Veo's daily cap comes back with no
 * quota at all, just "You exceeded your current quota", which the per-minute
 * limit never does since the queue keeps Veo under it, so for Veo a refusal
 * that names nothing is the day's cap.
 */
export function refusal(err: unknown, model = ''): Refusal | undefined {
  if (!(err instanceof ProviderError) || err.status !== 429 || !err.throttle) return undefined;
  const { quotas } = err.throttle;
  if (quotas.some((q) => /PerDay/i.test(q))) return 'day';
  return quotas.length === 0 && model.startsWith('veo-') ? 'day' : 'minute';
}

/** Painting stopped for a limit that waiting a little cannot fix: refused at once, and painting picks up later. */
export class PaintStopped extends Error {}

/** One line for the server log about a refusal: the model, Google's words, the quotas and the wait it asked for, never the key. */
export function refusalLine(model: string, err: ProviderError): string {
  const quotas = err.throttle?.quotas.length ? err.throttle.quotas.join(', ') : 'none named';
  const wait = err.throttle?.retryAfterMs === undefined ? 'none given' : `${Math.ceil(err.throttle.retryAfterMs / 1000)} s`;
  return `${model} refused (${err.status}): "${err.said}" Quotas: ${quotas}. Retry after: ${wait}.`;
}

/** The next time Google's daily quotas reset: midnight Pacific time, taken as 08:00 UTC so it is never early. */
export function nextDailyReset(now: number): number {
  const reset = new Date(now);
  reset.setUTCHours(8, 0, 0, 0);
  if (reset.getTime() <= now) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime();
}

interface ModelTurns {
  /** When the requests of the last minute started. */
  started: number[];
  running: number;
  /** Requests waiting, first come first served. */
  waiting: { go: () => void; watcher?: PaintTurnWatcher }[];
  /** No request starts before this, after the service asked us to slow down. */
  pausedUntil: number;
  /** Set when the model's cap is used up: requests fail at once with this, until `pausedUntil`. */
  closed?: string;
  /** What Google said when it last refused, for the painting log. */
  said?: string;
  timer?: ReturnType<typeof setTimeout>;
}

/** The in-memory paint queue, for one server. */
export class MemoryPaintQueue implements PaintQueue {
  private readonly models = new Map<string, ModelTurns>();
  private readonly limit: (model: string) => RateLimit | undefined;
  private readonly now: () => number;
  private readonly backoff: number[];
  private stopped = false;

  constructor(options: { limit?: (model: string) => RateLimit | undefined; now?: () => number; backoffMs?: number[] } = {}) {
    this.limit = options.limit ?? limitFor;
    this.now = options.now ?? Date.now;
    this.backoff = options.backoffMs ?? BACKOFF_MS;
  }

  async turn<T>(model: string, call: () => Promise<T>, watcher?: PaintTurnWatcher): Promise<T> {
    if (!this.limit(model)) return call();
    for (let attempt = 0; ; attempt++) {
      await this.take(model, watcher);
      try {
        return await call();
      } catch (err) {
        const kind = refusal(err, model);
        if (!kind) throw err;
        const refused = err as ProviderError;
        // Each refusal is logged once, so the server's log shows what Google really said.
        console.warn(refusalLine(model, refused));
        const turns = this.turns(model);
        const now = this.now();
        turns.said = refused.said;
        if (kind === 'day') {
          turns.pausedUntil = nextDailyReset(now);
          turns.closed = `Google's daily limit for ${model} is used up, so nothing more is sent to it until it resets at ${clock(turns.pausedUntil)}. Google said: "${refused.said}"`;
          throw new PaintStopped(turns.closed);
        }
        if (attempt >= this.backoff.length) {
          // Asking again for a quarter of an hour did not help, so this is not the per-minute limit.
          turns.pausedUntil = now + 60 * 60_000;
          turns.closed = `Google kept refusing ${model} for ${minutes(this.backoff)} minutes, so its daily limit or the account's billing cap is likely used up. Nothing more is sent to it for an hour. Google said: "${refused.said}"`;
          throw new PaintStopped(turns.closed);
        }
        const wait = refused.throttle?.retryAfterMs ?? this.backoff[attempt]!;
        turns.pausedUntil = Math.max(turns.pausedUntil, now + wait);
        watcher?.wait(`Google asked us to slow down ("${refused.said}"); asking again in ${Math.ceil(wait / 1000)} s.`);
      } finally {
        this.release(model);
      }
    }
  }

  close(): void {
    this.stopped = true;
    for (const model of this.models.keys()) {
      this.shut(this.turns(model));
      this.pump(model);
    }
  }

  private turns(model: string): ModelTurns {
    let turns = this.models.get(model);
    if (!turns) this.models.set(model, (turns = { started: [], running: 0, waiting: [], pausedUntil: 0 }));
    if (this.stopped) this.shut(turns);
    return turns;
  }

  private shut(turns: ModelTurns): void {
    turns.pausedUntil = Infinity;
    turns.closed = 'The server is shutting down; this is asked for again when it is back.';
  }

  /** Waits for a turn at the back of the line. */
  private take(model: string, watcher?: PaintTurnWatcher): Promise<void> {
    const turns = this.turns(model);
    return new Promise<void>((go, refuse) => {
      // A model closed while this request waited refuses it too.
      turns.waiting.push({ watcher, go: () => (turns.closed ? refuse(new PaintStopped(turns.closed)) : go()) });
      this.pump(model);
    });
  }

  private release(model: string): void {
    this.turns(model).running--;
    this.pump(model);
  }

  /** Starts as many waiting requests as the limit allows, and tells the rest why they wait. */
  private pump(model: string): void {
    const turns = this.turns(model);
    const limit = this.limit(model)!;
    clearTimeout(turns.timer);
    turns.timer = undefined;
    while (turns.waiting.length) {
      const now = this.now();
      if (turns.closed && now >= turns.pausedUntil) turns.closed = undefined;
      // A closed model lets everyone through at once, to be refused.
      if (turns.closed) {
        turns.waiting.shift()!.go();
        continue;
      }
      turns.started = turns.started.filter((t) => t > now - 60_000);
      if (turns.running >= limit.atOnce) break;
      const free = Math.max(turns.pausedUntil, turns.started.length >= limit.perMinute ? turns.started[0]! + 60_000 : 0);
      if (free > now) {
        turns.timer = setTimeout(() => this.pump(model), free - now);
        turns.timer.unref?.();
        break;
      }
      turns.started.push(now);
      turns.running++;
      const next = turns.waiting.shift()!;
      next.watcher?.start();
      next.go();
    }
    for (const [i, w] of turns.waiting.entries()) w.watcher?.wait(this.why(model, i));
  }

  /** Why a model's waiting request waits, in plain words; `ahead` requests go before it. */
  private why(model: string, ahead: number): string {
    const turns = this.turns(model);
    const limit = this.limit(model)!;
    const line = ahead > 0 ? ` ${ahead} ahead of it.` : '';
    const said = turns.said ? ` ("${turns.said}")` : '';
    if (turns.pausedUntil > this.now()) return `Google asked us to slow down${said}; waiting until ${clock(turns.pausedUntil)}.${line}`;
    return `${model} takes ${limit.perMinute} a minute, ${limit.atOnce} at a time.${line}`;
  }
}

/** An image model whose requests take turns in the queue. */
export function queuedImages(queue: PaintQueue, provider: ImageProvider): ImageProvider & Watchable<ImageProvider> {
  const wrap = (watcher?: PaintTurnWatcher): ImageProvider & Watchable<ImageProvider> => ({
    id: provider.id,
    model: provider.model,
    generate: (request) => queue.turn(provider.model, () => provider.generate(request), watcher),
    watchedBy: (w) => wrap(w),
  });
  return wrap();
}

/**
 * A video model whose requests take turns in the queue and, given a daily
 * count, stop once today's clips are used up: checked before joining the
 * line, so nobody waits to be refused, and again at the turn.
 */
export function queuedVideo(queue: PaintQueue, provider: VideoProvider, clips?: DailyClips): VideoProvider & Watchable<VideoProvider> {
  const make = (request: VideoRequest) => (clips ? clips.run(provider.model, () => provider.generate(request)) : provider.generate(request));
  const wrap = (watcher?: PaintTurnWatcher): VideoProvider & Watchable<VideoProvider> => ({
    id: provider.id,
    model: provider.model,
    generate: async (request) => {
      clips?.check(provider.model);
      return queue.turn(provider.model, () => make(request), watcher);
    },
    watchedBy: (w) => wrap(w),
  });
  return wrap();
}

/** A sound or music model whose requests take turns in the queue. */
export function queuedSound(queue: PaintQueue, provider: SoundProvider): SoundProvider & Watchable<SoundProvider> {
  const wrap = (watcher?: PaintTurnWatcher): SoundProvider & Watchable<SoundProvider> => ({
    id: provider.id,
    model: provider.model,
    generate: (request) => queue.turn(provider.model, () => provider.generate(request), watcher),
    watchedBy: (w) => wrap(w),
  });
  return wrap();
}

/**
 * Counts each video model's clips since Google's daily reset and stops it at
 * the day's cap, so the game never learns of the cap from Google refusing.
 * A clip counts once Google accepts it, made or not; a refused start does not.
 * The count starts from the saved spending, so a restart keeps it.
 */
export class DailyClips {
  private readonly days = new Map<string, { since: number; count: number }>();
  private readonly now: () => number;

  constructor(private readonly options: {
    /** Clips a model may make a day. */
    cap: () => number;
    /** Clips the saved spending shows for a model from `since` on. */
    madeSince: (model: string, since: number) => number;
    now?: () => number;
  }) {
    this.now = options.now ?? Date.now;
  }

  /** Clips a model has started since the last reset, and the cap. */
  used(model: string): { count: number; cap: number; resetsAt: number } {
    const day = this.day(model);
    return { count: day.count, cap: this.options.cap(), resetsAt: day.since + DAY_MS };
  }

  /** Refuses at once when the model's clips for today are used up. */
  check(model: string): void {
    const { count, cap, resetsAt } = this.used(model);
    if (count >= cap) {
      throw new PaintStopped(`Today's ${cap} ${model} ${cap === 1 ? 'clip is' : 'clips are'} used up (the daily limit on the AI models tab), so walks pick up after ${clock(resetsAt)}.`);
    }
  }

  /** Makes one clip if today's cap allows, counting it. */
  async run<T>(model: string, call: () => Promise<T>): Promise<T> {
    this.check(model);
    const day = this.day(model);
    day.count++;
    try {
      return await call();
    } catch (err) {
      if (refusal(err, model)) day.count--;
      throw err;
    }
  }

  private day(model: string): { since: number; count: number } {
    const since = nextDailyReset(this.now()) - DAY_MS;
    let day = this.days.get(model);
    if (!day || day.since !== since) this.days.set(model, (day = { since, count: this.options.madeSince(model, since) }));
    return day;
  }
}

const DAY_MS = 24 * 60 * 60_000;

interface Watchable<P> {
  watchedBy(watcher: PaintTurnWatcher): P;
}

/**
 * The same model, telling a painting-log job when it waits and starts, so
 * God's View shows a held-back request as waiting rather than painting.
 */
export function watched<P extends ImageProvider | VideoProvider | SoundProvider>(provider: P, watcher: PaintTurnWatcher | undefined): P {
  const watchable = provider as P & Partial<Watchable<P>>;
  return watcher && watchable.watchedBy ? watchable.watchedBy(watcher) : provider;
}

function minutes(backoff: number[]): number {
  return Math.round(backoff.reduce((a, b) => a + b, 0) / 60_000);
}

/** A time of day, as the server's clock reads it. */
function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 16) + ' UTC';
}
