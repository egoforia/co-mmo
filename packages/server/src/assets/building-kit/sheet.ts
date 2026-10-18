import { buildingKit } from '@co-mmo/shared';
import { blank, png, resized, type Img } from './pixels.ts';

type KitLook = buildingKit.KitLook;
type KitSizes = buildingKit.KitSizes;
const { K, TILE, arch } = buildingKit;

// The kit's texture sheet: an exact layout the image model paints into. The
// layout is a magenta sheet with green shapes at exact places and sizes;
// players never see it, it only steers the model, like the pose guides. The
// model paints each shape flat and square-on, and the sheet checks then
// measure every shape. A texture that fails can be painted again on its own:
// each painting carries its own layout.

/** What the sharp image model returns for 16:9 at 2K. */
export const SHEET = [2752, 1536] as const;
/** How far round each shape the place and spill checks look. */
export const MARGIN = 50;
export const MAGENTA = [255, 0, 255] as const;
export const GREEN = [0, 255, 0] as const;

/** One texture's place on the sheet and what it covers in the kit. */
export interface SheetRegion {
  name: string;
  /** x, y, width, height in sheet pixels. */
  box: [number, number, number, number];
  /** Fitted once to a face (a door, a window), or tiled across faces. */
  kind: 'fit' | 'tile';
  shape: 'rect' | 'arch';
  /** What the painted shape covers in kit units, across and up. */
  world: [number, number];
  /** Rows by design (boards, shingles): brightness is judged only across the rows. */
  rowsByDesign: boolean;
  /** Rows whose joints are offset row to row: a tile must keep two rows. */
  stagger: boolean;
}

export type SheetLayout = Record<string, SheetRegion>;

/** Each texture's place on the sheet, its shape, and what one painted shape means in kit units. */
export function regions(k: KitSizes = K): SheetLayout {
  const bay = 1 - k.post;
  const wallH = k.H - k.plateH;
  const fitWorld: Record<string, [number, number]> = { panel: [bay, wallH], inside: [bay, wallH], door: [k.doorW, k.doorH], window: [k.winW, k.winH] };
  const R: SheetLayout = {};
  const put = (name: string, x: number, y: number, w: number, h: number, kind: 'fit' | 'tile', shape: 'rect' | 'arch' = 'rect', world?: readonly [number, number]) => {
    R[name] = {
      name, box: [Math.trunc(x), Math.trunc(y), Math.round(w), Math.round(h)], kind, shape,
      world: world ? [world[0], world[1]] : fitWorld[name]!,
      rowsByDesign: name !== 'plaster',
      stagger: ['floor', 'roof', 'stone'].includes(name),
    };
  };
  const d = 460;
  const row1: [string, number, number, 'fit' | 'tile', 'rect' | 'arch'][] = [
    ['panel', bay * d, wallH * d, 'fit', 'rect'], // one storey of wall between two posts
    ['inside', bay * d, wallH * d, 'fit', 'rect'],
    ['door', (k.doorW / k.doorH) * wallH * d, wallH * d, 'fit', 'arch'], // as tall as the panels: the model lines shapes up
    ['window', k.winW * d * 1.6, k.winH * d * 1.6, 'fit', 'rect'],
    ['plaster', 420, 420, 'tile', 'rect'],
  ];
  let gap = (SHEET[0] - row1.reduce((n, r) => n + r[1], 0)) / (row1.length + 1);
  let x = gap;
  for (const [n, w, h, kind, shape] of row1) {
    put(n, x, 70, w, h, kind, shape, TILE[n]);
    x += w + gap;
  }
  gap = (SHEET[0] - (540 + 810 + 750)) / 4;
  x = gap;
  put('floor', x, 880, 540, 540, 'tile', 'rect', TILE.floor);
  x += 540 + gap;
  put('roof', x, 880, 810, 540, 'tile', 'rect', TILE.roof);
  x += 810 + gap;
  put('stone', x, 880, 750, 280, 'tile', 'rect', [(TILE.stone![0] * 750) / 560, TILE.stone![1]]); // as wide as the timber under it
  put('timber', x, 1270, 750, 175, 'tile', 'rect', TILE.timber);
  // every shape keeps a wide band of magenta round it, wider than the place check looks
  for (const a of Object.values(R)) {
    for (const b of Object.values(R)) {
      if (a === b) continue;
      const [[x1, y1, w1, h1], [x2, y2, w2, h2]] = [a.box, b.box];
      if (Math.max(Math.max(x2 - (x1 + w1), x1 - (x2 + w2)), Math.max(y2 - (y1 + h1), y1 - (y2 + h2))) < 2 * MARGIN) throw new Error(`sheet layout: ${a.name} and ${b.name} are too close`);
    }
    const [bx, by, bw, bh] = a.box;
    if (bx < MARGIN || by < MARGIN || bx + bw > SHEET[0] - MARGIN || by + bh > SHEET[1] - MARGIN) throw new Error(`sheet layout: ${a.name} is too near the edge`);
  }
  return R;
}

