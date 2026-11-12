import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOMES, stairHeading, type BiomeId, type Heading, type Stairway } from '@co-mmo/shared';
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
  it('resolves 4-sided directional stairs for north, south, east, and west', () => {
    const scene = fakeScene([
      'stairs-sanctum-north-up',
      'stairs-sanctum-north-down',
      'stairs-sanctum-south-up',
      'stairs-sanctum-south-down',
      'stairs-sanctum-east-up',
      'stairs-sanctum-east-down',
      'stairs-sanctum-west-up',
      'stairs-sanctum-west-down',
      'stairs-sanctum-up',
      'stairs-sanctum-down',
      'stairs-up',
      'stairs-down',
    ]);

    const headings: Heading[] = ['north', 'south', 'east', 'west'];
    for (const h of headings) {
      const s: Stairway = { ...baseStairway, climbs: h };
      expect(stairTexture(scene, 'sanctum', s, true)).toBe(`stairs-sanctum-${h}-up`);
      expect(stairTexture(scene, 'sanctum', s, false)).toBe(`stairs-sanctum-${h}-down`);
    }
  });

  it('infers heading from bottom and top landings when climbs is omitted', () => {
    const scene = fakeScene([
      'stairs-frostpeak-north-up',
      'stairs-frostpeak-south-up',
      'stairs-frostpeak-east-up',
      'stairs-frostpeak-west-up',
    ]);

    const northStairs: Stairway = { ...baseStairway, bottom: { x: 5, y: 6 }, top: { x: 5, y: 4 } };
    const southStairs: Stairway = { ...baseStairway, bottom: { x: 5, y: 4 }, top: { x: 5, y: 6 } };
    const eastStairs: Stairway = { ...baseStairway, bottom: { x: 4, y: 5 }, top: { x: 6, y: 5 } };
    const westStairs: Stairway = { ...baseStairway, bottom: { x: 6, y: 5 }, top: { x: 4, y: 5 } };

    expect(stairHeading(northStairs)).toBe('north');
    expect(stairHeading(southStairs)).toBe('south');
    expect(stairHeading(eastStairs)).toBe('east');
    expect(stairHeading(westStairs)).toBe('west');

    expect(stairTexture(scene, 'frostpeak', northStairs, true)).toBe('stairs-frostpeak-north-up');
    expect(stairTexture(scene, 'frostpeak', southStairs, true)).toBe('stairs-frostpeak-south-up');
    expect(stairTexture(scene, 'frostpeak', eastStairs, true)).toBe('stairs-frostpeak-east-up');
    expect(stairTexture(scene, 'frostpeak', westStairs, true)).toBe('stairs-frostpeak-west-up');
  });

  it('falls back from directional biome stairs to base biome stairs, then generic directional, then generic', () => {
    // Only base biome stairs loaded
    const sceneBase = fakeScene(['stairs-sanctum-up', 'stairs-sanctum-down', 'stairs-up', 'stairs-down']);
    const sNorth: Stairway = { ...baseStairway, climbs: 'north' };
    expect(stairTexture(sceneBase, 'sanctum', sNorth, true)).toBe('stairs-sanctum-up');
    expect(stairTexture(sceneBase, 'sanctum', sNorth, false)).toBe('stairs-sanctum-down');

    // Only generic directional stairs loaded
    const sceneGenericDir = fakeScene(['stairs-west-up', 'stairs-west-down', 'stairs-up', 'stairs-down']);
    const sWest: Stairway = { ...baseStairway, climbs: 'west' };
    expect(stairTexture(sceneGenericDir, 'unknown-biome', sWest, true)).toBe('stairs-west-up');
    expect(stairTexture(sceneGenericDir, 'unknown-biome', sWest, false)).toBe('stairs-west-down');

    // Only basic generic stairs loaded
    const sceneFallback = fakeScene(['stairs-up', 'stairs-down']);
    expect(stairTexture(sceneFallback, 'unknown-biome', sWest, true)).toBe('stairs-up');
    expect(stairTexture(sceneFallback, 'unknown-biome', sWest, false)).toBe('stairs-down');
  });

  it('respects explicit art on the stairway object', () => {
    const scene = fakeScene(['custom-up', 'custom-down', 'stairs-sanctum-north-up']);
    const customStairs: Stairway = {
      ...baseStairway,
      climbs: 'north',
      art: { up: 'custom-up', down: 'custom-down' },
    };

    expect(stairTexture(scene, 'sanctum', customStairs, true)).toBe('custom-up');
    expect(stairTexture(scene, 'sanctum', customStairs, false)).toBe('custom-down');
  });

  it('handles ladders with directional or generic fallback', () => {
    const ladder: Stairway = { ...baseStairway, kind: 'ladder', climbs: 'north' };
    const scene = fakeScene(['ladder-up', 'ladder-down', 'ladder-frostpeak-north-up']);

    expect(stairTexture(scene, 'frostpeak', ladder, true)).toBe('ladder-frostpeak-north-up');
    expect(stairTexture(scene, 'frostpeak', ladder, false)).toBe('ladder-down');
    expect(stairTexture(scene, 'sanctum', ladder, true)).toBe('ladder-up');
  });
});

