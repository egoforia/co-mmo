import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, WALK_DIRECTIONS, ISO_WAYS } from '@co-mmo/shared';
import { FLAT_ISOMETRIC, chooseStyle } from '../src/assets/style-profile.ts';
import { buildingArtJobs } from '../src/assets/building-art.ts';
import { viewPrompt, walkVideoPrompt } from '../src/assets/walk-video.ts';
import { JUDGE_SYSTEM } from '../src/assets/style-check.ts';

describe('the art style profile', () => {
  it('is the flat isometric style, and falls back from an unknown name', () => {
    expect(chooseStyle({})).toBe(FLAT_ISOMETRIC);
    expect(chooseStyle({ ART_STYLE: 'flat-isometric' })).toBe(FLAT_ISOMETRIC);
    expect(chooseStyle({ ART_STYLE: 'no-such-style' })).toBe(FLAT_ISOMETRIC);
  });

  it('gives every prompt builder its words: buildings, insides, walk clips and the judge', () => {
    const cottage = Object.values(BUILDING_STYLES)[0]!;
    const [outside, floor] = buildingArtJobs(cottage);
    expect(outside!.prompt.startsWith(FLAT_ISOMETRIC.base)).toBe(true);
    expect(outside!.prompt).toContain(`seen from outside, ${FLAT_ISOMETRIC.view}.`);
    expect(floor!.prompt.startsWith(FLAT_ISOMETRIC.interior.style)).toBe(true);
    expect(walkVideoPrompt([], 'front-left').startsWith(FLAT_ISOMETRIC.animation)).toBe(true);
    expect(JUDGE_SYSTEM).toContain(FLAT_ISOMETRIC.judge.look);
  });

  it('paints every standing and walking way in the flat isometric look', () => {
    for (const d of [...WALK_DIRECTIONS, ...ISO_WAYS]) {
      expect(viewPrompt('Mara', [], d).startsWith(FLAT_ISOMETRIC.base)).toBe(true);
      expect(viewPrompt('Mara', [], d)).toContain('Paint them in the style described above');
      expect(walkVideoPrompt([], d).startsWith(FLAT_ISOMETRIC.animation)).toBe(true);
    }
  });

  it('leaves a building look\'s colours to the look itself', () => {
    expect(FLAT_ISOMETRIC.kitTextures).not.toMatch(/terracotta|honey|cream/);
    expect(FLAT_ISOMETRIC.kitTextures).toContain('in the colours each texture below names');
  });
});
