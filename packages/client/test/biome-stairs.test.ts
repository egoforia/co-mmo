import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOMES, type BiomeId, type Stairway } from '@co-mmo/shared';
import { stairTexture, type TextureRegistry } from '../src/stair-art.ts';

const ART_DIR = resolve(__dirname, '../public/art');
const MANIFEST = require('../public/art/manifest.json');

function fakeScene(textures: string[]): TextureRegistry {
  const loaded = new Set(textures);
  return {
    textures: {
      exists: (key: string) => loaded.has(key),
    },
  };
}

const baseStairway: Stairway = {
  kind: 'stairs',
  x: 10,
  y: 10,
  width: 2,
  height: 1,
  lower: 0,
  upper: 1,
  bottom: { x: 10.5, y: 11.5 },
  top: { x: 10.5, y: 9.5 },
};

describe('biome stairs art resolution', () => {
  it('resolves biome-specific stairs for both up and down directions', () => {
    const scene = fakeScene([
      'stairs-sanctum-up',
      'stairs-sanctum-down',
      'stairs-frostpeak-up',
      'stairs-frostpeak-down',
      'stairs-up',
      'stairs-down',
    ]);

    expect(stairTexture(scene, 'sanctum', baseStairway, true)).toBe('stairs-sanctum-up');
    expect(stairTexture(scene, 'sanctum', baseStairway, false)).toBe('stairs-sanctum-down');

    expect(stairTexture(scene, 'frostpeak', baseStairway, true)).toBe('stairs-frostpeak-up');
    expect(stairTexture(scene, 'frostpeak', baseStairway, false)).toBe('stairs-frostpeak-down');
  });

  it('respects explicit art on the stairway object', () => {
    const scene = fakeScene(['custom-up', 'custom-down', 'stairs-sanctum-up', 'stairs-sanctum-down']);
    const customStairs: Stairway = {
      ...baseStairway,
      art: { up: 'custom-up', down: 'custom-down' },
    };

    expect(stairTexture(scene, 'sanctum', customStairs, true)).toBe('custom-up');
    expect(stairTexture(scene, 'sanctum', customStairs, false)).toBe('custom-down');
  });

  it('falls back to generic stairs when biome art is not loaded', () => {
    const scene = fakeScene(['stairs-up', 'stairs-down']);
    expect(stairTexture(scene, 'unknown-biome', baseStairway, true)).toBe('stairs-up');
    expect(stairTexture(scene, 'unknown-biome', baseStairway, false)).toBe('stairs-down');
  });

  it('handles ladders with biome or generic fallback', () => {
    const ladder: Stairway = { ...baseStairway, kind: 'ladder' };
    const scene = fakeScene(['ladder-up', 'ladder-down', 'ladder-frostpeak-up']);

    expect(stairTexture(scene, 'frostpeak', ladder, true)).toBe('ladder-frostpeak-up');
    expect(stairTexture(scene, 'frostpeak', ladder, false)).toBe('ladder-down');
    expect(stairTexture(scene, 'sanctum', ladder, true)).toBe('ladder-up');
  });
});

describe('all 10 biomes have published stairs in manifest and on disk', () => {
  const biomes = Object.keys(BIOMES) as BiomeId[];

  it('defines 10 distinct biomes', () => {
    expect(biomes.length).toBe(10);
  });

  for (const biome of biomes) {
    for (const dir of ['up', 'down'] as const) {
      const assetId = `stairs-${biome}-${dir}`;

      it(`has manifest entry for ${assetId}`, () => {
        const entry = MANIFEST[assetId];
        expect(entry, `Expected ${assetId} in manifest.json`).toBeDefined();
        expect(entry.kind).toBe('prop');
        expect(entry.width).toBe(256);
        expect(entry.height).toBe(256);
        expect(entry.file).toBe(`art/${assetId}.png`);
      });

      it(`has existing PNG file for ${assetId}`, () => {
        const filePath = resolve(ART_DIR, `${assetId}.png`);
        expect(existsSync(filePath), `Expected ${filePath} to exist on disk`).toBe(true);
      });
    }
  }
});