/** A region's outline in sheet pixels: its box, or a round-topped arch standing in it. */
export function shapePoly(r: SheetRegion, k: KitSizes = K): [number, number][] {
  const [x, y, w, h] = r.box;
  if (r.shape !== 'arch') return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const tall = k.doorH / k.doorW;
  return arch(0, 1, 0, tall, k.doorFacets).map(([px, py]) => [x + px * w, y + h - (py * h) / tall]);
}

/**
 * Sets the pixels inside a convex outline, the way the prototype's drawing
 * filled them (corners cut to whole pixels, edge pixels included), so masks
 * and guides match the paintings already checked.
 */
export function fillConvex(poly: [number, number][], W: number, H: number, set: (x: number, y: number) => void): void {
  const P = poly.map(([x, y]) => [Math.trunc(x), Math.trunc(y)] as const);
  const ys = P.map((p) => p[1]);
  for (let y = Math.max(0, Math.min(...ys)); y <= Math.min(H - 1, Math.max(...ys)); y++) {
    let [lo, hi] = [Infinity, -Infinity];
    P.forEach(([x0, y0], i) => {
      const [x1, y1] = P[(i + 1) % P.length]!;
      if (y0 === y1 || y < Math.min(y0, y1) || y > Math.max(y0, y1)) return;
      const xc = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
      [lo, hi] = [Math.min(lo, xc), Math.max(hi, xc)];
    });
    if (lo > hi) continue;
    const [s, e] = [Math.floor(lo + 0.5), Math.ceil(hi - 0.5)];
    for (let x = Math.max(0, s); x <= Math.min(W - 1, e); x++) set(x, y);
  }
}

/**
 * A layout for painting only some textures again: one alone is centred and
 * made as large as the sheet allows (more detail, same proportions); several
 * keep their places.
 */
export function repaintLayout(names: string[], R: SheetLayout = regions()): SheetLayout {
  const out: SheetLayout = Object.fromEntries(names.map((n) => [n, { ...R[n]!, box: [...R[n]!.box] as SheetRegion['box'] }]));
  if (names.length === 1) {
    const r = out[names[0]!]!;
    const [, , w, h] = r.box;
    const k = Math.min((SHEET[0] - 6 * MARGIN) / w, (SHEET[1] - 6 * MARGIN) / h);
    const [W, H] = [Math.trunc(w * k), Math.trunc(h * k)];
    r.box = [Math.floor((SHEET[0] - W) / 2), Math.floor((SHEET[1] - H) / 2), W, H];
  }
  return out;
}

const NTH = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/** How to point at a shape on the guide in words: its kind of shape and where it is. */
function where(r: SheetRegion, R: SheetLayout): string {
  const [x, y, w, h] = r.box;
  const kind = r.shape === 'arch' ? 'round-topped arch' : w > 3 * h ? 'long thin strip' : w > 1.25 * h ? 'wide rectangle' : h > 1.25 * w ? 'tall rectangle' : 'square';
  const all = Object.values(R);
  if (all.length === 1) return `The green ${kind} in the middle of the picture`;
  const isTop = (q: SheetRegion) => q.box[1] < SHEET[1] / 2;
  const twoRows = new Set(all.map(isTop)).size > 1;
  const top = isTop(r);
  const row = all.filter((q) => isTop(q) === top);
  const cols = [...new Set(row.map((q) => q.box[0]))].sort((a, b) => a - b); // shapes stacked in one column count once
  const rowName = top ? 'top' : 'bottom';
  if (cols.length === 1) {
    // alone in its row: say where across the sheet
    const c = (x + w / 2) / SHEET[0];
    return `The ${kind} in the ${rowName} row, ${c < 0.36 ? 'on the left' : c < 0.64 ? 'in the middle' : 'on the right'}`;
  }
  const stacked = row.filter((q) => q.box[0] === x).map((q) => q.box[1]).sort((a, b) => a - b);
  const place = `${twoRows ? `in the ${rowName} row, ` : ''}${NTH[cols.indexOf(x)]} from the left${stacked.length === 1 ? '' : y === stacked[0] ? ', the upper one' : ', the lower one'}`;
  return `The ${kind} ${place}`;
}

