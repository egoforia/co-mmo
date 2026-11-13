import { describe, expect, it } from 'vitest';
import { generateRegion, regionDef, type WorldEditDraft } from '@co-mmo/shared';
import { architectHtml, emptyArchitect, ticked, type ArchitectState } from '../src/editor/architect.ts';
import { EditorCore } from '../src/editor/core.ts';
import { keyAction } from '../src/editor/edit-keys.ts';
import { checkLand, landPanelHtml } from '../src/editor/land-panel.ts';
import { drawPlan } from '../src/editor/plan-draw.ts';
import { barHtml, chooseSky, doneWords } from '../src/editor/shell.ts';

// The Plan camera in edit mode: Tab and the top bar switch cameras, the plan
// marks the Architect's ticked steps in cyan, the Architect's card ticks only
// the steps that fit, and a land far away is checked from its own map.

const map = generateRegion(regionDef('sanctum')!);
const road: WorldEditDraft = { kind: 'road', from: [22, 28], to: [26, 28] } as WorldEditDraft;
const spot: WorldEditDraft = { kind: 'spot', at: [30, 30], spot: 'herb' } as unknown as WorldEditDraft;

function architect(): ArchitectState {
  return {
    ...emptyArchitect(),
    prompt: 'Lay a road',
    summary: 'A road and a spot.',
    usd: 0.004,
    steps: [
      { draft: road, summary: 'Lay a stone road', valid: true, checked: true },
      { draft: spot, summary: 'Put a herb spot', valid: false, why: 'Water is there.', checked: false },
    ],
  };
}

/** A stand-in for a canvas's 2D context: it keeps what was filled, and in which colour. */
function fakeCanvas(): { canvas: HTMLCanvasElement; fills: string[] } {
  const fills: string[] = [];
  const g = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect() {}, strokeRect() {}, beginPath() {}, arc() {}, fill() {},
    fillRect() {
      fills.push(String(g.fillStyle));
    },
  };
  return { canvas: { width: 100, height: 100, getContext: () => g } as unknown as HTMLCanvasElement, fills };
}

const key = (k: string, more: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...more }) as KeyboardEvent;

describe('the Plan camera', () => {
  it('is switched to by Tab, and by the top bar', () => {
    const core = new EditorCore();
    expect(keyAction(key('Tab'), core, {})).toEqual({ camera: true });
    expect(keyAction(key('Tab', { shiftKey: true }), core, {})).toBeUndefined();
    const bar = (camera: 'world' | 'plan') => barHtml({ land: 'Sanctum', floor: 0, floorChosen: false, sky: { hour: '' }, camera, showGrid: false, showHitboxes: false, list: { edits: [], undone: 0 }, live: false, busy: false });
    expect(bar('plan')).toMatch(/data-camera="plan" class="on" aria-pressed="true"/);
    expect(bar('world')).toMatch(/data-camera="world" class="on"/);
    // The plan has its own tile and hitbox switches, and no sky.
    expect(bar('plan')).not.toContain('view-hour');
    expect(bar('world')).toContain('view-hour');
  });

  it('marks the Architect\'s ticked steps in cyan', () => {
    const layers = { grid: false, hitboxes: false, spots: false, people: false };
    const without = fakeCanvas();
    drawPlan(without.canvas, { map, floor: 0, cell: 1, layers });
    const marked = fakeCanvas();
    drawPlan(marked.canvas, { map, floor: 0, cell: 1, layers, steps: [road] });
    const cyan = (fills: string[]) => fills.filter((f) => f.startsWith('rgba(44, 232, 245')).length;
    expect(cyan(without.fills)).toBe(0);
    expect(cyan(marked.fills)).toBe(2);
    // Every tile is filled once.
    expect(without.fills.length).toBe(map.width * map.height);
  });

  it('checks a land from its own map, far from where we stand', () => {
    const none = checkLand(map, () => false);
    expect(none.region).toBe('sanctum');
    expect(none.unpainted.length).toBeGreaterThan(0);
    expect(checkLand(map, () => true).unpainted).toEqual([]);
  });
});

describe('the Architect in the land panel', () => {
  it('ticks only the steps that fit, and says why the others do not', () => {
    const a = architect();
    expect(ticked(a)).toEqual([road]);
    const html = architectHtml(a);
    expect(html).toContain('id="architect-form"');
    expect(html).toContain('Make 1 step');
    expect(html).toMatch(/data-ai-check="1" disabled/);
    expect(html).toContain('Water is there.');
    a.steps[1]!.checked = true;
    expect(ticked(a)).toEqual([road]);
  });

  it('has its own tab, counting its steps', () => {
    const html = landPanelHtml({ tab: 'architect', region: 'sanctum', list: { edits: [], undone: 0 }, map, filter: 'all', marks: [], viewName: '', checks: undefined, landForm: '', architect: architectHtml(architect()), steps: 1, lands: '' });
    expect(html).toMatch(/data-land-tab="architect" aria-selected="true"[^>]*>Architect \(1\)/);
    expect(html).toContain('Lay a stone road');
  });
});

describe('the edit mode frame', () => {
  it('shows the sky chosen, on this screen only', () => {
    const sky = { hour: '' };
    expect(chooseSky(sky, 'night')).toEqual({ phase: 0 });
    expect(chooseSky(sky, undefined, 'rain')).toEqual({ phase: 0, weather: 'rain' });
    expect(chooseSky(sky, 'nonsense', 'hail')).toEqual({});
  });

  it('says what a change did', () => {
    expect(doneWords({ undo: true }, false)).toBe('Taken back.');
    expect(doneWords({ edit: road }, false)).toMatch(/^Drafted/);
    expect(doneWords({ edit: road }, true)).toMatch(/Everyone here sees it now/);
  });
});
