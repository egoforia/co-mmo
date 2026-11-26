// The Studio's canvas: an asset standing on its tiles exactly as the game
// stands it (standing() in tile-stand.ts), on its land's own painted ground,
// with a painted player beside it for size, lit at the hour chosen with the
// game's own sums (light-preview.ts). Zoom 50 to 400 %, drag to pan, and the
// pixel under the pointer read out. The tile outlines are an editor overlay,
// as the world editor's Hitboxes layer: only the Owner sees them.

import { CHARACTER_HEIGHT, PREVIEW_HOURS, biomeLook, type ArtManifest, type AssetFit, type BiomeId } from '@co-mmo/shared';
import { groundLight, litPicture } from '../light-preview.ts';
import { workedOutNormalMap } from '../normal-preview.ts';
import { PROJECTION } from '../projection.ts';
import { fittedAt, standing, type Floor } from '../tile-stand.ts';
import { escapeHtml } from '../ui.ts';
import type { StudioAsset } from './browser.ts';
import type { FitDraft } from './fit-tool.ts';

/** Groups the canvas can stand on tiles. */
export const CANVAS_GROUPS = ['pieces', 'spots', 'stairs', 'scenery', 'characters', 'monsters'];
/** Zoom steps, in percent. */
export const ZOOMS = [50, 75, 100, 150, 200, 300, 400];
/** The player standing beside the asset for size. */
const FIGURE = 'player-mara';
/** Tiles of ground around the asset's own. */
const MARGIN = 2;

/** The tiles an asset stands on in the canvas: its footprint, or one tile. */
export function canvasFloor(a: Pick<StudioAsset, 'footprint'>): Floor {
  const w = Math.max(1, Math.ceil(a.footprint?.width ?? 1));
  const h = Math.max(1, Math.ceil(a.footprint?.height ?? 1));
  return { left: 0, top: 0, right: w, bottom: h };
}

/** Where a picture lies as the game stands it, moved by its fit: in canvas world pixels, with its anchor. */
export function pictureBox(
  floor: Floor,
  size: { width: number; height: number },
  fitted: boolean,
  fit?: Pick<AssetFit, 'offset' | 'scale'>,
): { x: number; y: number; width: number; height: number; scale: number; anchor: { x: number; y: number } } {
  const plan = standing(floor, size, fitted);
  const at = fittedAt(plan, fit);
  const width = size.width * at.scale;
  const height = size.height * at.scale;
  return { x: at.x - width / 2, y: at.y - height * plan.originY, width, height, scale: at.scale, anchor: { x: at.x, y: at.y } };
}

/** The next zoom step in or out from `now`. */
export function nextZoom(now: number, dir: 1 | -1): number {
  const i = ZOOMS.findIndex((z) => z >= now);
  const at = i < 0 ? ZOOMS.length - 1 : i;
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS[at] === now ? at + dir : dir > 0 ? at : at - 1))]!;
}

const loaded = new Map<string, Promise<HTMLImageElement | HTMLCanvasElement | undefined>>();

function image(url: string | undefined): Promise<HTMLImageElement | undefined> {
  if (!url) return Promise.resolve(undefined);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img, () => undefined);
}

/** A picture, lit at `hour` when one is chosen; loaded once per page. */
function picture(url: string | undefined, hour: number | undefined, figure: boolean): Promise<HTMLImageElement | HTMLCanvasElement | undefined> {
  if (!url) return Promise.resolve(undefined);
  const key = `${url}@${hour ?? 'unlit'}`;
  let p = loaded.get(key);
  if (!p) {
    p = hour === undefined ? image(url) : workedOutNormalMap(url).then((n) => litPicture(url, n, hour, figure)).catch(() => image(url));
    loaded.set(key, p);
  }
  return p;
}

/** The canvas workspace for one asset. */
export class StudioCanvas {
  private zoom = 100;
  private pan = { x: 0, y: 0 };
  private hour: number | undefined;
  private canvas!: HTMLCanvasElement;
  private readout!: HTMLElement;
  private box: ReturnType<typeof pictureBox> | undefined;
  private art: { asset?: HTMLImageElement | HTMLCanvasElement; ground?: HTMLImageElement; figure?: HTMLImageElement | HTMLCanvasElement } = {};

  constructor(
    private readonly el: HTMLElement,
    private readonly asset: StudioAsset,
    private readonly manifest: ArtManifest,
    /** The fit being changed, when the picture can be fitted; dragging it moves the picture. */
    private readonly draft?: FitDraft,
    private readonly changed: () => void = () => {},
  ) {}

