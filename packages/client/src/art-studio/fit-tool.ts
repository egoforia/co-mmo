// The Offset tool: how a picture sits on its tiles (asset-fit.ts), changed
// by dragging it on the canvas, nudging it with the arrow keys or typing
// numbers in the Inspector, like Godot's Texture Offset. Nothing reaches the
// game until it is saved; Ctrl Z steps back through the changes made here.

import { FIT_OFFSET_MOST, FIT_SCALE, fitWords, type AssetFit, type FitLight } from '@co-mmo/shared';
import { clampLight } from './light-tool.ts';
import { escapeHtml } from '../ui.ts';
import type { StudioAsset } from './browser.ts';

/** Groups whose pictures can be fitted: not walkers, whose feet the walk pipeline finds per frame. */
export const FIT_GROUPS = ['pieces', 'spots', 'stairs', 'scenery'];
/** Groups whose size may be trimmed too; trees and rocks keep their sizes. */
export const SCALE_GROUPS = ['pieces', 'spots', 'stairs'];

/** A fit being changed: its offset in picture pixels and its size trim. */
export interface FitState {
  offset: [number, number];
  scale: number;
  /** The tiles it blocks (hitbox-tool.ts), from its footprint's top-left; every tile when left out. */
  blocks?: [number, number][];
  /** Its own light (light-tool.ts); its kind's when left out. */
  light?: FitLight;
}

/** A fit kept within its limits: whole pixels, and a trim between FIT_SCALE's. */
export function clampFit(f: FitState): FitState {
  const px = (n: number) => Math.max(-FIT_OFFSET_MOST, Math.min(FIT_OFFSET_MOST, Math.round(n)));
  const scale = Math.max(FIT_SCALE.least, Math.min(FIT_SCALE.most, Math.round(f.scale * 100) / 100));
  const light = f.light && clampLight(f.light);
  return { offset: [px(f.offset[0]), px(f.offset[1])], scale, ...(f.blocks ? { blocks: f.blocks } : {}), ...(light ? { light } : {}) };
}

/** True when two fits stand the picture alike, block the same tiles and light alike. */
export function sameFit(a: FitState, b: FitState): boolean {
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  return a.offset[0] === b.offset[0] && a.offset[1] === b.offset[1] && a.scale === b.scale && same(a.blocks, b.blocks) && same(a.light, b.light);
}

/** A fit being changed in the Studio, with the steps back to where it started. */
export class FitDraft {
  private now: FitState;
  private readonly saved: FitState;
  private readonly back: FitState[] = [];

  constructor(fit: Pick<AssetFit, 'offset' | 'scale' | 'blocks' | 'light'> | undefined) {
    this.saved = {
      offset: [fit?.offset[0] ?? 0, fit?.offset[1] ?? 0],
      scale: fit?.scale ?? 1,
      ...(fit?.blocks?.length ? { blocks: fit.blocks } : {}),
      ...(fit?.light ? { light: fit.light } : {}),
    };
    this.now = this.saved;
  }

  /** The fit as it stands in the Studio. */
  get state(): FitState {
    return this.now;
  }

  /** As an AssetFit for drawing (no scale when untrimmed). */
  get fit(): Pick<AssetFit, 'offset' | 'scale' | 'blocks' | 'light'> {
    const { offset, scale, blocks, light } = this.now;
    return { offset, ...(scale !== 1 ? { scale } : {}), ...(blocks ? { blocks } : {}), ...(light ? { light } : {}) };
  }

  /** True when it differs from what the game shows. */
  get changed(): boolean {
    return !sameFit(this.now, this.saved);
  }

  /** Changes it; `step` false while a drag goes on, so the whole drag is one step back. */
  set(next: FitState, step = true): void {
    const kept = clampFit(next);
    if (sameFit(kept, this.now)) return;
    if (step) this.back.push(this.now);
    this.now = kept;
  }

  /** Marks where a drag started, so undo goes back to before it. */
  mark(): void {
    this.back.push(this.now);
  }

  /** Moves it by whole pixels. */
  nudge(dx: number, dy: number): void {
    this.set({ ...this.now, offset: [this.now.offset[0] + dx, this.now.offset[1] + dy] });
  }

  /** One step back; false when there is none. */
  undo(): boolean {
    const before = this.back.pop();
    if (!before) return false;
    this.now = before;
    return true;
  }
}

/** The Inspector's Offset section for an asset being fitted. */
export function fitPanelHtml(a: StudioAsset, draft: FitDraft, more = ''): string {
  const { offset, scale } = draft.state;
  const trim = SCALE_GROUPS.includes(a.group)
    ? `<label>Size <input type="number" name="fit-scale" min="${FIT_SCALE.least * 100}" max="${FIT_SCALE.most * 100}" step="1" value="${Math.round(scale * 100)}" /> %</label>`
    : '';
  return `
    <h2 class="dock-title">Offset</h2>
    <p class="note">Drag the picture on the canvas, nudge it with the arrow keys (Shift: 10 px), type, or centre it (C). Ctrl Z steps back.</p>
    <div class="fit-fields">
      <label>x <input type="number" name="fit-x" min="${-FIT_OFFSET_MOST}" max="${FIT_OFFSET_MOST}" step="1" value="${offset[0]}" /> px</label>
      <label>y <input type="number" name="fit-y" min="${-FIT_OFFSET_MOST}" max="${FIT_OFFSET_MOST}" step="1" value="${offset[1]}" /> px</label>
      ${trim}
    </div>
    <p class="note fit-words">${escapeHtml(cap(fitWords(draft.fit)))}${draft.changed ? ' · not saved yet' : ''}</p>
    <p class="inspector-links">
      <button type="button" class="quiet" data-fit-centre title="Stand where it meets the ground on the middle of its tiles (C)">Centre on its tiles</button>
      <button type="button" data-fit-save${draft.changed ? '' : ' disabled'}>Save the fit</button>
      <button type="button" class="quiet" data-fit-reset>Back to the painter's place</button>
    </p>${more}`;
}

/** The fit the Inspector's fields ask for. */
export function fitFromFields(el: HTMLElement, now: FitState): FitState {
  const num = (name: string, fallback: number) => {
    const v = Number(el.querySelector<HTMLInputElement>(`input[name=${name}]`)?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return { ...now, offset: [num('fit-x', now.offset[0]), num('fit-y', now.offset[1])], scale: num('fit-scale', now.scale * 100) / 100 };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
