import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildingKit } from '@co-mmo/shared';
import { KitSheets } from '../src/assets/building-kit/kit-sheets.ts';
import { crop, readImg, roll, rowsOf, stack, type Img } from '../src/assets/building-kit/pixels.ts';
import { checkSheet, type CheckedSheet } from '../src/assets/building-kit/sheet-checks.ts';
import { GREEN, MAGENTA, regions, sheetPrompt, type SheetLayout } from '../src/assets/building-kit/sheet.ts';
import { joints, makeSeamless, rowLines, rowsTile, shapesCheck } from '../src/assets/building-kit/tiling.ts';
import { buildingViews } from '../src/assets/building-kit/views.ts';
import { FLAT_ISOMETRIC } from '../src/assets/style-profile.ts';

const FIRST_SHEET_STYLE = [
  'Every texture is flat and seen square-on, like a scan of a flat surface held straight in front of the camera: no perspective, no isometric view, no 3D, no depth, no objects drawn on top.',
  'Built from a few flat facets of solid colour with crisp edges and very low contrast, in one small palette of soft muted warm pastels: cream, sand, warm honey-brown timber, terracotta, dusty rose, sage green.',
  'No lighting at all: no shading, no shadows, no highlights, no gradients, no darker edges or corners, no glow; the same brightness all over each texture.',
  'No border, frame or outline round any shape. No writing, letters or symbols.',
].join(' ');

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SHIPPED = join(repo, 'assets/kit-sheets');
const COTTAGE = join(SHIPPED, 'timber-cottage');
const R = regions();
const SLOW = 60_000;

let sheet2: Img;
beforeAll(async () => {
  sheet2 = await readImg(join(COTTAGE, 'sheet-2.png'));
});

/** Today's sheet with something done to it, checked only where it was done (each region is read on its own, so this stays quick). */
async function planted(name: string, fault: (a: Img, box: [number, number, number, number]) => void): Promise<CheckedSheet> {
  const a: Img = { ...sheet2, d: sheet2.d.slice() };
  fault(a, R[name]!.box);
  return checkSheet(a, { [name]: R[name]! });
}

/** Sets the pixels of x0..x1, y0..y1 from their position and colour. */
function each(a: Img, x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number, rgb: number[]) => number[]): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 3;
      a.d.set(f(x - x0, y - y0, [a.d[i]!, a.d[i + 1]!, a.d[i + 2]!]), i);
    }
  }
}

/** The checks one texture failed. */
const failed = (c: CheckedSheet, name: string) => Object.entries(c.report[name]!.checks).flatMap(([k, v]) => (v.ok ? [] : [k]));

/** A small seeded random number source, so code-made test patterns come out the same every run. */
function random(seed: number): (lo: number, hi: number) => number {
  let s = seed >>> 0;
  return (lo, hi) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return lo + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (hi - lo));
  };
}

/**
 * A test pattern of stones in rows with offset joints (never game art): light
 * mortar, stones of three greys, each row's joints placed at random, read like
 * the stone shape on a sheet (6 px in from its edges). Two rows have one line
 * between them and none at the edges.
 */
function stones(rows: number, seed = 1): Img {
  const [, , w, h] = R.stone!.box;
  const a: Img = { w, h, d: new Float64Array(w * h * 3) };
  each(a, 0, 0, w, h, () => [232, 224, 208]);
  const rnd = random(seed);
  const greys = [[176, 166, 150], [196, 180, 150], [160, 156, 150]];
  const rh = h / rows;
  for (let row = 0; row < rows; row++) {
    const [y0, y1] = rows === 2 ? [Math.trunc(row * rh + (row ? 8 : 0)), Math.trunc((row + 1) * rh - (row ? 0 : 8))] : [Math.trunc(row * rh + 4), Math.trunc((row + 1) * rh - 4)];
    for (let bx = -rnd(20, 90); bx < w; ) {
      const bw = rnd(80, 140);
      const c = greys[rnd(0, 3)]!;
      each(a, Math.max(0, bx + 4), y0, Math.min(w, bx + bw - 4), y1, () => c);
      bx += bw;
    }
  }
  return crop(a, 6, 6, w - 6, h - 6);
}

