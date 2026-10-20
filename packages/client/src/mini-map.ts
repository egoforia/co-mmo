import type { RegionMap } from '@co-mmo/shared';
import { PROJECTION } from './projection.ts';
import { floorPlan, PLAN_PIXELS, type PlanPiece } from './mini-map-art.ts';
import { MAP_ZOOMS, MAP_ZOOM_START, floorsAt, mapCaption, mapTransform, nextZoom, onMap, peekStep } from './mini-map-plan.ts';
import { isTyping } from './ui.ts';
import type { MiniMapView } from './world-scene.ts';

// The mini map in the corner: the floor you are on, centred on you, turned
// the way the camera sees the world. Its buttons zoom in and out and look at
// the other floors of where you stand (only look: you stay where you are).
// M or the HUD's Map button shows and hides it.

/** How often the map is drawn again, in milliseconds: often enough to follow a walk. */
const REDRAW_MS = 100;
/** How tall people are drawn on the map, in its pixels: you a little bigger, so you stand out. */
const FIGURE_PX = { me: 22, player: 15, npc: 13, creature: 13 } as const;
/** How much the land below shows through around a floor above it. */
const BELOW_ALPHA = 0.4;

const SAVED = 'co-mmo.mini-map';

export interface MiniMapOptions {
  /** The scene's view of our floor, when there is one. */
  view: () => MiniMapView | undefined;
}

/** The mini map's window, its buttons and its drawing. */
export class MiniMap {
  private readonly root = document.getElementById('mini-map')!;
  private readonly canvas = this.root.querySelector('canvas')!;
  private readonly caption = this.root.querySelector<HTMLElement>('.mm-caption')!;
  private readonly back = this.root.querySelector<HTMLButtonElement>('[data-act="back"]')!;
  private readonly button = document.getElementById('map-button') as HTMLButtonElement;
  private zoom = MAP_ZOOM_START;
  /** The floor we are looking at instead of our own, if any. */
  private looking: number | undefined;
  /** The floor we were on last time, so looking elsewhere stops when we take the stairs. */
  private mine = 0;
  private plans = new Map<number, PlanPiece[]>();
  private planned?: { map: RegionMap; art: number };
  private timer?: number;