/**
 * The exact words sent with a guide: what the guide is, the style, then each
 * shape and what to paint in it. An edit guide is an earlier painting with
 * some shapes turned green again: only those get painted.
 */
export function sheetPrompt(R: SheetLayout, look: KitLook, style: string, opts: { note?: string; edit?: boolean } = {}): string {
  const shapes = Object.values(R);
  const order = [...shapes].sort((a, b) => Number(a.box[1] >= SHEET[1] / 2) - Number(b.box[1] >= SHEET[1] / 2) || a.box[0] - b.box[0]);
  const one = shapes.length === 1;
  const head = opts.edit
    ? `This picture is a finished game texture sheet with ${one ? 'one green shape' : `${shapes.length} green shapes`} still to paint. ` +
      `Paint only inside the green ${one ? 'shape' : 'shapes'}: fill ${one ? 'it' : 'each'} completely, right to ${one ? 'its' : 'their'} exact edges, with the texture described below. ` +
      'Keep everything else in the picture exactly as it is: the magenta background and every texture already painted stay untouched, in the same places. ' +
      `Do not move, shrink, enlarge or round the green ${one ? 'shape' : 'shapes'}, and leave no green anywhere.`
    : 'This picture is a layout guide for a game texture sheet. Repaint it as the finished sheet: keep the magenta background exactly as it is, and fill every green shape completely, ' +
      'right to its exact edges, with the texture described for it below. Keep every shape exactly where it is and exactly its size and outline; do not move, shrink, enlarge or round any shape. ' +
      'Paint nothing outside the green shapes and leave no green anywhere.';
  const parts = [head, style + (opts.edit ? ' Match the textures already painted on the sheet.' : '')];
  const ctx = opts.edit ? { ...regions(), ...R } : R; // on an earlier painting, shapes are found among all the others
  order.forEach((r, i) => {
    const words = opts.edit ? where(r, ctx).replace('The ', 'The green ') : where(r, ctx);
    parts.push(`${i + 1}. ${words}: ${look.words[r.name as buildingKit.KitTexture]}`);
  });
  const tiles = order.flatMap((r, i) => (r.kind === 'tile' ? [i + 1] : []));
  if (tiles.length) {
    const subject = tiles.length > 1 ? `Textures ${tiles.join(', ')} are` : order.length === 1 ? 'This texture is' : `Texture ${tiles[0]} is`;
    parts.push(`${subject} repeated side by side and one above another in the game, so keep every shape the same size all over and the lines between rows and shapes the same thickness all over.`);
  }
  if (opts.note) parts.push(opts.note);
  return parts.join('\n\n');
}

/** A guide picture and the words sent with it. */
export interface SheetGuide {
  picture: Buffer;
  layout: SheetLayout;
  prompt: string;
}

/**
 * The guide picture, its layout (so its painting is read at the right
 * places) and the exact prompt. Over an earlier painting, the shapes to
 * paint again are turned green on it and the rest is kept: the model then
 * edits one sheet it can match, instead of facing a mostly empty one.
 */
export async function sheetGuide(R: SheetLayout, look: KitLook, style: string, opts: { note?: string; over?: Img } = {}): Promise<SheetGuide> {
  const over = opts.over && (opts.over.w !== SHEET[0] || opts.over.h !== SHEET[1] ? await resized(opts.over, SHEET[0], SHEET[1]) : opts.over);
  const im = over ? { w: over.w, h: over.h, d: over.d.slice() } : blank(SHEET[0], SHEET[1], MAGENTA);
  const paint = (x: number, y: number, rgb: readonly number[]) => im.d.set(rgb, (y * im.w + x) * 3);
  for (const r of Object.values(R)) {
    const [x, y, w, h] = r.box;
    if (over) for (let yy = Math.max(0, y - 12); yy <= Math.min(im.h - 1, y + h + 12); yy++) for (let xx = Math.max(0, x - 12); xx <= Math.min(im.w - 1, x + w + 12); xx++) paint(xx, yy, MAGENTA);
    fillConvex(shapePoly(r), im.w, im.h, (px, py) => paint(px, py, GREEN));
  }
  return { picture: await png(im), layout: R, prompt: sheetPrompt(R, look, style, { note: opts.note, edit: Boolean(over) }) };
}
