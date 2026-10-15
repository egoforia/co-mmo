import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiVideoProvider } from '../src/assets/video.ts';
import { googleError, ProviderError } from '../src/assets/provider.ts';
import { DailyClips, MemoryPaintQueue, PaintStopped, limitFor, nextDailyReset, queuedVideo, refusal, type PaintTurnWatcher } from '../src/paint-queue.ts';
import { FilePaintRequests, type PaintRequest } from '../src/paint-requests.ts';
import { MemoryTurnLedger, SharedPaintQueue } from '../src/shared-paint-queue.ts';

type QueueOptions = ConstructorParameters<typeof MemoryPaintQueue>[0];
/** Both queues keep the same promises: the one for a single server, and the shared one (here on its in-memory ledger). */
const queues: [string, (options?: QueueOptions) => MemoryPaintQueue | SharedPaintQueue][] = [
  ['in memory', (options) => new MemoryPaintQueue(options)],
  ['shared', (options) => new SharedPaintQueue(new MemoryTurnLedger(), options)],
];

const veo = 'veo-3.1-lite-generate-preview';
const tooMany = (quotaId?: string, retryDelay?: string) => googleError('gemini', 429, {
  message: 'You exceeded your current quota, please check your plan and billing details.',
  details: [
    ...(quotaId ? [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] }] : []),
    ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
  ],
}, 'refused');

/** A painting-log job's story, as the queue tells it. */
const watcher = (): PaintTurnWatcher & { said: string[] } => ({
  said: [],
  wait(reason) { this.said.push(`wait: ${reason}`); },
  start() { this.said.push('start'); },
});