  constructor(private readonly options: MiniMapOptions) {
    const saved = load();
    this.zoom = saved.zoom;
    this.button.hidden = false;
    this.button.addEventListener('click', () => this.toggle());
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.act;
      if (act) this.act(act);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'm' && !isTyping() && !e.ctrlKey && !e.metaKey && !e.altKey) this.toggle();
    });
    this.toggle(saved.open);
  }

  /** Shows or hides the map (flips it when not said). */
  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('has-mini-map', open);
    clearInterval(this.timer);
    if (open) {
      this.timer = window.setInterval(() => this.draw(), REDRAW_MS);
      this.draw();
    }
    save({ open, zoom: this.zoom });
  }

  private act(act: string): void {
    const view = this.options.view();
    if (act === 'in' || act === 'out') {
      this.zoom = nextZoom(this.zoom, act === 'in' ? 1 : -1);
      save({ open: true, zoom: this.zoom });
    } else if (view && (act === 'up' || act === 'down')) {
      const me = view.figures[0]!;
      const next = peekStep(floorsAt(view.map, me.x, me.y, view.floor), this.looking ?? view.floor, act === 'up' ? 1 : -1);
      this.looking = next === view.floor ? undefined : next;
    } else if (act === 'back') this.looking = undefined;
    this.draw();
  }

  /** Draws the floor looked at, around us, with everyone on it we can see. */
  private draw(): void {
    const view = this.options.view();
    if (!view) return;
    const me = view.figures[0]!;
    if (view.floor !== this.mine) this.looking = undefined;
    this.mine = view.floor;
    const floors = floorsAt(view.map, me.x, me.y, view.floor);
    if (this.looking !== undefined && !floors.includes(this.looking)) this.looking = undefined;
    const looking = this.looking ?? view.floor;
    this.buttons(floors, looking);
    this.caption.textContent = mapCaption(looking, view.floor);
    this.back.hidden = looking === view.floor;

    const size = this.fitCanvas();
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const step = MAP_ZOOMS[this.zoom]! * (window.devicePixelRatio || 1);
    const t = mapTransform(PROJECTION.ground.kind, step, me.x, me.y, size);
    ctx.setTransform(...t);
    // Shrunk, the painted tiles blend smoothly; grown, they keep their edges.
    ctx.imageSmoothingEnabled = step < PLAN_PIXELS;
    // Upstairs, the land shows below around the floor, as in the world; underground it is out of sight.
    if (looking > 0) {
      ctx.globalAlpha = BELOW_ALPHA;
      this.drawPieces(ctx, view, 0);
      ctx.globalAlpha = 1;
    }
    this.drawPieces(ctx, view, looking);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const dpr = window.devicePixelRatio || 1;
    // On another floor we only look: who is there is out of sight, and we are shown faintly where we stand.
    const shown = looking === view.floor ? [...view.figures.slice(1), me] : [me];
    ctx.globalAlpha = looking === view.floor ? 1 : 0.5;
    for (const f of shown) {
      if (!view.scene.textures.exists(f.art)) continue;
      const img = view.scene.textures.get(f.art).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const at = onMap(t, f.x, f.y);
      const h = FIGURE_PX[f.kind] * dpr;
      const w = (h * img.width) / Math.max(1, img.height);
      if (at.x < -w || at.y < 0 || at.x > size + w || at.y > size + h) continue;
      ctx.drawImage(img, at.x - w / 2, at.y - h, w, h);
    }
    ctx.globalAlpha = 1;
  }

  private drawPieces(ctx: CanvasRenderingContext2D, view: MiniMapView, floor: number): void {
    for (const p of this.plan(view, floor)) ctx.drawImage(p.canvas, p.x, p.y, p.width, p.height);
  }

  /** A floor's picture, put together once for each layout of the land and again when more art is painted. */
  private plan(view: MiniMapView, floor: number): PlanPiece[] {
    if (this.planned?.map !== view.map || this.planned.art !== view.artLoaded) {
      this.plans.clear();
      this.planned = { map: view.map, art: view.artLoaded };
    }
    let pieces = this.plans.get(floor);
    if (!pieces) {
      pieces = floorPlan(view.scene, view.map, floor);
      this.plans.set(floor, pieces);
    }
    return pieces;
  }

  /** The up and down buttons work only while there is a floor that way, and zoom stops at its ends. */
  private buttons(floors: number[], looking: number): void {
    const set = (act: string, on: boolean) => {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
      if (b) b.disabled = !on;
    };
    set('up', peekStep(floors, looking, 1) !== looking);
    set('down', peekStep(floors, looking, -1) !== looking);
    set('in', this.zoom < MAP_ZOOMS.length - 1);
    set('out', this.zoom > 0);
  }

  /** Sizes the canvas to its box in real pixels, so it stays sharp; returns its width. */
  private fitCanvas(): number {
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(this.canvas.clientWidth * dpr) || 1;
    if (this.canvas.width !== size || this.canvas.height !== size) {
      this.canvas.width = size;
      this.canvas.height = size;
    }
    return size;
  }
}

/** Whether the map was open and how near it looked, as this browser last left it. */
function load(): { open: boolean; zoom: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? '{}') as { open?: boolean; zoom?: number };
    const zoom = typeof saved.zoom === 'number' && MAP_ZOOMS[saved.zoom] !== undefined ? saved.zoom : MAP_ZOOM_START;
    return { open: saved.open ?? true, zoom };
  } catch {
    return { open: true, zoom: MAP_ZOOM_START };
  }
}

function save(state: { open: boolean; zoom: number }): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(state));
  } catch {
    // Without storage the map simply starts open next time.
  }
}
