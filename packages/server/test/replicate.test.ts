import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/api-log.ts';
import { AiServices } from '../src/ai/services.ts';
import type { ChatModel } from '../src/ai/chat.ts';
import { ProviderError } from '../src/assets/provider.ts';
import { MAX_DATA_URL_BYTES, ReplicateVideoProvider, replicateToken } from '../src/assets/replicate.ts';
import { videoUsd } from '../src/assets/video.ts';
import { refusal } from '../src/paint-queue.ts';
import { defaultSettings } from '../src/settings.ts';

interface Call { url: string; method: string; headers: Record<string, string>; body?: any }

/** A fake Replicate: answers each address from `routes`, keeping every request. */
function fakeReplicate(routes: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const call = { url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body };
    calls.push(call);
    return routes(call, calls.length);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const first = { mimeType: 'image/png', data: Buffer.from('png') };
const noWait = async () => {};

describe('ReplicateVideoProvider', () => {
  it('starts Wan by its name with prompt expansion off, waits for it and downloads the clip', async () => {
    let polls = 0;
    const { calls, fetchImpl } = fakeReplicate((call) => {
      if (call.url.endsWith('/v1/models/alibaba/wan-3/predictions')) return Response.json({ id: 'p1', status: 'starting' }, { status: 201 });
      if (call.url.endsWith('/v1/predictions/p1')) {
        return Response.json(++polls < 3 ? { id: 'p1', status: 'processing' } : { id: 'p1', status: 'succeeded', output: 'https://replicate.delivery/clip.mp4' });
      }
      return new Response(Buffer.from('mp4 bytes'), { headers: { 'content-type': 'video/mp4' } });
    });
    const provider = new ReplicateVideoProvider('r8_token', undefined, fetchImpl, noWait);
    const clip = await provider.generate({ prompt: 'walk', first, last: first, seconds: 8, negativePrompt: 'two swords', seed: 7, promptExpansion: true });

    expect(provider.model).toBe('alibaba/wan-3');
    expect(clip.data.toString()).toBe('mp4 bytes');
    expect(clip).toMatchObject({ seconds: 8, resolution: '720p', mimeType: 'video/mp4' });
    const start = calls[0]!;
    expect(start.method).toBe('POST');
    expect(start.headers.authorization).toBe('Bearer r8_token');
    expect(start.body.input).toEqual({
      prompt: 'walk',
      image: `data:image/png;base64,${Buffer.from('png').toString('base64')}`,
      resolution: '720p',
      duration: 8,
      enable_prompt_expansion: false,
      negative_prompt: 'two swords',
      seed: 7,
    });
    expect(polls).toBe(3);
    // The token is only ever sent to Replicate's API, never to the download host.
    expect(calls.at(-1)!.url).toBe('https://replicate.delivery/clip.mp4');
    expect(calls.at(-1)!.headers.authorization).toBeUndefined();
  });

  it('clamps the length to what Wan makes and keeps 480p and 1080p', async () => {
    const { calls, fetchImpl } = fakeReplicate((call) =>
      call.method === 'POST' ? Response.json({ id: 'p', status: 'succeeded', output: ['https://replicate.delivery/a.mp4'] }) : new Response('mp4'));
    const provider = new ReplicateVideoProvider('t', undefined, fetchImpl, noWait);
    expect(await provider.generate({ prompt: 'p', first, seconds: 1, resolution: '480p' })).toMatchObject({ seconds: 2, resolution: '480p' });
    expect(await provider.generate({ prompt: 'p', first, seconds: 99, resolution: '1080p' })).toMatchObject({ seconds: 30, resolution: '1080p' });
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.input.duration)).toEqual([2, 30]);
  });

  it('uploads a big first picture instead of sending it inline', async () => {
    const big = { mimeType: 'image/png', data: Buffer.alloc(MAX_DATA_URL_BYTES + 1) };
    const { calls, fetchImpl } = fakeReplicate((call) => {
      if (call.url.endsWith('/v1/files')) return Response.json({ urls: { get: 'https://api.replicate.com/v1/files/f1' } }, { status: 201 });
      if (call.method === 'POST') return Response.json({ id: 'p', status: 'succeeded', output: 'https://replicate.delivery/a.mp4' });
      return new Response('mp4');
    });
    await new ReplicateVideoProvider('t', undefined, fetchImpl, noWait).generate({ prompt: 'p', first: big, seconds: 4 });
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[1]!.body.input.image).toBe('https://api.replicate.com/v1/files/f1');
  });

  it('falls back to the general endpoint when the model is not run by name', async () => {
    const { calls, fetchImpl } = fakeReplicate((call) => {
      if (call.url.includes('/v1/models/')) return Response.json({ detail: 'Not found.' }, { status: 404 });
      if (call.method === 'POST') return Response.json({ id: 'p', status: 'succeeded', output: 'https://replicate.delivery/a.mp4' });
      return new Response('mp4');
    });
    await new ReplicateVideoProvider('t', 'someone/wan-fork', fetchImpl, noWait).generate({ prompt: 'p', first, seconds: 4 });
    expect(calls[1]!.url).toBe('https://api.replicate.com/v1/predictions');
    expect(calls[1]!.body.version).toBe('someone/wan-fork');
    expect(calls[1]!.body.input.enable_prompt_expansion).toBe(false);
  });

  it("passes on Replicate's words when a clip fails", async () => {
    const { fetchImpl } = fakeReplicate((call) =>
      call.method === 'POST' ? Response.json({ id: 'p', status: 'starting' }) : Response.json({ id: 'p', status: 'failed', error: 'NSFW content detected' }));
    await expect(new ReplicateVideoProvider('t', undefined, fetchImpl, noWait).generate({ prompt: 'p', first, seconds: 4 }))
      .rejects.toMatchObject({ provider: 'replicate', status: 502, said: 'NSFW content detected' });
  });

  it('turns a refusal for asking too often into a throttle the paint queue waits out', async () => {
    const { fetchImpl } = fakeReplicate(() => Response.json({ detail: 'Request was throttled.', retry_after: 6 }, { status: 429 }));
    const err = await new ReplicateVideoProvider('t', undefined, fetchImpl, noWait).generate({ prompt: 'p', first, seconds: 4 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.throttle).toEqual({ quotas: [], retryAfterMs: 6000 });
    expect(refusal(err, 'alibaba/wan-3')).toBe('minute');
  });

  it('prices Wan 3 by the second at each size', () => {
    const clip = (resolution: string) => ({ mimeType: 'video/mp4', data: Buffer.alloc(0), seconds: 8, resolution });
    expect(videoUsd('alibaba/wan-3', clip('480p'))).toBeCloseTo(0.4);
    expect(videoUsd('alibaba/wan-3', clip('720p'))).toBeCloseTo(0.8);
    expect(videoUsd('alibaba/wan-3', clip('1080p'))).toBeCloseTo(1.6);
  });
});

