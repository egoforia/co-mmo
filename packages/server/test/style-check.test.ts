import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { PicturedWish } from '@co-mmo/shared';
import { GeminiChat, type ChatModel, type ChatRequest } from '../src/ai/chat.ts';
import { freeChecks, judgePicture } from '../src/assets/style-check.ts';
import { removeKeyBackground } from '../src/assets/postprocess.ts';
import { reuseCandidates } from '../src/assets/reuse.ts';
import { account, api, app, joined, start, wish } from './helpers.ts';

/** A subject painted on magenta, cut out as the pipeline does. */
async function cutOut(subject: { w: number; h: number; left: number; top: number; colour: { r: number; g: number; b: number } }, background = { r: 255, g: 0, b: 255 }) {
  const raw = await sharp({ create: { width: 256, height: 256, channels: 3, background } })
    .composite([{ input: await sharp({ create: { width: subject.w, height: subject.h, channels: 3, background: subject.colour } }).png().toBuffer(), left: subject.left, top: subject.top }])
    .png()
    .toBuffer();
  return removeKeyBackground(raw);
}

/** A judge that answers from a script and keeps what it was asked. */
function fakeJudge(answers: { judge?: string[]; reuse?: string[] }): ChatModel & { asked: ChatRequest[] } {
  return {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    asked: [],
    async complete(request) {
      this.asked.push(request);
      const reuse = request.system.includes('existing sprite');
      const text = (reuse ? answers.reuse : answers.judge)?.shift() ?? (reuse ? '{"match": 0}' : '{"subject": true, "style": true, "problem": ""}');
      return { text, inputTokens: 1000, outputTokens: 20, usd: 0.001 };
    },
  };
}

const look = (name: string, colour: string, hook = 'a wide brim with a feather'): PicturedWish => ({
  kind: 'item', name, description: 'A hat.', itemKind: 'head', look: { hook, body: 'a soft felt hat', color: colour, mood: 'jaunty' },
} as PicturedWish);

describe('the free style checks', () => {
  it('pass a whole subject on a clean background', async () => {
    const { png, clean } = await cutOut({ w: 100, h: 120, left: 78, top: 70, colour: { r: 40, g: 90, b: 160 } });
    expect(await freeChecks(png, clean)).toEqual({ pass: true });
  });

  it('turn down a picture that is empty, cut off, neon, or not on plain magenta', async () => {
    const empty = await cutOut({ w: 4, h: 4, left: 120, top: 120, colour: { r: 40, g: 90, b: 160 } });
    expect((await freeChecks(empty.png, empty.clean)).why).toMatch(/nearly empty/);
    const cut = await cutOut({ w: 56, h: 60, left: 200, top: 70, colour: { r: 40, g: 90, b: 160 } });
    expect((await freeChecks(cut.png, cut.clean)).why).toMatch(/cut off/);
    const neon = await cutOut({ w: 100, h: 120, left: 78, top: 70, colour: { r: 0, g: 255, b: 10 } });
    expect((await freeChecks(neon.png, neon.clean)).why).toMatch(/neon/);
    // Scenery (here a green floor across the lower half) instead of a plain backdrop.
    const scenery = await cutOut({ w: 256, h: 128, left: 0, top: 128, colour: { r: 90, g: 140, b: 60 } });
    expect((await freeChecks(scenery.png, scenery.clean)).why).toMatch(/background/);
  });

  it('pass every approved anchor sprite', async () => {
    const dir = join(import.meta.dirname, '../../../assets/anchors/raw');
    for (const id of ['woods-mushroom', 'player-mara', 'item-tonic', 'shore-crab-knight', 'sanctum-pilgrim', 'desert-scarab']) {
      const { png, clean } = await removeKeyBackground(await readFile(join(dir, `${id}.png`)));
      expect(await freeChecks(png, clean), id).toEqual({ pass: true });
    }
  });
});

describe('the judge', () => {
  it('shows the model the anchors and the new picture, and says what is wrong in plain words', async () => {
    const judge = fakeJudge({ judge: ['{"subject": true, "style": false, "problem": "It looks like a 3D render."}'] });
    const picture = (await cutOut({ w: 100, h: 120, left: 78, top: 70, colour: { r: 40, g: 90, b: 160 } })).png;
    const verdict = await judgePicture(judge, picture, [picture, picture], 'Red Hat: a wide brim');
    expect(verdict).toEqual({ pass: false, why: 'it looks like a 3D render', usd: 0.001 });
    expect(judge.asked[0]!.messages[0]!.images).toHaveLength(3);
    expect(judge.asked[0]!.messages[0]!.content).toMatch(/Red Hat/);
  });

  it('passes the picture when the model cannot answer, so a wish always gets its art', async () => {
    const broken: ChatModel = { provider: 'gemini', model: 'x', complete: async () => { throw new Error('down'); } };
    const picture = (await cutOut({ w: 100, h: 120, left: 78, top: 70, colour: { r: 40, g: 90, b: 160 } })).png;
    expect(await judgePicture(broken, picture, [], 'a hat')).toEqual({ pass: true, usd: 0 });
  });

  it('sends pictures to Gemini as inline data before the words', async () => {
    let sent: any;
    const chat = new GeminiChat('key', 'gemini-3.8-flash', (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));
    }) as typeof fetch);
    await chat.complete({ system: 's', messages: [{ role: 'user', content: 'look', images: [{ mimeType: 'image/png', data: Buffer.from('png') }] }] });
    expect(sent.contents[0].parts).toEqual([{ inlineData: { mimeType: 'image/png', data: Buffer.from('png').toString('base64') } }, { text: 'look' }]);
  });
});

