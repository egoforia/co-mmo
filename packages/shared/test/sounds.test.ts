import { describe, expect, it } from 'vitest';
import { BIOMES, MUSIC, SOUND_EFFECTS, effectPrompt, musicId, musicName, musicPrompt } from '../src/index.ts';

describe('the sound list', () => {
  it('describes music for every land and a sensible effect for every event', () => {
    for (const biome of Object.keys(BIOMES) as (keyof typeof BIOMES)[]) {
      expect(MUSIC[biome].length).toBeGreaterThan(40);
      expect(musicPrompt(biome)).toMatch(/No vocals/);
      expect(musicId(biome)).toBe(`music-${biome}`);
    }
    expect(musicName('sanctum')).toBe('Music of the Sanctum');
    for (const [id, effect] of Object.entries(SOUND_EFFECTS)) {
      expect(effect.id).toBe(id);
      expect(effect.volume).toBeGreaterThan(0);
      expect(effect.volume).toBeLessThanOrEqual(1);
      expect(effect.seconds).toBeGreaterThanOrEqual(0.4);
      expect(effectPrompt(effect)).toMatch(/no music/);
    }
  });
});
