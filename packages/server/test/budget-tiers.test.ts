import { describe, expect, it } from 'vitest';
import { account, api, app, joined, start, wish } from './helpers.ts';

describe('the daily spending cap', () => {
  it('holds back painting once today\'s cap is reached, and paints what is missing when the cap is raised', async () => {
    const { base, store, ws, painter } = await start();
    const owner = account(store, 'Ego', 'owner');
    store.updateSettings({ ...store.settings, budget: { ...store.settings.budget, dailyUsd: 0.01 } });
    store.recordSpend({ at: Date.now(), usd: 0.02, kind: 'chat', provider: 'gemini', model: 'x', playerId: null });

    const { body: budget } = await api(base, '/api/admin/budget', owner.token);
    expect(budget).toMatchObject({ todayUsd: 0.02, dailyUsd: 0.01, overToday: true, over: false, paused: true, why: expect.stringMatching(/Today's spending cap/) });

    // The wish is granted, but its picture waits.
    const c = await joined(ws, owner.token);
    await wish(c, 'I wish for a red hat');
    await c.waitFor((m) => m.t === 'character' && (m as any).character.inventory.length > 1);
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(0);
    const refused = await api(base, '/api/admin/art/paint', owner.token, 'POST', { asset: 'sanctum-rock' });
    expect(refused.body.message).toMatch(/Today's spending cap is reached/);

    // Raising the cap paints what was held back.
    expect((await api(base, '/api/admin/budget', owner.token, 'PUT', { monthlyUsd: 70, warnUsd: 50, dailyUsd: 100 })).status).toBe(400);
    expect((await api(base, '/api/admin/budget', owner.token, 'PUT', { monthlyUsd: 70, warnUsd: 50, dailyUsd: 5 })).status).toBe(200);
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).calls).toBe(1);
    expect(store.content[0]!.art).toMatch(/^\/wished-art\//);
  });
});

describe('the AI models tab', () => {
  it('lists every key and model price, and saves a model for each kind of art, the video model and sound', async () => {
    const { base, store } = await start({ env: { GEMINI_API_KEY: 'g' }, realImages: true });
    const owner = account(store, 'Ego', 'owner');
    const { body } = await api(base, '/api/admin/ai', owner.token);
    expect(body.keys.map((k: any) => [k.name, k.set])).toEqual([['GEMINI_API_KEY', true], ['ANTHROPIC_API_KEY', false], ['OPENAI_API_KEY', false], ['ELEVENLABS_API_KEY', false]]);
    expect(body.catalog.image.map((m: any) => m.model)).toContain('gemini-3.1-flash-image');
    expect(body.catalog.video.find((m: any) => m.model === 'veo-3.1-lite-generate-preview').usd).toBeCloseTo(0.4);
    expect(body.ai.video).toEqual({ provider: 'gemini', model: 'veo-3.1-lite-generate-preview', dailyClips: 7 });
    expect(body.clipsToday.count).toBe(0);

    const saved = await api(base, '/api/admin/ai', owner.token, 'PUT', {
      ...body.ai,
      image: { provider: 'gemini', model: 'gemini-2.5-flash-image', uses: { buildings: 'gemini-3.1-flash-image', scenery: '', bogus: 'x' } },
      video: { provider: 'gemini', model: 'veo-3.1-fast-generate-preview', dailyClips: '10' },
    });
    expect(saved.status).toBe(200);
    expect(store.settings.ai.image).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash-image', uses: { buildings: 'gemini-3.1-flash-image' } });
    expect(app!.wishes.imageProvider('buildings')?.model).toBe('gemini-3.1-flash-image');
    expect(app!.wishes.imageProvider('scenery')?.model).toBe('gemini-2.5-flash-image');
    expect(app!.wishes.imageProvider()?.model).toBe('gemini-2.5-flash-image');
    expect(store.settings.ai.video).toEqual({ provider: 'gemini', model: 'veo-3.1-fast-generate-preview', dailyClips: 10 });
    const bad = await api(base, '/api/admin/ai', owner.token, 'PUT', { ...body.ai, video: { provider: 'gemini', model: 'veo-3.1-fast-generate-preview', dailyClips: -1 } });
    expect(bad.status).toBe(400);
    const { body: art } = await api(base, '/api/admin/art', owner.token);
    expect(art.videoModel).toBe('veo-3.1-fast-generate-preview');
  });
});