  /** Draws the canvas and its bar, and wires zoom, pan, light and the readout. */
  async mount(): Promise<void> {
    const hours = [['', 'As painted'], ...PREVIEW_HOURS.map((h) => [String(h.hour), h.label])];
    this.el.innerHTML = `
      <div class="canvas-bar">
        <b>${escapeHtml(this.asset.name)}</b>
        <span class="note">on its tiles at game size</span>
        <span class="canvas-light" role="group" aria-label="Light">${hours.map(([v, l]) => `<button type="button" data-hour="${v}" aria-pressed="${v === ''}">${l}</button>`).join('')}</span>
        <span class="canvas-zoom"><button type="button" data-zoom="-1" aria-label="Zoom out">−</button><output>100 %</output><button type="button" data-zoom="1" aria-label="Zoom in">+</button></span>
        <output class="canvas-readout"></output>
      </div>
      <canvas class="studio-canvas" aria-label="${escapeHtml(this.asset.name)} on its tiles"></canvas>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.readout = this.el.querySelector('.canvas-readout')!;
    this.wire();
    await this.load();
    this.draw();
  }

  /** Says on the canvas which light it was last drawn in, for tests and screenshots to wait on. */
  private drawn(): void {
    this.canvas.dataset.lit = this.hour === undefined ? 'none' : String(this.hour);
  }

  private async load(): Promise<void> {
    const ground = this.asset.land ? biomeLook(this.asset.land as BiomeId)?.ground : undefined;
    const file = (id: string | undefined) => (id && this.manifest[id] ? `/${this.manifest[id]!.file}` : undefined);
    const walker = this.asset.group === 'characters' || this.asset.group === 'monsters';
    [this.art.asset, this.art.ground, this.art.figure] = await Promise.all([
      picture(this.asset.thumb ?? file(this.asset.id), this.hour, walker),
      image(file(ground ?? 'sanctum-meadow')),
      walker ? Promise.resolve(undefined) : picture(file(FIGURE), this.hour, true),
    ]);
  }

  private wire(): void {
    const bar = this.el.querySelector('.canvas-bar')!;
    bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.dataset.zoom) this.setZoom(nextZoom(this.zoom, Number(b.dataset.zoom) as 1 | -1));
      if (b.dataset.hour !== undefined) {
        this.hour = b.dataset.hour ? Number(b.dataset.hour) : undefined;
        for (const x of bar.querySelectorAll('[data-hour]')) x.setAttribute('aria-pressed', String(x === b));
        void this.load().then(() => this.draw());
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(nextZoom(this.zoom, e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    // Dragging the picture moves it (the Offset tool); dragging anywhere else pans.
    let drag: { x: number; y: number; move?: { offset: [number, number] } } | undefined;
    this.canvas.addEventListener('pointerdown', (e) => {
      const onPicture = this.draft && this.box && this.inside(this.world(e), this.box);
      if (onPicture) this.draft!.mark();
      drag = onPicture ? { x: e.clientX, y: e.clientY, move: { offset: [...this.draft!.state.offset] } } : { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (drag && this.canvas.hasPointerCapture(e.pointerId)) {
        if (drag.move && this.draft && this.box) {
          // Screen pixels to picture pixels: through the zoom, then the picture's own drawn size.
          const per = (this.zoom / 100) * this.box.scale;
          this.draft.set({ ...this.draft.state, offset: [drag.move.offset[0] + (e.clientX - drag.x) / per, drag.move.offset[1] + (e.clientY - drag.y) / per] }, false);
          this.changed();
        } else this.pan = { x: e.clientX - drag.x, y: e.clientY - drag.y };
        this.draw();
      }
      this.read(e);
    });
    this.canvas.addEventListener('pointerup', () => (drag = undefined));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  private setZoom(zoom: number): void {
    this.zoom = zoom;
    this.el.querySelector('.canvas-zoom output')!.textContent = `${zoom} %`;
    this.draw();
  }

  /** Canvas pixels to world pixels: the asset's tiles' middle sits at the canvas middle, moved by the pan. */
  private origin(): { x: number; y: number; s: number } {
    const floor = canvasFloor(this.asset);
    const mid = PROJECTION.toScreen((floor.right) / 2, (floor.bottom) / 2);
    const s = (this.zoom / 100) * devicePixelRatio;
    return { x: this.canvas.width / 2 + this.pan.x * devicePixelRatio - mid.x * s, y: this.canvas.height * 0.62 + this.pan.y * devicePixelRatio - mid.y * s, s };
  }

  /** The world pixel under the pointer. */
  private world(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const o = this.origin();
    return { x: ((e.clientX - r.left) * devicePixelRatio - o.x) / o.s, y: ((e.clientY - r.top) * devicePixelRatio - o.y) / o.s };
  }

  private inside(p: { x: number; y: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    return p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
  }

  private read(e: PointerEvent): void {
    const { x: wx, y: wy } = this.world(e);
    const b = this.box;
    if (b && this.inside({ x: wx, y: wy }, b)) {
      this.readout.textContent = `picture x ${Math.floor((wx - b.x) / b.scale)} · y ${Math.floor((wy - b.y) / b.scale)}`;
    } else this.readout.textContent = '';
  }

  /** Draws ground, outlines, figure and asset. */
  draw(): void {
    const c = this.canvas;
    const w = Math.round(c.clientWidth * devicePixelRatio);
    const h = Math.round(c.clientHeight * devicePixelRatio);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const o = this.origin();
    const floor = canvasFloor(this.asset);
    const half = { x: PROJECTION.toScreen(1, 0).x, y: PROJECTION.toScreen(1, 0).y };
    // The land's ground, each square texture laid on a diamond as the game lays it.
    const ground = this.art.ground;
    for (let ty = -MARGIN; ty < floor.bottom + MARGIN; ty++) {
      for (let tx = -MARGIN; tx < floor.right + MARGIN; tx++) {
        const at = PROJECTION.toScreen(tx, ty);
        g.setTransform(half.x * o.s, half.y * o.s, -half.x * o.s, half.y * o.s, o.x + at.x * o.s, o.y + at.y * o.s);
        // A hair over a tile each, so no seam shows between them.
        if (ground) g.drawImage(ground, -0.005, -0.005, 1.01, 1.01);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.hour !== undefined) {
      // The hour's light on the ground only, not the empty canvas around it.
      const [l, t, r, b] = [-MARGIN, -MARGIN, floor.right + MARGIN, floor.bottom + MARGIN];
      g.save();
      g.beginPath();
      [[l, t], [r, t], [r, b], [l, b]].map(([x, y]) => PROJECTION.toScreen(x!, y!)).forEach((p, i) => (i ? g.lineTo(o.x + p.x * o.s, o.y + p.y * o.s) : g.moveTo(o.x + p.x * o.s, o.y + p.y * o.s)));
      g.closePath();
      g.clip();
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = groundLight(this.hour);
      g.fillRect(0, 0, w, h);
      g.restore();
    }
    // The asset's own tiles, outlined (editor overlay).
    const diamond = (tx: number, ty: number) => {
      const pts = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]].map(([x, y]) => PROJECTION.toScreen(x!, y!));
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(o.x + p.x * o.s, o.y + p.y * o.s) : g.moveTo(o.x + p.x * o.s, o.y + p.y * o.s)));
      g.closePath();
      g.stroke();
    };
    g.strokeStyle = 'rgba(242, 220, 107, 0.85)';
    g.lineWidth = Math.max(1, devicePixelRatio);
    for (let ty = floor.top; ty < floor.bottom; ty++) for (let tx = floor.left; tx < floor.right; tx++) diamond(tx, ty);
    // A player one tile to the front left, for size.
    const fig = this.art.figure;
    if (fig) {
      const scale = CHARACTER_HEIGHT / fig.height;
      const feet = PROJECTION.toScreen(-0.5, floor.bottom + 0.5);
      g.drawImage(fig, o.x + (feet.x - (fig.width * scale) / 2) * o.s, o.y + (feet.y - fig.height * scale * 0.95) * o.s, fig.width * scale * o.s, fig.height * scale * o.s);
    }
    const art = this.art.asset;
    if (!art) {
      this.box = undefined;
      g.fillStyle = '#c0cbdc';
      g.font = `${14 * devicePixelRatio}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText('Not painted yet', w / 2, h * 0.4);
      return;
    }
    const walker = this.asset.group === 'characters' || this.asset.group === 'monsters';
    const size = { width: art.width, height: art.height };
    const box = walker
      ? (() => {
          const scale = this.asset.group === 'characters' ? CHARACTER_HEIGHT / art.height : 1;
          const feet = PROJECTION.toScreen(0.5, 0.5);
          return { x: feet.x - (art.width * scale) / 2, y: feet.y - art.height * scale * 0.95, width: art.width * scale, height: art.height * scale, scale, anchor: feet };
        })()
      : pictureBox(floor, size, this.manifest[this.asset.id]?.view === 'isometric', this.draft?.fit);
    this.box = box;
    g.drawImage(art, o.x + box.x * o.s, o.y + box.y * o.s, box.width * o.s, box.height * o.s);
    // The picture's anchor, the point it stands on (editor overlay).
    if (this.draft) {
      const [ax, ay] = [o.x + box.anchor.x * o.s, o.y + box.anchor.y * o.s];
      const r = 7 * devicePixelRatio;
      g.strokeStyle = 'rgba(254, 174, 52, 0.95)';
      g.beginPath();
      g.moveTo(ax - r, ay);
      g.lineTo(ax + r, ay);
      g.moveTo(ax, ay - r);
      g.lineTo(ax, ay + r);
      g.stroke();
    }
    this.drawn();
  }
}
