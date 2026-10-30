import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CREATURE_HEIGHTS, ECHO_ART, EFFECT_ARTS, HALLOWED_ART, HAWK_SKILL, ISO_WAYS, RACES, RACE_IDS, SAND_DOUBLE_ART, SPIRIT_HAWK_ART, STATUSES, TRAP_ART, statusArt, walkArt, type StatusId } from '@co-mmo/shared';
import { ANCHORS } from '../src/assets/anchors.ts';
import { GeminiImageProvider } from '../src/assets/gemini.ts';
import { ProviderError } from '../src/assets/provider.ts';
import { BASE_PROMPT, buildPrompt } from '../src/assets/style.ts';
import { artRequest, fitCharacter, referencesFor } from '../src/assets/wish-art.ts';
import type { RegionState } from '../src/region/state.ts';
import { worldMarks } from '../src/region/world-marks.ts';

describe('buildPrompt', () => {
  it('starts with the Style Bible base prompt and ends with what to avoid', () => {
    const prompt = buildPrompt(ANCHORS.find((a) => a.id === 'woods-mushroom')!);
    expect(prompt.startsWith(BASE_PROMPT)).toBe(true);
    expect(prompt).toContain('Biome: Whispering Woods');
    expect(prompt).toContain('Most recognisable feature: big floppy red-brown cap');
    expect(prompt.split('\n').at(-1)).toMatch(/^Avoid: photorealistic/);
  });

  it('keeps one full stop after details written as sentences', () => {
    const prompt = buildPrompt({ ...ANCHORS.find((a) => a.id === 'woods-mushroom')!, details: ['It glows at dusk.', 'Smells of rain!'] });
    expect(prompt).toContain('Details: It glows at dusk; Smells of rain.');
    expect(prompt).not.toContain('..');
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

describe('wished art requests', () => {
  const look = { hook: 'a paper lantern', body: 'a round moth', color: '#e8c66a', mood: 'sleepy' };

  it("sends a creature's or person's own biome anchor first", () => {
    expect(referencesFor('creature', 'mirage-desert')).toEqual(['desert-scarab', 'woods-mushroom']);
    expect(referencesFor('creature', 'whispering-woods')).toEqual(['woods-mushroom', 'shore-crab-knight']);
    expect(referencesFor('npc', 'sunlit-shore')).toEqual(['shore-trader', 'sanctum-pilgrim']);
    expect(referencesFor('creature', 'frostpeak')).toEqual(['woods-mushroom', 'shore-crab-knight']);
    expect(referencesFor('item', 'mirage-desert')).toEqual(['item-tonic', 'item-goat-horn']);
  });

  it("sends a player's people's body first, and nothing new for a look without a people", () => {
    expect(referencesFor('player', 'sanctum', 'ursine')).toEqual(['bramble-ursine', 'player-mara']);
    expect(referencesFor('player', 'sanctum')).toEqual(['player-mara', 'player-ilya']);
    const lutran = artRequest({ kind: 'player', name: 'Pip', description: 'A sailor in a striped shirt.', race: 'lutran', look }, 'sunlit-shore');
    expect(lutran.references).toEqual(['tide-lutran', 'player-mara']);
    expect(lutran.prompt).toContain('one of the Lutran, otterfolk');
  });

  it("paints each people's body from an approved anchor with walks in all four isometric ways", async () => {
    const shipped = JSON.parse(await readFile(new URL('../../client/public/art/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    for (const race of RACE_IDS) {
      const body = RACES[race].body;
      expect(ANCHORS.find((a) => a.id === body), body).toBeTruthy();
      expect(shipped[body], body).toBeTruthy();
      for (const way of ISO_WAYS) expect(shipped[walkArt(body, way)], `${body} ${way}`).toBeTruthy();
    }
  });

  it('builds the prompt from the Style Bible and the wish, with the biome for living things', () => {
    const req = artRequest({ kind: 'creature', name: 'Lantern Moth', description: 'It carries a lantern.', behavior: 'wander', level: 1, count: 3, look }, 'whispering-woods');
    expect(req.prompt.startsWith(BASE_PROMPT)).toBe(true);
    expect(req.prompt).toContain('Biome: Whispering Woods');
    expect(req.prompt).toContain('Subject: Lantern Moth (monster). Most recognisable feature: a paper lantern.');
    expect(req.box).toEqual({ width: 128, height: 128 });
  });
});

describe('skill pictures (build plan step 10)', () => {
  it('has an anchor for every skill effect, every status icon, the spirit hawk and the Sandstorm double', () => {
    const ids = new Map(ANCHORS.map((a) => [a.id, a]));
    for (const id of [...EFFECT_ARTS, ...(Object.keys(STATUSES) as StatusId[]).map(statusArt)]) expect(ids.get(id)?.kind, id).toBe('effect');
    expect(ids.get(SPIRIT_HAWK_ART)).toMatchObject({ kind: 'monster', tier: 'small' });
    expect(ids.get(SAND_DOUBLE_ART)).toMatchObject({ kind: 'monster', tier: 'medium' });
    expect(ids.size).toBe(ANCHORS.length);
  });

  it('fits a creature to its height tier, feet on the bottom row', async () => {
    const sharp = (await import('sharp')).default;
    const raw = await sharp({ create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 300, channels: 4, background: { r: 200, g: 100, b: 50, alpha: 1 } } }).png().toBuffer(), left: 100, top: 50 }])
      .png().toBuffer();
    const fitted = await fitCharacter(raw, { width: 128, height: CREATURE_HEIGHTS.small }, CREATURE_HEIGHTS.small);
    const trimmed = await sharp(fitted).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    expect(trimmed.info.height).toBe(CREATURE_HEIGHTS.small);
    expect((await sharp(fitted).metadata()).height).toBe(CREATURE_HEIGHTS.small);
  });
});

describe('what skills leave in the world', () => {
  it('shows traps, hallowed ground, a sand double, the spirit hawk beside its friend, and Echoes on friends, until they go', () => {
    const now = 1000;
    const player = (id: string, x: number, y: number, gauge?: unknown) => [id, { info: { id }, x, y, floor: 0, gauge }];
    const s = {
      traps: [{ owner: 'a', ability: 'snare', x: 1, y: 2, floor: 0, until: now + 5 }, { owner: 'a', ability: 'snare', x: 9, y: 9, floor: 0, until: now - 1 }],
      zones: [{ owner: 'b', x: 3, y: 3, floor: 1, until: now + 5 }],
      doubles: [{ owner: 'a', x: 4, y: 4, floor: 0, until: now + 5 }],
      helpers: [{ owner: 'a', ability: HAWK_SKILL, until: now + 5 }, { owner: 'a', ability: 'wished-wolf', until: now + 5 }],
      players: new Map([player('a', 10, 10), player('b', 20, 20, { echoes: [{ on: 'a', amount: 3, until: now + 5 }] })] as never),
    } as unknown as RegionState;
    const marks = worldMarks(s, now);
    expect(marks.map((m) => m.asset).sort()).toEqual([ECHO_ART, HALLOWED_ART, SAND_DOUBLE_ART, SPIRIT_HAWK_ART, TRAP_ART].sort());
    expect(marks.find((m) => m.asset === ECHO_ART)).toMatchObject({ x: 10, y: 10 });
    expect(marks.find((m) => m.asset === HALLOWED_ART)).toMatchObject({ floor: 1 });
  });
});
