import { describe, expect, it } from 'vitest';
import { BIOMES, LAUNCH_BIOMES } from '../src/index.ts';

describe('biomes', () => {
  it('launches with the Sanctum plus the three chosen biomes', () => {
    expect(LAUNCH_BIOMES.map((b) => b.id).sort()).toEqual(
      ['mirage-desert', 'sanctum', 'sunlit-shore', 'whispering-woods'],
    );
  });

  it('gives every biome its own dominant hue', () => {
    const dominant = Object.values(BIOMES).map((b) => b.keyColors[0]);
    expect(new Set(dominant).size).toBe(dominant.length);
  });
});