describe.each(queues)('the paint queue (%s)', (_name, makeQueue) => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 15, 12) }));
  afterEach(() => vi.useRealTimers());

  it('knows Veo takes two a minute, one at a time, and leaves unknown models alone', () => {
    expect(limitFor(veo)).toEqual({ perMinute: 2, atOnce: 1 });
    expect(limitFor('gemini-3.1-flash-image')).toMatchObject({ perMinute: 10 });
    expect(limitFor('fake-image')).toBeUndefined();
  });

  it('starts no more than a model allows a minute, and says why the rest wait', async () => {
    const queue = makeQueue();
    const started: number[] = [];
    const watchers = [watcher(), watcher(), watcher()];
    const done = watchers.map((w, i) => queue.turn(veo, async () => started.push(i), w));
    await vi.advanceTimersByTimeAsync(0);
    // One at a time: the second starts when the first is done, the third must wait for the minute.
    expect(started).toEqual([0, 1]);
    expect(watchers[2]!.said.at(-1)).toMatch(/takes 2 a minute/);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(started).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toEqual([0, 1, 2]);
    expect(watchers[2]!.said.at(-1)).toBe('start');
    await Promise.all(done);
  });

  it('keeps at most `atOnce` requests going', async () => {
    const queue = makeQueue({ limit: () => ({ perMinute: 100, atOnce: 2 }) });
    let going = 0;
    let most = 0;
    const call = async () => {
      most = Math.max(most, ++going);
      await new Promise((r) => setTimeout(r, 1000));
      going--;
    };
    const all = Promise.all(Array.from({ length: 5 }, () => queue.turn('m', call)));
    await vi.advanceTimersByTimeAsync(5000);
    await all;
    expect(most).toBe(2);
  });

  it('asks again after a per-minute refusal, waiting as long as Google says', async () => {
    const queue = makeQueue();
    let calls = 0;
    const w = watcher();
    const result = queue.turn(veo, async () => {
      if (++calls === 1) throw tooMany('GenerateRequestsPerMinutePerProjectPerModel', '42s');
      return 'clip';
    }, w);
    await vi.advanceTimersByTimeAsync(41_000);
    expect(calls).toBe(1);
    expect(w.said.at(-1)).toMatch(/slow down/);
    await vi.advanceTimersByTimeAsync(19_000);
    await expect(result).resolves.toBe('clip');
    expect(calls).toBe(2);
  });

  it('stops a model until the daily reset when its daily cap is used up', async () => {
    const queue = makeQueue();
    let calls = 0;
    const first = queue.turn(veo, async () => {
      calls++;
      throw tooMany('GenerateRequestsPerDayPerProjectPerModel');
    });
    await expect(first).rejects.toThrow(/daily limit for veo-3\.1-lite-generate-preview is used up/);
    // Later requests are refused at once, without asking Google.
    await expect(queue.turn(veo, async () => calls++)).rejects.toThrow(/daily limit/);
    expect(calls).toBe(1);
    expect(nextDailyReset(Date.UTC(2026, 9, 15, 12))).toBe(Date.UTC(2026, 9, 16, 8));
  });

  it('gives up after backing off when Google keeps refusing an image model without saying why', async () => {
    const queue = makeQueue({ backoffMs: [1000, 2000] });
    let calls = 0;
    const result = queue.turn('gemini-3.1-flash-image', async () => {
      calls++;
      throw tooMany();
    });
    const caught = result.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await caught).toMatch(/daily limit or the account's billing cap is likely used up/);
    expect(calls).toBe(3);
  });

  it("takes a Veo refusal that names no quota as the day's cap, and logs what Google said once", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = makeQueue();
    let calls = 0;
    const err = await queue.turn(veo, async () => {
      calls++;
      throw tooMany();
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaintStopped);
    expect(err.message).toMatch(/daily limit for veo-3\.1-lite-generate-preview is used up.*08:00 UTC.*You exceeded your current quota/);
    expect(calls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(`${veo} refused (429): "You exceeded your current quota, please check your plan and billing details." Quotas: none named. Retry after: none given.`);
    warn.mockRestore();
  });

  it("shows Google's words while a request waits out a refusal", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queue = makeQueue();
    let calls = 0;
    const w = watcher();
    const result = queue.turn(veo, async () => {
      if (++calls === 1) throw tooMany('GenerateRequestsPerMinutePerProjectPerModel', '42s');
      return 'clip';
    }, w);
    const behind = watcher();
    const second = queue.turn(veo, async () => 'second', behind);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.said.some((line) => /slow down \("You exceeded your current quota.*"\); asking again in 42 s/.test(line))).toBe(true);
    expect(behind.said.at(-1)).toMatch(/slow down \("You exceeded your current quota.*"\); waiting until 12:00 UTC/);
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(result).resolves.toBe('clip');
    await expect(second).resolves.toBe('second');
    vi.mocked(console.warn).mockRestore();
  });

  it('passes other errors straight through', async () => {
    const queue = makeQueue();
    await expect(queue.turn(veo, async () => {
      throw new ProviderError('gemini', 400, 'bad request');
    })).rejects.toThrow(/bad request/);
    expect(refusal(new ProviderError('gemini', 500, 'x'))).toBeUndefined();
    // A 429 while downloading a finished clip is not a refused start, so it is not asked again.
    expect(refusal(new ProviderError('gemini', 429, 'downloading the video failed'))).toBeUndefined();
  });

  it('refuses waiting requests when closed, so shutting down does not wait out the limits', async () => {
    const queue = makeQueue();
    const first = queue.turn(veo, async () => 'a');
    const second = queue.turn(veo, async () => 'b');
    const third = queue.turn(veo, async () => 'c');
    await vi.advanceTimersByTimeAsync(0);
    queue.close();
    await expect(first).resolves.toBe('a');
    await expect(second).resolves.toBe('b');
    await expect(third).rejects.toThrow(/shutting down/);
  });
});

