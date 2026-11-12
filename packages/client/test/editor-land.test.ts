import { describe, expect, it } from 'vitest';
import { generateRegion, regionDef, type WorldEdit } from '@co-mmo/shared';
import { changesHtml, editBox } from '../src/editor/changes.ts';
import { landPanelHtml, problemTiles } from '../src/editor/land-panel.ts';

// The land panel: a land's changes in drafts, published and built in, with
// where each is; the tabs and their counts; and the places a check names.

const map = generateRegion(regionDef('sanctum')!);
const stamp = { by: 'egoforia', made: 0 };
const house = { ...stamp, id: 'e1', kind: 'house', at: [40, 40], floor: [6, 4], style: 'sanctum-arcanum', draft: true } as unknown as WorldEdit;
const paint = { ...stamp, id: 'e2', kind: 'paint', tile: 'path', tiles: [[3, 4], [3, 5]] } as unknown as WorldEdit;
const quest = { ...stamp, id: 'e3', kind: 'quest', at: [9, 9], level: 1, target: 'sister-amala', title: 'A Favour', offer: 'o', thanks: 't', goal: { kind: 'defeat', creature: 'x', count: 1 }, reward: { xp: 1, gold: 1 } } as unknown as WorldEdit;

describe('the land panel', () => {
  it('says where an edit is: its box when it has a size, its tile when not', () => {
    expect(editBox(house)).toEqual({ x: 40, y: 40, w: 8, h: 6, level: 0 });
    expect(editBox(paint)).toEqual({ x: 3, y: 4, w: 1, h: 1, level: 0 });
    expect(editBox(quest)).toMatchObject({ x: 9, y: 9, level: 1 });
  });

  it('lists drafts apart from published edits, filtered by group, with what was built in', () => {
    const list = { edits: [house, paint, quest], undone: 0 };
    const all = changesHtml(list, map, 'all');
    expect(all).toContain('Drafts (1)');
    expect(all).toContain('Published (2)');
    expect(all).toContain('data-edit-go="e1"');
    expect(all).toContain('Built in (');
    const life = changesHtml(list, map, 'life');
    expect(life).toContain('Published (1)');
    expect(life).toContain('data-edit="e3"');
    expect(life).not.toContain('data-edit="e2"');
  });

  it('counts drafts and problems on the tabs, and marks the places a check names', () => {
    const checks = { region: 'sanctum', found: { shapes: ['The building at (12, 30): falls apart'], walks: ['Hesper at (108, 46) on floor 1 cannot be walked to.'] }, unpainted: [] };
    const html = landPanelHtml({ tab: 'checks', region: 'sanctum', list: { edits: [house], undone: 0 }, map, filter: 'all', marks: [], viewName: '', checks, landForm: '' });
    expect(html).toContain('Changes (1)');
    expect(html).toContain('Checks (2)');
    expect(html).toContain('falls apart');
    expect(problemTiles(checks)).toEqual([[12, 30], [108, 46]]);
  });
});
