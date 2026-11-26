// The Light tool: where a set piece's glow sits (a brazier's flame, a
// lantern's glass, a shrine's heart), what colour it is, how bright it burns
// and how far it reaches. Its kind gives it a light (lighting.ts glowOf);
// what is chosen here is kept with the picture's fit (asset-fit.ts FitLight)
// and the game lights it so (glowFor). Drag the light's marker on the canvas
// or type in the Inspector; nothing reaches the game until the fit is saved.

import { FIT_LIGHT, GLOW_LIFT, LAMP_LIGHT, glowOf, glowWith, lightWords, type FitLight, type Light } from '@co-mmo/shared';
import { PROJECTION } from '../projection.ts';
import { escapeHtml } from '../ui.ts';
import type { StudioAsset } from './browser.ts';
import type { Floor } from '../tile-stand.ts';
import type { FitDraft, FitState } from './fit-tool.ts';

/** Groups whose pictures stand in the world as pieces that can glow. */
export const LIGHT_GROUPS = ['pieces'];

/** A light kept within its limits; nothing when it changes nothing. */
export function clampLight(l: FitLight): FitLight | undefined {
  const { most, strength: S, radius: R } = FIT_LIGHT;
  const px = (n: number) => Math.max(-most, Math.min(most, Math.round(n)));
  const at: [number, number] = [px(l.at?.[0] ?? 0), px(l.at?.[1] ?? 0)];
  const strength = l.strength === undefined ? 1 : Math.max(S.least, Math.min(S.most, Math.round(l.strength * 100) / 100));
  const radius = l.radius === undefined ? undefined : Math.max(R.least, Math.min(R.most, Math.round(l.radius * 2) / 2));
  const color = l.color && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color.toLowerCase() : undefined;
  const kept: FitLight = {
    ...(at[0] || at[1] ? { at } : {}),
    ...(color ? { color } : {}),
    ...(strength !== 1 ? { strength } : {}),
    ...(radius !== undefined ? { radius } : {}),
    ...(typeof l.flicker === 'boolean' ? { flicker: l.flicker } : {}),
  };
  return Object.keys(kept).length ? kept : undefined;
}

/** The light the draft gives, as the game would light it, and where from its usual place; none when it gives none. */
export function draftGlow(asset: Pick<StudioAsset, 'id'>, state: Pick<FitState, 'light'>): { light: Light; at: [number, number] } | undefined {
  return glowWith(glowOf(asset.id), state.light);
}

/** Where a piece's glow sits before it is moved, in canvas world pixels: a little above where it stands, as the game puts it. */
export function glowHome(floor: Floor): { x: number; y: number } {
  const feet = PROJECTION.stand(floor.left, floor.top, floor.right - floor.left, floor.bottom - floor.top);
  const at = PROJECTION.toScreen(feet.x, feet.y);
  return { x: at.x, y: at.y - GLOW_LIFT };
}

/** The Inspector's Light section for a set piece. */
export function lightPanelHtml(a: StudioAsset, draft: FitDraft): string {
  const own = draft.state.light;
  const kind = glowOf(a.id);
  const glow = draftGlow(a, draft.state);
  const title = '<h2 class="dock-title">Light</h2>';
  if (!kind && !own) {
    return `${title}
    <p class="note">It gives no light. Give it one to make it glow like a lantern, then choose its colour, brightness and place.</p>
    <p class="inspector-links"><button type="button" class="quiet" data-light-add>Give it a light</button></p>`;
  }
  const off = own?.strength === 0;
  const shown = glow?.light ?? { ...(kind ?? LAMP_LIGHT), ...own };
  const [x, y] = own?.at ?? [0, 0];
  const strength = Math.round((own?.strength ?? 1) * 100);
  const { most, strength: S, radius: R } = FIT_LIGHT;
  return `${title}
    <p class="note">Drag the light's marker on the canvas to move it, or type. Pick a time of day above the canvas to see it glow.</p>
    <div class="fit-fields light-fields">
      <label>Colour <input type="color" name="light-color" value="${escapeHtml(shown.color)}" /></label>
      <label>Brightness <input type="number" name="light-strength" min="${S.least * 100}" max="${S.most * 100}" step="5" value="${strength}" /> %</label>
      <label>Reach <input type="number" name="light-radius" min="${R.least}" max="${R.most}" step="0.5" value="${shown.radius}" /> tiles</label>
      <label>x <input type="number" name="light-x" min="${-most}" max="${most}" step="1" value="${x}" /> px</label>
      <label>y <input type="number" name="light-y" min="${-most}" max="${most}" step="1" value="${y}" /> px</label>
      <label><input type="checkbox" name="light-flicker"${shown.flicker ? ' checked' : ''} /> Flickers</label>
    </div>
    <p class="note light-words">${escapeHtml(own ? cap(lightWords(own)) : 'Its usual light')}.</p>
    <p class="inspector-links">
      <button type="button" class="quiet" data-light-off${off ? ' disabled' : ''}>Turn its light off</button>
      <button type="button" class="quiet" data-light-usual${own ? '' : ' disabled'}>Back to its usual light</button>
    </p>
    <p class="note">Saved with the fit.</p>`;
}

/** The light the Inspector's fields ask for, kept from `now` where a field is empty. */
export function lightFromFields(el: HTMLElement, now: FitState, kind: Light | undefined): FitState {
  const field = (name: string) => el.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value;
  const num = (name: string, fallback: number) => {
    const v = Number(field(name));
    return field(name) !== '' && Number.isFinite(v) ? v : fallback;
  };
  const own = now.light ?? {};
  const color = field('light-color');
  const flickerBox = el.querySelector<HTMLInputElement>('input[name=light-flicker]');
  const flicker = flickerBox ? flickerBox.checked : (own.flicker ?? !!kind?.flicker);
  const radius = num('light-radius', own.radius ?? kind?.radius ?? LAMP_LIGHT.radius);
  const light: FitLight = {
    at: [num('light-x', own.at?.[0] ?? 0), num('light-y', own.at?.[1] ?? 0)],
    ...(color && (color !== (kind ?? LAMP_LIGHT).color || !kind) ? { color } : {}),
    strength: num('light-strength', (own.strength ?? 1) * 100) / 100,
    ...(radius !== (kind?.radius ?? LAMP_LIGHT.radius) ? { radius } : {}),
    ...(flicker !== !!(kind ?? LAMP_LIGHT).flicker ? { flicker } : {}),
  };
  // A piece with no light of its own keeps one even when nothing else is changed: its colour says so.
  const kept = clampLight(light) ?? (kind ? undefined : { color: LAMP_LIGHT.color });
  const { light: _, ...rest } = now;
  return kept ? { ...rest, light: kept } : rest;
}

/** What a Light button does to the fit, or nothing when the target is not one. */
export function lightButton(target: HTMLElement, now: FitState): FitState | undefined {
  const { light: _, ...rest } = now;
  if (target.closest('[data-light-usual]')) return rest;
  if (target.closest('[data-light-off]')) return { ...rest, light: { ...now.light, strength: 0 } };
  // Its colour said keeps the light chosen while nothing else is changed.
  if (target.closest('[data-light-add]')) return { ...rest, light: { color: LAMP_LIGHT.color } };
  return undefined;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
