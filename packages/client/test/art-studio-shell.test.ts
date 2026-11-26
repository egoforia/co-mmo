import { describe, expect, it } from 'vitest';
import { filterAssets, groupCounts, type StudioAsset } from '../src/art-studio/browser.ts';
import { dockWidth, DOCK_WIDTH } from '../src/art-studio/docks.ts';
import { studioKey } from '../src/art-studio/keys.ts';
import { WORKSPACES, pageFor, placeHash, workspaceOf } from '../src/art-studio/workspaces.ts';
import { SUBTABS } from '../src/art-ui/state.ts';

const asset = (id: string, group: string, more: Partial<StudioAsset> = {}): StudioAsset => ({ id, name: id.replace(/-/g, ' '), group, status: 'painted', place: { tab: 'biomes' }, ...more });

describe('Art Studio workspaces', () => {
  it('puts every page of the old tabs in one workspace or the top bar, so nothing is lost', () => {
    for (const [id] of SUBTABS) {
      const home = workspaceOf(id);
      if (!home) expect(['map-editor', 'models']).toContain(id);
      else expect(WORKSPACES.filter((w) => w.pages.includes(id))).toHaveLength(1);
    }
    expect(WORKSPACES.map((w) => w.key)).toEqual([1, 2, 3, 4, 5]);
  });

  it('opens a workspace on the page last open in it', () => {
    const animate = WORKSPACES.find((w) => w.id === 'animate')!;
    expect(pageFor(animate, {})).toBe('entities');
    expect(pageFor(animate, { animate: 'monsters' })).toBe('monsters');
    expect(pageFor(animate, { animate: 'items' })).toBe('entities');
  });

  it('turns an asset\'s place into the old link that opens it', () => {
    expect(placeHash({ tab: 'characters', page: 'Mara', walker: 'mara' })).toBe('#art/characters/Mara?walker=mara');
    expect(placeHash({ tab: 'items', page: 'Craft tools', asset: 'pick' })).toBe('#art/items/Craft%20tools?asset=pick');
    expect(placeHash({ tab: 'hud', page: 'Icons', asset: 'fx' })).toBe('#art/hud-fx/Icons?asset=fx');
  });
});

describe('the asset browser', () => {
  const list = [
    asset('sage-bush', 'spots', { land: 'sanctum', status: 'missing' }),
    asset('copper-vein', 'spots', { land: 'frostpeak' }),
    asset('inn-furniture-table', 'pieces', { land: 'sanctum' }),
    asset('mara', 'characters'),
  ];
  const all = { group: 'all', land: 'all', status: 'all', search: '' };

  it('filters by group, land, state and every searched word', () => {
    expect(filterAssets(list, { ...all, group: 'spots' }).map((a) => a.id)).toEqual(['sage-bush', 'copper-vein']);
    expect(filterAssets(list, { ...all, land: 'sanctum' }).map((a) => a.id)).toEqual(['sage-bush', 'inn-furniture-table']);
    expect(filterAssets(list, { ...all, status: 'missing' }).map((a) => a.id)).toEqual(['sage-bush']);
    expect(filterAssets(list, { ...all, search: 'inn TABLE' }).map((a) => a.id)).toEqual(['inn-furniture-table']);
    expect(filterAssets(list, { ...all, search: 'sanctum bush' }).map((a) => a.id)).toEqual(['sage-bush']);
  });

  it('counts each group for its chip', () => {
    expect(groupCounts(list)).toEqual({ all: 4, spots: 2, pieces: 1, characters: 1 });
  });
});

describe('the Studio keys and docks', () => {
  const press = (key: string, more: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, ...more });

  it('opens workspaces with 1 to 5, searches with /, puts the asset down with Esc', () => {
    expect(studioKey(press('3'), false)).toEqual({ workspace: 3 });
    expect(studioKey(press('/'), false)).toEqual({ search: true });
    expect(studioKey(press('Escape'), false)).toEqual({ deselect: true });
    expect(studioKey(press('6'), false)).toBeUndefined();
  });

  it('leaves keys alone while typing or with Ctrl held', () => {
    expect(studioKey(press('1'), true)).toBeUndefined();
    expect(studioKey(press('1', { ctrlKey: true }), false)).toBeUndefined();
  });

  it('keeps a dragged dock within its limits', () => {
    expect(dockWidth(50)).toBe(DOCK_WIDTH.least);
    expect(dockWidth(9999)).toBe(DOCK_WIDTH.most);
    expect(dockWidth(321.4)).toBe(321);
  });
});