describe('Veo refusals', () => {
  it('keep the quota Google named and how long it asked us to wait', async () => {
    const body = {
      error: {
        code: 429,
        message: 'You exceeded your current quota, please check your plan and billing details.',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' },
        ],
      },
    };
    const provider = new GeminiVideoProvider('key', veo, (async () => new Response(JSON.stringify(body), { status: 429 })) as typeof fetch);
    const err = await provider.generate({ prompt: 'walk', first: { mimeType: 'image/png', data: Buffer.alloc(1) }, seconds: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.throttle).toEqual({ quotas: ['GenerateRequestsPerMinutePerProjectPerModel'], retryAfterMs: 31_000 });
    expect(refusal(err)).toBe('minute');
    // The same refusal with no quota named is Veo's daily cap, but only for Veo.
    const bare = tooMany();
    expect(refusal(bare, veo)).toBe('day');
    expect(refusal(bare, 'gemini-3.1-flash-image')).toBe('minute');
  });
});

describe("the day's Veo clips", () => {
  const request = { prompt: 'walk', first: { mimeType: 'image/png', data: Buffer.alloc(1) }, seconds: 8 as const };
  const saved: number[] = [];
  let now = Date.UTC(2026, 9, 15, 20);
  const clips = (cap = 7) => new DailyClips({ cap: () => cap, madeSince: (_model, since) => saved.filter((t) => t >= since).length, now: () => now });

  beforeEach(() => {
    saved.length = 0;
    now = Date.UTC(2026, 9, 15, 20);
  });

  it("start from the saved clips made since Google's last reset", () => {
    // Two clips before today's 08:00 UTC reset and three after it.
    saved.push(Date.UTC(2026, 9, 15, 7), Date.UTC(2026, 9, 15, 7, 30), Date.UTC(2026, 9, 15, 9), Date.UTC(2026, 9, 15, 14), Date.UTC(2026, 9, 15, 14, 5));
    expect(clips().used(veo)).toEqual({ count: 3, cap: 7, resetsAt: Date.UTC(2026, 9, 16, 8) });
  });

  it('stop the video model at the cap without asking Google, and free it after the reset', async () => {
    const counter = clips(2);
    let asked = 0;
    const provider = queuedVideo(new MemoryPaintQueue({ limit: () => undefined }), {
      id: 'gemini', model: veo,
      generate: async () => {
        asked++;
        return { mimeType: 'video/mp4', data: Buffer.alloc(1), seconds: 8 };
      },
    }, counter);
    await provider.generate(request);
    await provider.generate(request);
    const err = await provider.generate(request).catch((e) => e);
    expect(err).toBeInstanceOf(PaintStopped);
    expect(err.message).toBe("Today's 2 veo-3.1-lite-generate-preview clips are used up (the daily limit on the AI models tab), so walks pick up after 08:00 UTC.");
    expect(asked).toBe(2);
    now = Date.UTC(2026, 9, 16, 8, 1);
    await provider.generate(request);
    expect(asked).toBe(3);
    expect(counter.used(veo).count).toBe(1);
  });

  it('count clips Google accepted even when they fail, but not a refused start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const counter = clips();
    await expect(counter.run(veo, async () => {
      throw new ProviderError('gemini', 502, 'the video failed');
    })).rejects.toThrow(/the video failed/);
    await expect(counter.run(veo, async () => {
      throw tooMany();
    })).rejects.toThrow(/quota/);
    expect(counter.used(veo).count).toBe(1);
    vi.mocked(console.warn).mockRestore();
  });

  it('let a cap of 0 turn walks off', () => {
    expect(() => clips(0).check(veo)).toThrow(PaintStopped);
  });
});

describe('paint requests kept across a restart', () => {
  it('are asked for again until they are done', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'co-mmo-requests-')), 'paint-requests.json');
    const asked: PaintRequest = { kind: 'repaint', asset: 'sanctum-rock', note: 'mossier' };
    await writeFile(path, JSON.stringify([asked]));
    const requests = new FilePaintRequests(path);
    let finish!: () => void;
    const resumed: PaintRequest[] = [];
    await requests.resume({
      repaint: (r) => {
        resumed.push(r);
        requests.hold(r, new Promise<void>((done) => (finish = done)));
      },
      wish: () => undefined,
      walk: () => undefined,
    });
    expect(resumed).toEqual([asked]);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([asked]);
    finish();
    await new Promise((r) => setTimeout(r, 20));
    await requests.close();
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([]);
  });
});