describe('all 10 biomes have 4-sided published stairs in manifest and on disk', () => {
  const biomes = Object.keys(BIOMES) as BiomeId[];
  const headings: Heading[] = ['north', 'south', 'east', 'west'];
  const dirs = ['up', 'down'] as const;

  it('defines 10 distinct biomes', () => {
    expect(biomes.length).toBe(10);
  });

  // Verify all 80 directional biome stairs (10 biomes * 4 headings * 2 dirs)
  for (const biome of biomes) {
    for (const heading of headings) {
      for (const dir of dirs) {
        const assetId = `stairs-${biome}-${heading}-${dir}`;

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
  }

  // Verify generic directional stairs
  for (const heading of headings) {
    for (const dir of dirs) {
      const assetId = `stairs-${heading}-${dir}`;

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

  // Verify base aliases (stairs-${biome}-up and stairs-${biome}-down)
  for (const biome of biomes) {
    for (const dir of dirs) {
      const assetId = `stairs-${biome}-${dir}`;

      it(`has base alias entry for ${assetId}`, () => {
        const entry = MANIFEST[assetId];
        expect(entry, `Expected ${assetId} in manifest.json`).toBeDefined();
        const filePath = resolve(ART_DIR, `${assetId}.png`);
        expect(existsSync(filePath), `Expected ${filePath} to exist on disk`).toBe(true);
      });
    }
  }
});

describe('stairs standardization rules', () => {
  const biomes = Object.keys(BIOMES) as BiomeId[];

  it('guarantees every biome stair base asset meets the minimum luminance readability threshold (L >= 110)', async () => {
    const sharp = (await import('sharp')).default;
    for (const biome of biomes) {
      for (const dir of ['up', 'down'] as const) {
        const filePath = resolve(ART_DIR, `stairs-${biome}-${dir}.png`);
        const { data } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
        let solidPixels = 0;
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > 20) {
            solidPixels++;
            totalR += data[i]!;
            totalG += data[i + 1]!;
            totalB += data[i + 2]!;
          }
        }
        expect(solidPixels).toBeGreaterThan(10_000);
        const avgR = totalR / solidPixels;
        const avgG = totalG / solidPixels;
        const avgB = totalB / solidPixels;
        const lum = Math.round(0.299 * avgR + 0.587 * avgG + 0.114 * avgB);
        expect(lum, `${biome} ${dir} stairs luminance (${lum}) must be >= 110 for in-game readability`).toBeGreaterThanOrEqual(110);
      }
    }
  });

  it('guarantees all stair manifests adhere to standard 256x256 dimensions and prop kind', () => {
    for (const biome of biomes) {
      for (const heading of ['north', 'south', 'east', 'west'] as const) {
        for (const dir of ['up', 'down'] as const) {
          const id = `stairs-${biome}-${heading}-${dir}`;
          const entry = MANIFEST[id];
          expect(entry.width).toBe(256);
          expect(entry.height).toBe(256);
          expect(entry.kind).toBe('prop');
        }
      }
    }
  });
});
