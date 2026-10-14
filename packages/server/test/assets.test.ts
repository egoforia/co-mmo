import { describe, expect, it } from 'vitest';
import { ANCHORS } from '../src/assets/anchors.ts';
import { GeminiImageProvider } from '../src/assets/gemini.ts';
import { ProviderError } from '../src/assets/provider.ts';
import { BASE_PROMPT, buildPrompt } from '../src/assets/style.ts';

describe('buildPrompt', () => {
  it('starts with the Style Bible base prompt and ends with what to avoid', () => {
    const prompt = buildPrompt(ANCHORS.find((a) => a.id === 'woods-mushroom')!);
    expect(prompt.startsWith(BASE_PROMPT)).toBe(true);
    expect(prompt).toContain('Biome: Whispering Woods');
    expect(prompt).toContain('Most recognisable feature: big floppy red-brown cap');
    expect(prompt.split('\n').at(-1)).toMatch(/^Avoid: photorealistic/);
  });

  it('asks tiles to be seamless', () => {
    expect(buildPrompt(ANCHORS.find((a) => a.kind === 'tile')!)).toContain('repeats seamlessly on all four edges');
  });
});

describe('anchors', () => {
  it('covers the Sanctum and every launch biome, with unique ids', () => {
    const ids = ANCHORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const biome of ['sanctum', 'whispering-woods', 'sunlit-shore', 'mirage-desert']) {
      expect(ANCHORS.filter((a) => a.biome === biome).length).toBeGreaterThanOrEqual(3);
    }
    expect(ids).toContain('item-bible');
    expect(ANCHORS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('GeminiImageProvider', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it('sends the prompt and references, and returns the image', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }],
      }));
    }) as unknown as typeof fetch;
    const provider = new GeminiImageProvider('key-123', 'test-model', fake);
    const image = await provider.generate({ prompt: 'a goat', references: [{ mimeType: 'image/png', data: png }] });
    expect(image.data.equals(png)).toBe(true);
    expect(sent!.url).toContain('/models/test-model:generateContent');
    expect((sent!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('key-123');
    const body = JSON.parse(sent!.init.body as string);
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('image/png');
    expect(body.contents[0].parts.at(-1).text).toBe('a goat');
  });

  it('reports blocked requests and API errors clearly', async () => {
    const blocked = (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))) as unknown as typeof fetch;
    await expect(new GeminiImageProvider('k', 'm', blocked).generate({ prompt: 'x' })).rejects.toThrow(/blocked \(SAFETY\)/);
    const denied = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })) as unknown as typeof fetch;
    await expect(new GeminiImageProvider('k', 'm', denied).generate({ prompt: 'x' })).rejects.toBeInstanceOf(ProviderError);
  });

  it('refuses to start without a key', () => {
    expect(() => new GeminiImageProvider('')).toThrow(/GEMINI_API_KEY/);
  });
});
