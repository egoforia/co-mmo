import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES } from '@co-mmo/shared';
import { STORYBOOK, chooseStyle } from '../src/assets/style-profile.ts';
import { buildingArtJobs } from '../src/assets/building-art.ts';
import { walkVideoPrompt } from '../src/assets/walk-video.ts';
import { JUDGE_SYSTEM } from '../src/assets/style-check.ts';

describe('the art style profile', () => {
  it('is the storybook style unless ART_STYLE names another, and falls back from an unknown name', () => {
    expect(chooseStyle({})).toBe(STORYBOOK);
    expect(chooseStyle({ ART_STYLE: 'storybook' })).toBe(STORYBOOK);
    expect(chooseStyle({ ART_STYLE: 'no-such-style' })).toBe(STORYBOOK);
  });

  it('gives every prompt builder its words: buildings, insides, walk clips and the judge', () => {
    const cottage = Object.values(BUILDING_STYLES)[0]!;
    const [outside, floor] = buildingArtJobs(cottage);
    expect(outside!.prompt.startsWith(STORYBOOK.base)).toBe(true);
    expect(outside!.prompt).toContain(`seen from outside, ${STORYBOOK.view}.`);
    expect(floor!.prompt.startsWith(STORYBOOK.interior.style)).toBe(true);
    expect(walkVideoPrompt([], 'front').startsWith(STORYBOOK.animation)).toBe(true);
    expect(JUDGE_SYSTEM).toContain(STORYBOOK.judge.look);
  });
});
