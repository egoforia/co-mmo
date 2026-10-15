import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import { googleError } from '../src/assets/provider.ts';
import { MemoryTurnLedger, RedisTurnLedger, SharedPaintQueue, type TurnLedger } from '../src/shared-paint-queue.ts';

const veo = 'veo-3.1-lite-generate-preview';
const dailyCap = () => googleError('gemini', 429, {
  message: 'You exceeded your current quota, please check your plan and billing details.',
  details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }],
}, 'refused');

describe('the shared paint queue', () => {
  beforeEach(() => vi.useFakeTimers({ now: Date.UTC(2026, 9, 15, 12) }));
  afterEach(() => vi.useRealTimers());

  it("keeps a model stopped for the day after a restart, until Google's reset", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = new MemoryTurnLedger();
    let calls = 0;
    await expect(new SharedPaintQueue(ledger).turn(veo, async () => {
      calls++;
      throw dailyCap();
    })).rejects.toThrow(/daily limit/);

    // The server restarts: a new queue on the same ledger refuses without asking Google.
    const after = new SharedPaintQueue(ledger);
    await expect(after.turn(veo, async () => calls++)).rejects.toThrow(/daily limit.*08:00 UTC/);
    expect(calls).toBe(1);

    // After 08:00 UTC the model is asked again.
    vi.setSystemTime(Date.UTC(2026, 9, 16, 8, 1));
    await expect(after.turn(veo, async () => 'clip')).resolves.toBe('clip');
    vi.mocked(console.warn).mockRestore();
  });

  it("shares one model's limit between servers", async () => {
    const ledger = new MemoryTurnLedger();
    const servers = [new SharedPaintQueue(ledger), new SharedPaintQueue(ledger)];
    const started: number[] = [];
    const all = [0, 1, 2].map((i) => servers[i % 2]!.turn(veo, async () => started.push(i)));
    await vi.advanceTimersByTimeAsync(2_000);
    // Veo takes two a minute, whichever server asks.
    expect(started).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toHaveLength(3);
    await Promise.all(all);
  });

  it('lets the turn of a server that died lapse', async () => {
    const ledger = new MemoryTurnLedger();
    const limit = { perMinute: 100, atOnce: 1 };
    const now = Date.now();
    // A turn taken and never released, as by a server that crashed mid-clip.
    expect(await ledger.claim('m', limit, 'dead', 60_000, now)).toEqual({ ok: true });
    expect(await ledger.claim('m', limit, 'b', 60_000, now + 1000)).toMatchObject({ ok: false });
    expect(await ledger.claim('m', limit, 'b', 60_000, now + 60_001)).toEqual({ ok: true });
  });
});

// The same ledger promises against a real Redis, when TEST_REDIS_URL names one (it is emptied).
const url = process.env.TEST_REDIS_URL;
describe.skipIf(!url)('the paint ledger in Redis', () => {
  const redis = url ? new Redis(url) : undefined;
  const ledgers: TurnLedger[] = [];
  const ledger = (): TurnLedger => {
    const l = new RedisTurnLedger(redis!.duplicate(), 'co-mmo-test:paint:');
    ledgers.push(l);
    return l;
  };
  beforeEach(async () => {
    const keys = await redis!.keys('co-mmo-test:*');
    if (keys.length) await redis!.del(...keys);
  });
  afterAll(async () => {
    await Promise.all(ledgers.map((l) => l.close()));
    await redis?.quit();
  });

  it('counts turns a minute and at once, across connections', async () => {
    const [a, b] = [ledger(), ledger()];
    const limit = { perMinute: 2, atOnce: 1 };
    const now = Date.now();
    expect(await a.claim(veo, limit, 'one', 60_000, now)).toEqual({ ok: true });
    expect(await b.claim(veo, limit, 'two', 60_000, now)).toEqual({ ok: false, waitMs: 1000 });
    await a.release(veo, 'one');
    expect(await b.claim(veo, limit, 'two', 60_000, now + 10)).toEqual({ ok: true });
    await b.release(veo, 'two');
    const third = await a.claim(veo, limit, 'three', 60_000, now + 20);
    expect(third).toEqual({ ok: false, waitMs: 59_980 });
  });

  it('keeps a pause, with its reason, for every server', async () => {
    const [a, b] = [ledger(), ledger()];
    const now = Date.now();
    await a.pause(veo, { until: now + 5_000, closed: 'Stopped for the day.', said: 'quota' }, now);
    expect(await b.claim(veo, { perMinute: 2, atOnce: 1 }, 'x', 60_000, now)).toMatchObject({ ok: false, pause: { closed: 'Stopped for the day.' } });
    expect(await b.paused(veo, now)).toMatchObject({ said: 'quota' });
  });

  it('runs a queue end to end', async () => {
    const queue = new SharedPaintQueue(ledger(), { limit: () => ({ perMinute: 10, atOnce: 2 }) });
    const results = await Promise.all([1, 2, 3].map((i) => queue.turn('m', async () => i)));
    expect(results).toEqual([1, 2, 3]);
  });
});
