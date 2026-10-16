import { describe, expect, it } from 'vitest';
import { AiServices } from '../src/ai/services.ts';
import type { ChatModel } from '../src/ai/chat.ts';
import { Budget } from '../src/budget.ts';
import { defaultSettings, type Settings } from '../src/settings.ts';
import { Store } from '../src/store.ts';

const offline = (name: string): ChatModel => ({ provider: 'offline', model: name, complete: async () => ({ text: name, inputTokens: 0, outputTokens: 0, usd: 0 }) });

function services(settings: Settings, env: Record<string, string>, over = false) {
  const god = offline('god');
  const compiler = offline('compiler');
  return { god, compiler, ai: new AiServices({ settings: () => settings, env, overBudget: () => over, offlineGod: god, offlineCompiler: compiler }) };
}

describe('AiServices', () => {
  it('answers with the offline God and compiler alone once the month is spent', () => {
    const { ai, god, compiler } = services(defaultSettings({ GEMINI_API_KEY: 'g' }), { GEMINI_API_KEY: 'g' }, true);
    expect(ai.godModels()).toEqual([god]);
    expect(ai.compilerModels()).toEqual([compiler]);
  });

  it('puts the chosen God first and the offline God last, and skips a model without a key', () => {
    const settings = defaultSettings({ GEMINI_API_KEY: 'g' });
    settings.ai.fallback = { provider: 'anthropic', model: 'claude' };
    const { ai, god } = services(settings, { GEMINI_API_KEY: 'g' });
    const models = ai.godModels();
    expect(models.map((m) => m.provider)).toEqual(['gemini', 'offline']);
    expect(models.at(-1)).toBe(god);
  });

  it('picks the image model set for a kind of art, else the main one, and nothing without a key', () => {
    const settings = defaultSettings({ GEMINI_API_KEY: 'g' });
    settings.ai.image.uses = { buildings: 'gemini-3.1-flash-image' };
    expect(services(settings, { GEMINI_API_KEY: 'g' }).ai.image('buildings')?.model).toBe('gemini-3.1-flash-image');
    expect(services(settings, { GEMINI_API_KEY: 'g' }).ai.image('walks')?.model).toBe('gemini-2.5-flash-image');
    expect(services(settings, {}).ai.image('walks')).toBeUndefined();
  });

  it('offers video, effects and music only when their keys are set', () => {
    const settings = defaultSettings({});
    expect(services(settings, {}).ai.video()).toBeUndefined();
    expect(services(settings, {}).ai.effects()).toBeUndefined();
    const keyed = services(settings, { GEMINI_API_KEY: 'g', ELEVENLABS_API_KEY: 'e' }).ai;
    expect(keyed.video()?.model).toBe('veo-3.1-lite-generate-preview');
    expect(keyed.effects()?.id).toBe('elevenlabs');
    expect(keyed.music()?.model).toBe('lyria-3-clip-preview');
  });
});

describe('Budget', () => {
  it('pauses at the daily cap and records spending under the right kind', () => {
    const store = Store.memory();
    const at = Date.UTC(2026, 9, 16, 12);
    const budget = new Budget(store, () => at);
    store.updateSettings({ ...store.settings, budget: { monthlyUsd: 70, warnUsd: 50, dailyUsd: 1 } });
    expect(budget.paused()).toBe(false);
    budget.spend('image', { provider: 'gemini', model: 'gemini-2.5-flash-image' }, 1.2, 'p1');
    expect(budget.state()).toMatchObject({ todayUsd: 1.2, overToday: true, over: false, paused: true });
    expect(store.spendToday(at)).toEqual([{ at, usd: 1.2, kind: 'image', provider: 'gemini', model: 'gemini-2.5-flash-image', playerId: 'p1' }]);
  });
});
