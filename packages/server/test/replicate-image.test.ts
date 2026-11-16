import { describe, expect, it } from 'vitest';
import { imageProviderFor } from '../src/ai/services.ts';
import { REFERENCE_NOTE } from '../src/assets/gemini.ts';
import { ReplicateImageProvider, fitInput, isReplicateModel, readInputs } from '../src/assets/replicate-image.ts';
import { estimateImageUsd, imageUsd, knownImageModels } from '../src/assets/wish-art.ts';
import { limitFor } from '../src/paint-queue.ts';

interface Call { url: string; method: string; headers: Record<string, string>; body?: any }

function fakeReplicate(routes: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const call = { url: String(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body };
    calls.push(call);
    return routes(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

/** A schema shaped like openai/gpt-image-2's: sizes as "WxH", enums behind $refs. */
const gptSchema = {
  latest_version: {
    openapi_schema: {
      components: {
        schemas: {
          Input: {
            properties: {
              prompt: { type: 'string' },
              aspect_ratio: { allOf: [{ $ref: '#/components/schemas/aspect_ratio' }] },
              quality: { allOf: [{ $ref: '#/components/schemas/quality' }] },
              output_format: { allOf: [{ $ref: '#/components/schemas/output_format' }] },
              input_images: { type: 'array', maxItems: 2 },
            },
          },
          aspect_ratio: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
          quality: { type: 'string', enum: ['low', 'medium', 'high', 'auto'] },
          output_format: { type: 'string', enum: ['png', 'webp', 'jpeg'] },
        },
      },
    },
  },
};

/** A schema shaped like google/nano-banana-2's: ratios as "W:H", resolution "1K". */
const bananaSchema = {
  latest_version: {
    openapi_schema: {
      components: {
        schemas: {
          Input: {
            properties: {
              prompt: { type: 'string' },
              image_input: { type: 'array' },
              aspect_ratio: { type: 'string', enum: ['1:1', '3:2', '2:3', '16:9'] },
              resolution: { type: 'string', enum: ['1K', '2K', '4K'] },
            },
          },
        },
      },
    },
  },
};

const ref = { mimeType: 'image/png', data: Buffer.from('png') };

describe('Replicate image models', () => {
  it('knows a Replicate model by its owner/name', () => {
    expect(isReplicateModel('openai/gpt-image-2')).toBe(true);
    expect(isReplicateModel('owner/model:abc123')).toBe(true);
    expect(isReplicateModel('gemini-2.5-flash-image')).toBe(false);
    expect(isReplicateModel(undefined)).toBe(false);
  });

  it('fits a request to a gpt-image-2 style model: closest size, medium quality, references as a list', () => {
    const inputs = readInputs(gptSchema);
    const input = fitInput(inputs, { prompt: 'a lantern', aspectRatio: '3:2', references: [ref, ref, ref] }, ['a', 'b', 'c']);
    expect(input).toEqual({
      prompt: `${REFERENCE_NOTE}\na lantern`,
      aspect_ratio: '1536x1024',
      quality: 'medium',
      output_format: 'png',
      input_images: ['a', 'b'],
    });
  });

  it('fits a request to a nano-banana style model: ratio, resolution and image_input', () => {
    const inputs = readInputs(bananaSchema);
    const input = fitInput(inputs, { prompt: 'a crab', aspectRatio: '1:1', size: '2K', edit: true, references: [ref] }, ['a']);
    expect(input).toEqual({ prompt: 'a crab', aspect_ratio: '1:1', resolution: '2K', image_input: ['a'] });
  });

  it('reads the schema once, paints, and downloads without sending the token to the file host', async () => {
    const { calls, fetchImpl } = fakeReplicate((call) => {
      if (call.url.endsWith('/v1/models/openai/gpt-image-2')) return Response.json(gptSchema);
      if (call.url.endsWith('/v1/models/openai/gpt-image-2/predictions')) return Response.json({ id: 'p1', status: 'processing' }, { status: 201 });
      if (call.url.endsWith('/v1/predictions/p1')) return Response.json({ id: 'p1', status: 'succeeded', output: ['https://replicate.delivery/pic.png'] });
      return new Response(Buffer.from('picture'), { headers: { 'content-type': 'image/png' } });
    });
    const provider = new ReplicateImageProvider('r8_token', undefined, fetchImpl, async () => {});
    const a = await provider.generate({ prompt: 'one' });
    await provider.generate({ prompt: 'two' });

    expect(a).toEqual({ mimeType: 'image/png', data: Buffer.from('picture') });
    expect(calls.filter((c) => c.url.endsWith('/v1/models/openai/gpt-image-2'))).toHaveLength(1);
    const start = calls.find((c) => c.method === 'POST')!;
    expect(start.headers.authorization).toBe('Bearer r8_token');
    expect(start.headers.prefer).toBe('wait=60');
    expect(start.body.input).toMatchObject({ prompt: 'one', aspect_ratio: '1024x1024', quality: 'medium' });
    const download = calls.find((c) => c.url.startsWith('https://replicate.delivery'))!;
    expect(download.headers.authorization).toBeUndefined();
  });

  it('says plainly when a picture fails', async () => {
    const { fetchImpl } = fakeReplicate((call) => {
      if (call.method === 'GET') return Response.json(bananaSchema);
      return Response.json({ id: 'p2', status: 'failed', error: 'flagged as sensitive' }, { status: 201 });
    });
    const provider = new ReplicateImageProvider('r8_token', 'google/nano-banana-2', fetchImpl, async () => {});
    await expect(provider.generate({ prompt: 'x' })).rejects.toThrow(/flagged as sensitive/);
  });

  it('paints owner/name models on Replicate, whichever provider is chosen', () => {
    const env = { GEMINI_API_KEY: 'g', REPLICATE_API_TOKEN: 'r' };
    expect(imageProviderFor('gemini', 'openai/gpt-image-2', env)).toBeInstanceOf(ReplicateImageProvider);
    expect(imageProviderFor('replicate', '', env)?.model).toBe('openai/gpt-image-2');
    expect(imageProviderFor('gemini', 'gemini-2.5-flash-image', env)?.id).toBe('gemini');
    expect(imageProviderFor('replicate', 'openai/gpt-image-2', { GEMINI_API_KEY: 'g' })).toBeUndefined();
  });

  it('prices Replicate pictures per picture, and paces them to the account limit', () => {
    expect(estimateImageUsd('openai/gpt-image-2')).toBe(0.047);
    expect(imageUsd('openai/gpt-image-2', ref)).toBe(0.047);
    expect(estimateImageUsd('someone/new-model')).toBeGreaterThan(0);
    expect(knownImageModels()).toContain('openai/gpt-image-2');
    expect(limitFor('openai/gpt-image-2')).toMatchObject({ perMinute: 6 });
  });
});
