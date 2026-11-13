import type { Outline, TilePoint, WorldEditDraft } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import type { EditorCore, ToolStep } from './core.ts';
import { aimWords } from './core.ts';
import { readLand, type LandView } from './lands-io.ts';
import { drawPlan, type PlanLayers } from './plan-draw.ts';

// The Plan camera: the world editor's second way of looking, in the game
// page. Any land seen from above (even one far from where you stand), any
// floor, zoomed in or out, with the same rail, tools, inspector, land panel,
// drafts and Architect as the World camera; only the camera differs. Its
// land menu (`name="plan-land"`) lists every land, workshop lands too. The
// picture is the editor's own plan (plan-draw.ts), never game art.

/** The plan fits this many pixels across when zoomed all the way out. */
const FIT = 640;
/** The most pixels a tile gets, zoomed all the way in. */
const MOST = 32;

/** What the Plan camera needs from the editor around it. */
export interface PlanHost {
  core: EditorCore;
  token: string;
  /** The floor shown in a land. */
  floor(region: string): number;
  /** The Architect's ticked steps, the check's red places, and a change hovered in the panel, to mark. */
  marks(): { steps: WorldEditDraft[]; problems: [number, number][]; hovered?: Outline };
  /** A land was shown: the panel and drafts follow it. */
  shown(view: LandView): void;
  step(step: ToolStep): Promise<void>;
  /** Says what is under the pointer in the status strip. */
  readOut(words: string): void;
  say(words: string): void;
}

/** The Plan camera over the world, between the rail and the panel. */
export class PlanView {
  readonly el = document.createElement('div');
  view?: LandView;
  private cell = 0;
  private layers: PlanLayers = { grid: false, hitboxes: false, spots: true, people: true };
  private hover: TilePoint | null = null;
  private pan?: { x: number; y: number };
  /** The land the canvas was last built for. */
  private built = '';

