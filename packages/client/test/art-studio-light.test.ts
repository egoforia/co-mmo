import { describe, expect, it } from 'vitest';
import { FLAME_LIGHT, GLOW_LIFT, LAMP_LIGHT } from '@co-mmo/shared';
import { FitDraft, type FitState } from '../src/art-studio/fit-tool.ts';
import { clampLight, draftGlow, glowHome, lightButton, lightFromFields, lightPanelHtml } from '../src/art-studio/light-tool.ts';
import type { StudioAsset } from '../src/art-studio/browser.ts';
import { PROJECTION } from '../src/projection.ts';
import { followFit } from '../src/tile-stand.ts';

const plain: FitState = { offset: [0, 0], scale: 1 };
const piece = (id: string) => ({ id, name: id, group: 'pieces', footprint: { width: 1, height: 1 } }) as StudioAsset;

/** The Inspector's inputs as drawn in `html`, with `fields` typed in (no DOM in these tests). */
function panel(html: string, fields: Record<string, string | boolean>): HTMLElement {
  const inputs = new Map<string, { value: string; checked: boolean }>();
  for (const m of html.matchAll(/<input ([^>]*)\/>/g)) {
    const name = /name="([^"]+)"/.exec(m[1]!)?.[1];
    if (name) inputs.set(name, { value: /value="([^"]*)"/.exec(m[1]!)?.[1] ?? '', checked: / checked/.test(m[1]!) });
  }
  for (const [name, v] of Object.entries(fields)) {
    const input = inputs.get(name)!;
    if (typeof v === 'boolean') input.checked = v;
    else input.value = v;
  }
  return { querySelector: (sel: string) => inputs.get(/name=([\w-]+)/.exec(sel)?.[1] ?? '') ?? null } as unknown as HTMLElement;
}

/** A Light button, as clicked. */
const button = (attr: string) => ({ closest: (sel: string) => (sel === `[${attr}]` ? {} : null) }) as unknown as HTMLElement;

describe('the Light tool', () => {
  it('keeps a light within its limits and drops one that changes nothing', () => {
    expect(clampLight({ at: [0.4, -300], strength: 2.5, radius: 0.2, color: '#FFAA00' })).toEqual({ at: [0, -256], strength: 2, radius: 1, color: '#ffaa00' });
    expect(clampLight({ at: [0, 0], strength: 1 })).toBeUndefined();
  });

  it("reads colour, brightness, reach, place and flicker from the fields, against the kind's light", () => {
    const a = piece('sanctum-brazier');
    const html = lightPanelHtml(a, new FitDraft(undefined));
    expect(html).toContain('name="light-color"');
    expect(html).toContain('checked'); // fires flicker
    const el = panel(html, { 'light-color': '#88ccff', 'light-strength': '150', 'light-radius': '3.5', 'light-x': '4', 'light-y': '-8', 'light-flicker': false });
    expect(lightFromFields(el, plain, FLAME_LIGHT).light).toEqual({ at: [4, -8], color: '#88ccff', strength: 1.5, radius: 3.5, flicker: false });
    // Nothing changed: its usual light, so no light is kept.
    expect(lightFromFields(panel(html, {}), plain, FLAME_LIGHT).light).toBeUndefined();
  });

  it('gives a piece without a light a lantern, turns it off and back to usual', () => {
    const a = piece('sanctum-bench');
    expect(lightPanelHtml(a, new FitDraft(undefined))).toContain('data-light-add');
    const added = lightButton(button('data-light-add'), plain)!;
    expect(draftGlow(a, added)?.light).toEqual(LAMP_LIGHT);
    const off = lightButton(button('data-light-off'), added)!;
    expect(draftGlow(a, off)).toBeUndefined();
    expect(lightButton(button('data-light-usual'), off)).toEqual(plain);
    // Its fields keep a light that changes nothing else, so it still glows.
    expect(lightFromFields(panel(lightPanelHtml(a, new FitDraft({ offset: [0, 0], light: added.light })), {}), added, undefined).light).toEqual({ color: LAMP_LIGHT.color });
  });

  it('undoes a light change like any fit change', () => {
    const d = new FitDraft(undefined);
    d.set({ ...d.state, light: { color: '#00ff00' } });
    expect(d.changed).toBe(true);
    expect(d.fit.light).toEqual({ color: '#00ff00' });
    d.undo();
    expect(d.changed).toBe(false);
  });

  it('sits where the game puts it, and follows the picture when it is fitted', () => {
    const stand = PROJECTION.stand(0, 0, 1, 1);
    const feet = PROJECTION.toScreen(stand.x, stand.y);
    expect(glowHome({ left: 0, top: 0, right: 1, bottom: 1 })).toEqual({ x: feet.x, y: feet.y - GLOW_LIFT });
    const plan = { x: 0, y: 100, scale: 0.5 };
    expect(followFit({ x: 0, y: 20 }, plan, undefined)).toEqual({ x: 0, y: 20 });
    // Moved 10 picture pixels right (5 drawn) and trimmed to 90 %: nearer where it stands.
    expect(followFit({ x: 0, y: 20 }, plan, { offset: [10, 0], scale: 0.9 })).toEqual({ x: 4.5, y: 100 - 80 * 0.9 });
  });
});
