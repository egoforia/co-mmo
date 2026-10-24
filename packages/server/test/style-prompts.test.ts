import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, buildingKit, type Facing } from '@co-mmo/shared';
import { buildPrompt, paintedFootprint, type AssetDescription } from '../src/assets/style.ts';
import { buildingArtJobs } from '../src/assets/building-art.ts';
import { viewPrompt, walkVideoPrompt, waysSheetPrompt } from '../src/assets/walk-video.ts';
import { JUDGE_SYSTEM } from '../src/assets/style-check.ts';
import { normalPrompt } from '../src/normal-painter.ts';
import { regions, sheetPrompt } from '../src/assets/building-kit/sheet.ts';
import { STYLE } from '../src/assets/style-profile.ts';

// Every kind of prompt the game paints with, word for word, so a change to the
// art style shows exactly what it changes (the snapshot file is the record).

const FACINGS: Facing[] = ['front', 'right', 'back', 'left', 'front-left', 'front-right', 'back-left', 'back-right'];

const LANTERN: AssetDescription = {
  name: 'Glowing Lantern', kind: 'item', biome: 'sanctum', silhouetteHook: 'a round glass belly with a flame inside',
  body: 'a brass lantern with a ring handle', colors: { main: 'brass', accent: 'warm flame' }, mood: 'cosy',
};
const MOSS: AssetDescription = {
  name: 'Mossy ground', kind: 'tile', biome: 'whispering-woods', silhouetteHook: 'soft moss',
  body: 'mossy forest floor', colors: { main: 'sage green' }, mood: 'calm',
};

const STONES: AssetDescription = {
  name: 'Ring of standing stones', kind: 'set-piece', biome: 'sanctum', silhouetteHook: 'a broken ring of tall stones',
  body: 'weathered standing stones in a ring', colors: { main: 'grey stone' }, mood: 'ancient',
};

describe('every prompt the game paints with', () => {
  it('sprites and ground tiles', () => {
    expect(buildPrompt(LANTERN)).toMatchSnapshot();
    expect(buildPrompt(MOSS)).toMatchSnapshot();
  });

  it('a set piece standing on its tiles', () => {
    expect(buildPrompt(STONES, paintedFootprint('sanctum-standing-stones'))).toMatchSnapshot();
  });

  it('a building outside, its inside tiles and its furniture', () => {
    for (const job of buildingArtJobs(BUILDING_STYLES['sanctum-arcanum']!).slice(0, 5)) expect(job.prompt).toMatchSnapshot(job.id);
  });

  it('walkers standing and walking, every way', () => {
    for (const f of FACINGS) {
      expect(viewPrompt('Mara', [], f)).toMatchSnapshot(`stand ${f}`);
      expect(walkVideoPrompt([], f)).toMatchSnapshot(`walk ${f}`);
    }
    expect(waysSheetPrompt('Mara', [])).toMatchSnapshot('the four ways on one sheet');
  });

  it('normal maps, the style judge and a kit texture sheet', () => {
    expect(normalPrompt('Glowing Lantern')).toMatchSnapshot();
    expect(JUDGE_SYSTEM).toMatchSnapshot();
    for (const look of ['timber-cottage', 'castle-stone']) expect(sheetPrompt(regions(), buildingKit.KIT_LOOKS[look]!, STYLE.kitTextures)).toMatchSnapshot(look);
  });
});