  constructor(private readonly host: PlanHost) {
    this.el.className = 'editor-plan';
    this.el.hidden = true;
    this.el.addEventListener('change', (e) => this.changed(e.target as HTMLInputElement));
    this.el.addEventListener('click', (e) => {
      const zoom = (e.target as HTMLElement).closest<HTMLElement>('[data-plan-zoom]')?.dataset.planZoom;
      if (zoom) this.zoom(zoom === 'in' ? 1 : -1);
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Shows a land from above, read from the server. */
  async show(region: string): Promise<void> {
    this.el.hidden = false;
    try {
      const view = await readLand(this.host.token, region);
      if (view.region !== this.view?.region || !this.cell) this.cell = this.fitted(view);
      this.view = view;
      this.host.shown(view);
      this.build();
    } catch (err) {
      this.host.say((err as Error).message);
    }
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Reads the land shown again, after a change. */
  reload(): Promise<void> {
    return this.view && this.open ? this.show(this.view.region) : Promise.resolve();
  }

  private fitted(v: LandView): number {
    return Math.max(1, FIT / Math.max(v.map.width, v.map.height));
  }

  /** Zooms a step about the middle of what is shown. */
  zoom(direction: 1 | -1): void {
    if (!this.view) return;
    const box = this.scrollBox();
    const mid = box && { x: (box.scrollLeft + box.clientWidth / 2) / this.cell, y: (box.scrollTop + box.clientHeight / 2) / this.cell };
    this.cell = direction > 0 ? Math.min(MOST, this.cell * 1.5) : Math.max(this.fitted(this.view), this.cell / 1.5);
    this.build();
    if (mid) this.centre(mid.x, mid.y);
    this.host.say(`Zoom ${Math.round((this.cell / this.fitted(this.view)) * 100)}%.`);
  }

  /** The tile in the middle of what is shown. */
  middle(): { region: string; x: number; y: number } | undefined {
    const box = this.scrollBox();
    const v = this.view;
    if (!box || !v || !this.open) return undefined;
    const x = Math.floor((box.scrollLeft + Math.min(box.clientWidth, box.scrollWidth) / 2) / this.cell);
    const y = Math.floor((box.scrollTop + Math.min(box.clientHeight, box.scrollHeight) / 2) / this.cell);
    return { region: v.region, x: Math.min(v.map.width - 1, x), y: Math.min(v.map.height - 1, y) };
  }

  /** Scrolls a tile to the middle of what is shown. */
  centre(x: number, y: number): void {
    const box = this.scrollBox();
    if (!box) return;
    box.scrollLeft = x * this.cell - box.clientWidth / 2;
    box.scrollTop = y * this.cell - box.clientHeight / 2;
  }

  /** The pan keys scroll the plan. */
  scrollBy(dx: number, dy: number): void {
    const box = this.scrollBox();
    if (!box) return;
    box.scrollLeft += dx;
    box.scrollTop += dy;
  }

  private scrollBox(): HTMLElement | null {
    return this.el.querySelector('.plan-scroll');
  }

  /** Draws the bar (land menu, zoom, layers) and the canvas, then the plan on it. */
  private build(): void {
    const v = this.view;
    if (!v) return;
    const option = (id: string, name: string) => `<option value="${escapeHtml(id)}"${id === v.region ? ' selected' : ''}>${escapeHtml(name)}</option>`;
    const layer = (key: keyof PlanLayers, label: string) => `<label class="check"><input type="checkbox" name="plan-layer" value="${key}"${this.layers[key] ? ' checked' : ''} /> ${label}</label>`;
    const fit = this.fitted(v);
    // Drawn again after a change, the plan stays where it was scrolled to.
    const box = this.scrollBox();
    const kept = box && this.built === v.region ? [box.scrollLeft, box.scrollTop] : undefined;
    this.built = v.region;
    this.el.innerHTML = `<div class="plan-bar">
        <label>Land <select name="plan-land">${v.regions.map((r) => option(r.id, `${r.name}${r.workshop ? ' (workshop)' : ''}`)).join('')}</select></label>
        <span class="seg"><button type="button" class="quiet" data-plan-zoom="out"${this.cell <= fit ? ' disabled' : ''} aria-label="Zoom out">−</button><span class="zoom">${Math.round((this.cell / fit) * 100)}%</span><button type="button" class="quiet" data-plan-zoom="in"${this.cell >= MOST ? ' disabled' : ''} aria-label="Zoom in">+</button></span>
        ${layer('grid', 'Tiles')}${layer('hitboxes', 'Hitboxes')}${layer('spots', 'Spots')}${layer('people', 'People')}
      </div>
      <div class="plan-scroll"><canvas width="${Math.ceil(v.map.width * this.cell)}" height="${Math.ceil(v.map.height * this.cell)}"></canvas></div>`;
    this.wire(this.el.querySelector('canvas')!);
    if (kept) [this.scrollBox()!.scrollLeft, this.scrollBox()!.scrollTop] = kept;
    this.draw();
  }

  /** Draws the plan again: after a pointer move, a setting, or new marks. */
  draw(): void {
    const v = this.view;
    const canvas = this.el.querySelector('canvas');
    if (!v || !canvas || !this.open) return;
    const floor = this.host.floor(v.region);
    const marks = this.host.marks();
    drawPlan(canvas, {
      map: v.map, floor, cell: this.cell, layers: this.layers, steps: marks.steps, problems: marks.problems,
      outlines: [...(marks.hovered ? [marks.hovered] : []), ...(this.hover ? this.host.core.outlines(v.region, v.map, this.hover, floor) : [])],
    });
  }

  private changed(input: HTMLInputElement): void {
    if (input.name === 'plan-land') void this.show(input.value);
    else if (input.name === 'plan-layer') {
      this.layers[input.value as keyof PlanLayers] = input.checked;
      this.draw();
    }
  }

  /** The pointer on the plan: tools on the left button, a right or middle drag pans, the wheel zooms. */
  private wire(canvas: HTMLCanvasElement): void {
    const tileOf = (e: MouseEvent): TilePoint | null => {
      const map = this.view?.map;
      if (!map) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * map.width);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * map.height);
      return x >= 0 && y >= 0 && x < map.width && y < map.height ? [x, y] : null;
    };
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? -1 : 1);
    };
    canvas.onmousemove = (e) => {
      const v = this.view;
      if (this.pan) {
        const box = this.scrollBox()!;
        box.scrollLeft -= e.clientX - this.pan.x;
        box.scrollTop -= e.clientY - this.pan.y;
        this.pan = { x: e.clientX, y: e.clientY };
        return;
      }
      this.hover = tileOf(e);
      if (!v || !this.hover) return this.host.readOut('');
      const floor = this.host.floor(v.region);
      if (e.buttons & 1) this.host.core.drag(v.region, v.map, this.hover);
      const aim = e.buttons ? undefined : this.host.core.aimAt(v.map, this.hover, floor);
      this.host.readOut(aimWords(aim, v.map, this.hover, floor));
      this.draw();
    };
    canvas.onmousedown = (e) => {
      if (e.button !== 0) {
        this.pan = { x: e.clientX, y: e.clientY };
        return;
      }
      const at = tileOf(e);
      const v = this.view;
      if (at && v) void this.host.step(this.host.core.press(v.region, v.map, at, this.host.floor(v.region)));
    };
    canvas.onmouseup = (e) => {
      if (this.pan) {
        this.pan = undefined;
        return;
      }
      if (e.button === 0) void this.host.step(this.host.core.release());
    };
    canvas.onmouseleave = () => {
      this.pan = undefined;
      this.hover = null;
      void this.host.step(this.host.core.release());
      this.draw();
    };
  }
}