describe('reuse before painting', () => {
  it('finds pictures of the same kind of thing in a close colour, never a player\'s look', () => {
    const library = [
      { id: 'a', def: look('Red Feathered Hat', '#c03030') },
      { id: 'b', def: look('Blue Feathered Hat', '#3040c0') },
      { id: 'c', def: { ...look('Red Feathered Hat', '#c03030'), itemKind: 'weapon' } as PicturedWish },
    ];
    expect(reuseCandidates(look('Crimson Hat', '#b02828'), library).map((p) => p.id)).toEqual(['a']);
    expect(reuseCandidates({ ...look('Me', '#c03030'), kind: 'player' } as PicturedWish, library)).toEqual([]);
  });
});

describe('painting a wish with the style check', () => {
  it('paints again with what went wrong, and records the check', async () => {
    const judge = fakeJudge({ judge: ['{"subject": false, "style": true, "problem": "It shows a bucket, not a hat."}'] });
    const { store, ws, painter } = await start({ judge: () => judge });
    const owner = account(store, 'Ego', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a red hat');
    await c.waitFor((m) => m.t === 'character' && (m as any).character.inventory.length > 1);
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(2);
    expect((painter as any).prompts[1]).toMatch(/turned down because it shows a bucket, not a hat\. Paint it again/);
    const record = store.content.find((r) => r.definition?.kind === 'item')!;
    expect(record.artPrompts![record.id]).toMatchObject({ check: { pass: true, tries: 2 } });
    // The kept prompt is the wish's own, so painting again starts fresh.
    expect(record.artPrompts![record.id]!.prompt).not.toMatch(/turned down/);
    expect(store.spendToday(Date.now()).filter((s) => s.kind === 'chat' && s.model === 'gemini-3.8-flash')).toHaveLength(2);
  });

  it('keeps the best attempt after the retries, marks it on the Art tab and tells the Stewards', async () => {
    const no = '{"subject": true, "style": false, "problem": "flat vector art"}';
    const judge = fakeJudge({ judge: [no, no, no] });
    const { base, store, ws, painter } = await start({ judge: () => judge });
    const owner = account(store, 'Ego', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a red hat');
    await Promise.all([...app!.wishes.painting]);
    await c.waitFor((m) => m.t === 'notice' && /style check was not happy with the picture of .* after 3 tries: flat vector art/.test((m as any).text));
    expect((painter as any).calls).toBe(3);
    const record = store.content.find((r) => r.definition?.kind === 'item')!;
    expect(record.art).toMatch(/^\/wished-art\//);
    const { body } = await api(base, '/api/admin/art', owner.token);
    const item = body.items.find((i: any) => i.id === `${record.id}:${record.id}`);
    expect(item.check).toEqual({ pass: false, why: 'flat vector art', tries: 3 });
    // What made the kept attempt is kept for God's View too, with how the style check went.
    expect(item.recipe).toMatchObject({ steps: [{ media: 'picture', pictures: expect.any(Array) }], notes: [expect.stringMatching(/not happy after 3 tries/)] });

    // Painting it again is reviewed first: the prompt with the Owner's words, the model, and the retries that may follow.
    const review = await api(base, '/api/admin/art/review', owner.token, 'POST', { what: 'paint', asset: item.id, note: 'a taller crown' });
    expect(review.status).toBe(200);
    expect(review.body.parts[0].recipe.steps[0]).toMatchObject({ model: 'fake-image', prompt: expect.stringMatching(/Also: a taller crown$/) });
    expect(review.body.parts[0].recipe.notes.join(' ')).toMatch(/up to 2 more times/);
    expect((painter as any).calls).toBe(3);
  });

  it('shows an existing picture that fits a new wish instead of painting one', async () => {
    const judge = fakeJudge({ reuse: ['{"match": 1}'] });
    const { base, store, ws, painter, artDir } = await start({ judge: () => judge });
    const owner = account(store, 'Ego', 'owner');
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a red hat');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    await Promise.all([...app!.wishes.painting]);
    await wish(c, 'I wish for a red hat');
    await c.waitFor((m) => m.t === 'god' && m.say.includes('bag'));
    await Promise.all([...app!.wishes.painting]);
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(1);
    const [first, second] = store.content.filter((r) => r.definition?.kind === 'item');
    expect(second!.artPrompts![second!.id]).toMatchObject({ reused: { from: first!.id }, usd: 0.001 });
    expect(await readFile(join(artDir, `${second!.id}.png`))).toEqual(await readFile(join(artDir, `${first!.id}.png`)));
    const { body } = await api(base, '/api/admin/art', owner.token);
    expect(body.items.find((i: any) => i.id.startsWith(second!.id)).reused).toBe(first!.definition!.name);
  });

  it('is set on the AI models tab', async () => {
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const { body } = await api(base, '/api/admin/ai', owner.token);
    expect(body.ai.styleCheck).toEqual({ judge: null, retries: 2, reuse: true });
    const saved = await api(base, '/api/admin/ai', owner.token, 'PUT', { ...body.ai, styleCheck: { judge: { provider: 'offline', model: '' }, retries: 7, reuse: false } });
    expect(saved.status).toBe(200);
    expect(store.settings.ai.styleCheck).toEqual({ judge: { provider: 'offline', model: 'scripted' }, retries: 2, reuse: false });
  });
});