describe('building kit texture sheets', () => {
  it('takes every texture the renderer needs from the sheets shipped with the game', async () => {
    const sheets = new KitSheets({ shippedDir: SHIPPED, dir: await mkdtemp(join(tmpdir(), 'co-mmo-sheets-')), style: FLAT_ISOMETRIC.kitTextures });
    expect((await sheets.paintings('timber-cottage')).map((p) => p.id)).toEqual(['shipped/sheet-4', 'shipped/sheet-2']);
    const { textures, tiles, report, missing } = await sheets.textures('timber-cottage');
    expect(missing).toEqual([]);
    for (const [name, r] of Object.entries(report)) expect(r.ok, `${name}: ${JSON.stringify(r.checks)}`).toBe(true);
    // the window and stones were painted again over the first sheet; the rest come from it
    expect(Object.fromEntries(Object.entries(report).map(([n, r]) => [n, r.painting]))).toEqual({
      window: 'shipped/sheet-4', stone: 'shipped/sheet-4',
      panel: 'shipped/sheet-2', inside: 'shipped/sheet-2', door: 'shipped/sheet-2', plaster: 'shipped/sheet-2', floor: 'shipped/sheet-2', roof: 'shipped/sheet-2', timber: 'shipped/sheet-2',
    });
    expect(report.roof!.checks.repeats).toMatchObject({ ok: true, how: expect.stringMatching(/^rebuilt from/) });
    expect(report.roof!.checks['shapes kept']).toMatchObject({ ok: true });
    // and a house drawn with them passes every picture check
    const views = buildingViews(buildingKit.SAMPLE_BUILDINGS.cottage, textures, { u: 48, tiles });
    for (const v of views) expect(v.checks.filter((c) => !c.ok), v.view).toEqual([]);
  }, SLOW);

  it('sends exactly the words the stones and window were painted from', async () => {
    const layout = JSON.parse(await readFile(join(COTTAGE, 'sheet-4.layout.json'), 'utf8')) as SheetLayout;
    expect(layout).toEqual({ window: R.window, stone: R.stone });
    expect(sheetPrompt(layout, buildingKit.TIMBER_COTTAGE, FIRST_SHEET_STYLE, { edit: true })).toBe(await readFile(join(COTTAGE, 'sheet-4.prompt.txt'), 'utf8'));
  });

  it('paints only the textures asked for over the newest whole painting, keeping the rest of it', async () => {
    const sheets = new KitSheets({ shippedDir: SHIPPED, dir: await mkdtemp(join(tmpdir(), 'co-mmo-sheets-')), style: FLAT_ISOMETRIC.kitTextures });
    const guide = await sheets.guide('timber-cottage', ['window']);
    expect(Object.keys(guide.layout)).toEqual(['window']);
    const g = await readImg(guide.picture);
    const at = (img: Img, x: number, y: number) => {
      const i = (Math.trunc(y) * img.w + Math.trunc(x)) * 3;
      return Array.from(img.d.subarray(i, i + 3));
    };
    const [x, y, w, h] = R.window!.box;
    expect(at(g, x + w / 2, y + h / 2)).toEqual([...GREEN]);
    expect(at(g, x - 6, y + h / 2)).toEqual([...MAGENTA]);
    // the door beside it is left as it was painted
    const [dx, dy, dw, dh] = R.door!.box;
    expect(at(g, dx + dw / 2, dy + dh / 2)).toEqual(at(sheet2, dx + dw / 2, dy + dh / 2));
    expect(sheets.request(guide)).toMatchObject({ edit: true, aspectRatio: '16:9', size: '2K', labels: ['Layout guide: the green shapes to paint'] });
    await expect(sheets.guide('timber-cottage', ['chimney'])).rejects.toThrow(/no texture called chimney/);
    await expect(sheets.guide('castle')).rejects.toThrow(/no building look/);
  }, SLOW);

  describe('catches every known fault in a painted sheet', () => {
    it('passes the shapes as they were painted', async () => {
      const c = await checkSheet(sheet2, { panel: R.panel!, window: R.window!, door: R.door! });
      for (const name of ['panel', 'window', 'door']) expect(failed(c, name), name).toEqual([]);
    });

    it('a shape painted 20 px off its place', async () => {
      const c = await planted('panel', (a, [x, y, w, h]) => {
        const moved = crop(a, x - 30, y - 30, x + w + 30, y + h + 30);
        each(a, x - 30, y - 30, x + w + 30, y + h + 30, () => [...MAGENTA]);
        each(a, x - 10, y - 30, x + w + 50, y + h + 30, (i, j) => Array.from(moved.d.subarray((j * moved.w + i) * 3, (j * moved.w + i) * 3 + 3)));
      });
      expect(failed(c, 'panel')).toContain('place');
    });

    it('part of a shape left unpainted', async () => {
      const c = await planted('panel', (a, [x, y, w, h]) => each(a, x, y + Math.trunc(h * 0.85), x + w, y + h, () => [...GREEN]));
      expect(failed(c, 'panel')).toEqual(['filled']);
    });

    it('a flat drawing of a diamond instead of a flat texture', async () => {
      const c = await planted('window', (a, [x, y, w, h]) =>
        each(a, x, y, x + w, y + h, (i, j, rgb) => (Math.abs(i - w / 2) / (w / 2) + Math.abs(j - h / 2) / (h / 2) <= 1 ? rgb : [...GREEN])),
      );
      expect(failed(c, 'window')).toContain('filled');
    });

    it('paint spilling outside a shape', async () => {
      const c = await planted('window', (a, [x, y, w, h]) => each(a, x + w, y, x + w + 40, y + h, () => [190, 140, 100]));
      expect(failed(c, 'window')).toContain('spill');
    });

    it('light baked into a repeating texture', async () => {
      const c = await planted('stone', (a, [x, y, w, h]) => each(a, x, y, x + w, y + h, (i, _j, rgb) => rgb.map((v) => v * (0.6 + (0.6 * i) / w))));
      expect(failed(c, 'stone')).toContain('flat');
    });

    it('a wall panel lit from the left', async () => {
      const c = await planted('panel', (a, [x, y, w, h]) => each(a, x, y, x + w, y + h, (i, _j, rgb) => rgb.map((v) => v * (1.25 - (0.7 * i) / w))));
      expect(failed(c, 'panel')).toEqual(['flat']);
    });

    it('a frame painted round a repeating texture', async () => {
      const c = await planted('plaster', (a, [x, y, w, h]) =>
        each(a, x, y, x + w, y + h, (i, j) => (i < 18 || j < 18 || i >= w - 18 || j >= h - 18 ? [120, 90, 70] : [236, 226, 205])),
      );
      expect(failed(c, 'plaster')).toContain('no frame');
    });

    it('a darker rim, and a brighter half', async () => {
      const rim = await planted('plaster', (a, [x, y, w, h]) =>
        each(a, x, y, x + w, y + h, (i, j, rgb) => rgb.map((v) => v * (1 - 0.15 * (((i - w / 2) / (w / 2)) ** 2 + ((j - h / 2) / (h / 2)) ** 2)))),
      );
      expect(failed(rim, 'plaster')).toContain('even');
      const half = await planted('plaster', (a, [x, y, w, h]) => each(a, x, y, x + w / 2, y + h, (_i, _j, rgb) => rgb.map((v) => v + 28)));
      expect(failed(half, 'plaster')).toContain('even');
    }, SLOW);

    it('reads a door painted 7 px high where it was painted, with no magenta in it', async () => {
      const c = await planted('door', (a, [x, y, w, h]) => {
        const door = crop(a, x - 20, y - 20, x + w + 20, y + h + 20);
        each(a, x - 20, y - 20, x + w + 20, y + h + 20, () => [...MAGENTA]);
        each(a, x - 20, y - 27, x + w + 20, y + h + 13, (i, j) => Array.from(door.d.subarray((j * door.w + i) * 3, (j * door.w + i) * 3 + 3)));
      });
      expect(failed(c, 'door')).toEqual([]);
      const D = c.textures.door!;
      let nearest = Infinity;
      for (let i = 0; i < D.w * D.h; i++) nearest = Math.min(nearest, Math.hypot(D.d[i * 3]! - 255, D.d[i * 3 + 1]!, D.d[i * 3 + 2]! - 255));
      expect(nearest).toBeGreaterThan(0.5 * 255);
    });
  });

  describe('makes textures repeat without drawing anything', () => {
    it('rebuilds stones in offset rows from their own whole rows, keeping every stone whole', () => {
      const T = stones(5);
      const [tile, how] = rowsTile(T);
      expect(how).toMatch(/^rebuilt from/);
      expect(shapesCheck(T, tile!)).toMatchObject({ ok: true });
    });

    it('catches rows slid so their joints line up in one crack', () => {
      const T = stones(5);
      const tile = rowsTile(T)[0]!;
      const st = rowLines(tile);
      const edges = [0, ...st.inside.flatMap(([s, b]) => [s, s + b]), tile.h];
      const strips: Img[] = [];
      for (let i = 0; i + 1 < edges.length; i++) {
        const strip = rowsOf(tile, edges[i]!, edges[i + 1]!);
        const J = i % 2 === 0 ? joints(tile, st, edges[i]!, edges[i + 1]!) : [];
        strips.push(J.length ? roll(strip, Math.trunc(tile.w / 2) - Math.round(J[0]![0])) : strip);
      }
      const kept = shapesCheck(T, stack(strips));
      expect(kept.ok).toBe(false);
      expect(kept.problems.join(' ')).toMatch(/line up/);
    });

    it('refuses stones in only two rows, and stones with no rows at all', () => {
      expect(rowsTile(stones(2))[0]).toBeNull();
      const rnd = random(2);
      const blocks: Img = { w: 738, h: 268, d: new Float64Array(738 * 268 * 3) };
      const cells = Array.from({ length: 14 * 37 }, () => [rnd(100, 220), rnd(100, 220), rnd(100, 220)]);
      each(blocks, 0, 0, 738, 268, (x, y) => cells[Math.trunc(y / 20) * 37 + Math.trunc(x / 20)]!);
      expect(rowsTile(blocks)[0]).toBeNull();
      expect(makeSeamless(blocks, 1, false)[2]).toBe(false);
    });

    it('cuts a texture with a clear repeat to exactly one repeat', () => {
      const T: Img = { w: 408, h: 408, d: new Float64Array(408 * 408 * 3) };
      // stripes every 90 px, read 6 px in from the shape's edge as on a sheet
      each(T, 0, 0, 408, 408, (x) => ((x + 6) % 90 < 30 ? [200, 180, 160] : [236, 226, 205]));
      const [tile, how, ok] = makeSeamless(T, 1);
      expect(ok).toBe(true);
      expect(how).toMatch(/^cut to one repeat/);
      expect(tile.w).toBe(270);
    });

    it('refuses a free cut through painted shingle rows, which the rows rebuild passes', async () => {
      const [x, y, w, h] = R.roof!.box;
      const P = crop(sheet2, x + 6, y + 6, x + w - 6, y + h - 6);
      const cut = makeSeamless(makeSeamless(P, 1)[0], 0)[0];
      expect(shapesCheck(P, cut).ok).toBe(false);
      const [tile, how] = rowsTile(P);
      expect(how).toMatch(/^rebuilt from/);
      expect(shapesCheck(P, tile!).ok).toBe(true);
    }, SLOW);
  });
});
