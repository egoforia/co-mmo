// The frame strip: a walker's frames along the bottom, as a video editor's
// timeline. One track per way it faces, for its walk, run or attack, and a
// looping preview of the way picked. Clicking a frame stops the loop there
// and hands that frame to the hand workbench (art-ui/hand-editor.ts), which
// edits the frame under the playhead.

import { ISO_WAYS, ISO_WAY_LABELS, SPOTS, SPOT_STATES, spotStateArt, type IsoWay } from '@co-mmo/shared';
import { getStripForKind, getWorkbenchState, rerenderWorkbench } from '../art-ui/hand-editor.ts';
import type { ArtItem, WalkStrip, WalkerView } from '../art-ui/state.ts';
import { escapeHtml } from '../ui.ts';

/** The animations the strip shows, in its order. */
export const FRAME_KINDS = [['walk', 'Walk'], ['run', 'Run'], ['attack', 'Attack']] as const;
type Kind = (typeof FRAME_KINDS)[number][0];

/** CSS that shows one frame of a strip, filling the cell it is drawn in. */
export function frameStyle(strip: Pick<WalkStrip, 'url' | 'frames'>, frame: number): string {
  const at = strip.frames > 1 ? (frame * 100) / (strip.frames - 1) : 0;
  return `background-image:url('${strip.url.replace(/'/g, '%27')}');background-size:${strip.frames * 100}% 100%;background-position:${at}% 0`;
}

/** The next frame when the loop plays. */
export function nextFrame(frame: number, frames: number): number {
  return frames > 0 ? (frame + 1) % frames : 0;
}

/** The strip's HTML for a walker: kinds, preview and one track per way. */
export function framesHtml(w: WalkerView, kind: Kind, way: IsoWay, frame: number, playing: boolean): string {
  const kinds = FRAME_KINDS.map(([id, label]) => `<button type="button" data-frames-kind="${id}" aria-pressed="${id === kind}">${label}</button>`).join('');
  const picked = getStripForKind(w, kind, way);
  const tracks = ISO_WAYS.map((d) => {
    const strip = getStripForKind(w, kind, d);
    const cells = strip
      ? Array.from({ length: strip.frames }, (_, i) => {
          const here = d === way && i === frame;
          return `<button type="button" data-frame="${i}" data-way="${d}" style="${escapeHtml(frameStyle(strip, i))}" aria-label="${escapeHtml(`${ISO_WAY_LABELS[d]}, frame ${i + 1}`)}"${here ? ' aria-current="true"' : ''}></button>`;
        }).join('')
      : '<span class="note">No clip yet</span>';
    return `<span class="frames-way">${escapeHtml(ISO_WAY_LABELS[d])}</span><div class="frames-track">${cells}</div>`;
  }).join('');
  return `
    <div class="frames-side">
      <span class="strip-title">Frames · ${escapeHtml(w.name)}</span>
      <span class="frames-kinds" role="group" aria-label="Animation">${kinds}</span>
      <div class="frames-preview" role="img" aria-label="${escapeHtml(`${ISO_WAY_LABELS[way]} ${kind}, playing`)}"${picked ? ` style="${escapeHtml(frameStyle(picked, frame))}"` : ''}></div>
      <button type="button" data-frames-play>${playing ? '⏸ Pause' : '▶ Play'}</button>
    </div>
    <div class="frames-tracks">${tracks}</div>`;
}

/** A gathering spot's states side by side (spot-states.ts): Ready, Picked and Growing, each as painted or not yet. */
export function spotStatesHtml(kind: string, items: readonly ArtItem[]): string {
  const def = SPOTS[kind];
  if (!def) return '';
  const cells = [{ id: 'ready', name: 'Ready' }, ...SPOT_STATES].map((st) => {
    const item = items.find((i) => i.id === spotStateArt(kind, st.id as 'ready'));
    const picture = item?.url ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(`${def.name}, ${st.name}`)}" />` : '<span class="note">Not painted yet</span>';
    return `<figure class="spot-state">${picture}<figcaption>${escapeHtml(st.name)}</figcaption></figure>`;
  }).join('');
  return `
    <div class="frames-side">
      <span class="strip-title">States · ${escapeHtml(def.name)}</span>
      <span class="note">Each player sees their own: Picked once they gather, Growing past half way, then Ready. Until a state is painted, the Ready picture shows.</span>
    </div>
    <div class="spot-states">${cells}</div>`;
}

/** The strip along the bottom for the selected walker or spot; hidden for anything else. */
export class FrameStrip {
  private walker: WalkerView | undefined;
  private kind: Kind = 'walk';
  private way: IsoWay = 'front-left';
  private frame = 0;
  private playing = true;
  private timer: number | undefined;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('click', (e) => this.click(e.target as HTMLElement));
  }

  /** Shows other contents than a walker's frames (a spot's states), or hides the strip when empty. */
  showHtml(html: string): void {
    this.walker = undefined;
    this.el.hidden = !html;
    this.loop();
    this.el.innerHTML = html;
  }

  /** Shows a walker's frames, or hides the strip. */
  show(w: WalkerView | undefined): void {
    if (w?.id !== this.walker?.id) {
      this.walker = w;
      this.frame = 0;
      if (w) {
        // Start where the hand workbench stands, so the two agree.
        const st = getWorkbenchState(w);
        this.kind = (FRAME_KINDS.some(([id]) => id === st.animKind) ? st.animKind : 'walk') as Kind;
        this.way = st.facing;
      }
    }
    const any = w && ISO_WAYS.some((d) => getStripForKind(w, this.kind, d) || getStripForKind(w, 'walk', d));
    this.el.hidden = !any;
    this.loop();
    this.draw();
  }

  private draw(): void {
    if (!this.walker || this.el.hidden) return;
    this.el.innerHTML = framesHtml(this.walker, this.kind, this.way, this.frame, this.playing);
  }

  /** Moves the playhead on while playing: only the preview and the marked cell change. */
  private loop(): void {
    const on = this.playing && !this.el.hidden && !!this.walker;
    if (!on) {
      clearInterval(this.timer);
      this.timer = undefined;
      return;
    }
    if (this.timer !== undefined) return;
    this.timer = window.setInterval(() => {
      const strip = this.walker && getStripForKind(this.walker, this.kind, this.way);
      if (!strip || !this.el.isConnected) return;
      this.frame = nextFrame(this.frame, strip.frames);
      const preview = this.el.querySelector<HTMLElement>('.frames-preview');
      if (preview) preview.setAttribute('style', frameStyle(strip, this.frame));
      this.el.querySelector('[aria-current="true"]')?.removeAttribute('aria-current');
      this.el.querySelector(`[data-way="${this.way}"][data-frame="${this.frame}"]`)?.setAttribute('aria-current', 'true');
    }, 1000 / 8);
  }

  private click(target: HTMLElement): void {
    const b = target.closest<HTMLButtonElement>('button');
    if (!b || !this.walker) return;
    if (b.dataset.framesKind) {
      this.kind = b.dataset.framesKind as Kind;
      this.frame = 0;
    } else if (b.dataset.framesPlay !== undefined) {
      this.playing = !this.playing;
    } else if (b.dataset.frame !== undefined) {
      this.way = b.dataset.way as IsoWay;
      this.frame = Number(b.dataset.frame);
      this.playing = false;
      // The hand workbench edits the frame under the playhead.
      const st = getWorkbenchState(this.walker);
      Object.assign(st, { animKind: this.kind, facing: this.way, frame: this.frame, playing: false });
      rerenderWorkbench(this.walker);
    } else return;
    this.loop();
    this.draw();
  }
}