describe('Replicate token and choice', () => {
  it('reads REPLICATE_API_TOKEN, else REPLICATE_API_KEY', () => {
    expect(replicateToken({ REPLICATE_API_TOKEN: 'a', REPLICATE_API_KEY: 'b' })).toBe('a');
    expect(replicateToken({ REPLICATE_API_KEY: 'b' })).toBe('b');
    expect(replicateToken({ REPLICATE_API_TOKEN: ' ' })).toBeUndefined();
  });

  it('makes walk clips with Replicate when it is chosen and its key is set', () => {
    const settings = defaultSettings({});
    settings.ai.video = { provider: 'replicate', model: 'alibaba/wan-3' };
    const offline: ChatModel = { provider: 'offline', model: 'o', complete: async () => ({ text: '', inputTokens: 0, outputTokens: 0, usd: 0 }) };
    const make = (env: Record<string, string>) => new AiServices({ settings: () => settings, env, overBudget: () => false, offlineGod: offline, offlineCompiler: offline }).video();
    expect(make({})).toBeUndefined();
    expect(make({ REPLICATE_API_KEY: 'k' })).toMatchObject({ id: 'replicate', model: 'alibaba/wan-3' });
  });

  it('names Replicate calls in the API log', () => {
    expect(describeCall(new URL('https://api.replicate.com/v1/models/alibaba/wan-3/predictions'), {})).toEqual({ service: 'Replicate', kind: 'Video', model: 'alibaba/wan-3' });
    expect(describeCall(new URL('https://api.replicate.com/v1/predictions/p1'), undefined)).toMatchObject({ service: 'Replicate', kind: 'Video (checking)' });
    expect(describeCall(new URL('https://replicate.delivery/x/clip.mp4'), undefined)).toMatchObject({ kind: 'Video (download)' });
  });
});
