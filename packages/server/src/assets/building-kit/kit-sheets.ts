import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { buildingKit } from '@co-mmo/shared';
import type { ImageRequest } from '../provider.ts';
import { crop, evenRound, readImg, resized, type Img } from './pixels.ts';
import type { Texture } from './raster.ts';
import { checkSheet, combineSheets, type CheckedSheet, type TextureReport } from './sheet-checks.ts';
import { regions, repaintLayout, sheetGuide, type SheetGuide, type SheetLayout } from './sheet.ts';

type KitLook = buildingKit.KitLook;
const { KIT_LOOKS, KIT_TEXTURES, TILE } = buildingKit;

// Each kit look's painted texture sheets, and the textures the renderer takes
// from them. Sheets shipped with the game are the oldest; sheets painted since
// are kept in the art folder. Every texture comes from the newest painting
// where it passed its checks, so painting one texture again replaces only it,
// and only once the new one passes.

/** One painting of a look's sheet, with the layout it was painted to and the words sent with it. */
export interface KitPainting {
  /** `shipped/sheet-2` or `painted/sheet-5`. */
  id: string;
  file: string;
  layout: SheetLayout;
  prompt: string;
  shipped: boolean;
}

export interface KitSheetsOptions {
  /** Sheets shipped with the game, `<dir>/<look>/sheet-<n>.png`, each with its prompt and, unless it holds the whole kit, its layout. */
  shippedDir?: string;
  /** Where sheets painted since are kept, the same way. */
  dir: string;
  /** The art style's words for kit textures (its profile's `kitTextures`). */
  style: string;
}

/** What a look's sheets give the renderer: the textures that passed, the size of each tile, and every check. */
export interface LookTextures {
  textures: Record<string, Texture>;
  tiles: buildingKit.TileSizes;
  report: Record<string, TextureReport>;
  /** Textures with no painting that passed: no building of this look can be shown yet. */
  missing: string[];
}

/** One look's sheets as the Art tab shows them. */
export interface KitSheetView {
  look: string;
  name: string;
  paintings: { id: string; shipped: boolean }[];
  /** Still being checked: look again shortly. */
  checking: boolean;
  /** Each texture: whether it passed, the painting it is taken from, and the checks it failed. */
  textures: { name: string; ok: boolean; painting?: string; failed: string[] }[];
}

/** Pixels per kit unit the textures are averaged down to, about the detail a render shows. */
const PPU = 400;

/** A texture resized once to the detail a render shows, so a large painting does not sparkle when sampled. Tiles wrap round as they resize. */
export async function prefilter(T: Img, world: readonly [number, number], wrap: boolean, ppu = PPU): Promise<Texture> {
  const [W, H] = [Math.max(2, evenRound(world[0] * ppu)), Math.max(2, evenRound(world[1] * ppu))];
  let out = T;
  if (Math.abs(W - T.w) > 2 || Math.abs(H - T.h) > 2) {
    if (wrap) {
      const p = 8;
      const P = crop(T, 0, 0, T.w, T.h);
      const padded: Img = { w: T.w + 2 * p, h: T.h + 2 * p, d: new Float64Array((T.w + 2 * p) * (T.h + 2 * p) * 3) };
      for (let y = 0; y < padded.h; y++) {
        for (let x = 0; x < padded.w; x++) {
          const at = ((((y - p) % T.h) + T.h) % T.h) * T.w + ((((x - p) % T.w) + T.w) % T.w);
          padded.d.set(P.d.subarray(at * 3, at * 3 + 3), (y * padded.w + x) * 3);
        }
      }
      const [sx, sy] = [W / T.w, H / T.h];
      const big = await resized(padded, evenRound(padded.w * sx), evenRound(padded.h * sy));
      out = crop(big, evenRound(p * sx), evenRound(p * sy), evenRound(p * sx) + W, evenRound(p * sy) + H);
    } else {
      out = await resized(T, W, H);
    }
  }
  const rgb = new Float32Array(out.d.length);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.min(Math.max(out.d[i]! / 255, 0), 1);
  return { w: out.w, h: out.h, rgb };
}

/** Checks one painting in a worker thread, so the game keeps running meanwhile; in this thread when no worker can start (one needs Node 22.7 or later to read TypeScript). */
async function checkOffThread(painting: KitPainting): Promise<CheckedSheet> {
  try {
    return await new Promise<CheckedSheet>((ok, fail) => {
      const worker = new Worker(new URL('./sheet-worker.ts', import.meta.url), {
        workerData: { file: painting.file, layout: painting.layout },
        execArgv: [...process.execArgv, '--experimental-transform-types', '--disable-warning=ExperimentalWarning'],
      });
      worker.once('message', ok);
      worker.once('error', fail);
      worker.once('exit', (code) => fail(new Error(`The sheet checks stopped early (${code}).`)));
    });
  } catch {
    return checkSheet(await readImg(painting.file), painting.layout);
  }
}

/** One look's checks, started for one set of paintings; `done` once they finished. */
interface Checking {
  key: string;
  checked: Promise<CheckedSheet>;
  done?: CheckedSheet;
}

/** The kit's sheets, painted and shipped. */
export class KitSheets {
  private checking = new Map<string, Checking>();
  /** Each painting's own checks, by file: a kept painting never changes, so it is checked once. */
  private sheets = new Map<string, Promise<CheckedSheet>>();

  constructor(private readonly options: KitSheetsOptions) {}

  /** A look by id. */
  look(id: string): KitLook | undefined {
    return Object.hasOwn(KIT_LOOKS, id) ? KIT_LOOKS[id] : undefined;
  }

  /** A look's paintings, newest first: those painted since, then those shipped. */
  async paintings(look: string): Promise<KitPainting[]> {
    const list: KitPainting[] = [];
    for (const [dir, shipped] of [[this.options.dir, false], [this.options.shippedDir, true]] as const) {
      if (!dir) continue;
      const folder = join(dir, look);
      const numbers = ((await readdir(folder).catch(() => [])) as string[]).flatMap((f) => /^sheet-(\d+)\.png$/.exec(f)?.[1] ?? []).map(Number).sort((a, b) => b - a);
      for (const n of numbers) {
        const base = join(folder, `sheet-${n}`);
        const layout = await readFile(`${base}.layout.json`, 'utf8').then((t) => JSON.parse(t) as SheetLayout, () => regions());
        const prompt = await readFile(`${base}.prompt.txt`, 'utf8').catch(() => '');
        list.push({ id: `${shipped ? 'shipped' : 'painted'}/sheet-${n}`, file: `${base}.png`, layout, prompt, shipped });
      }
    }
    return list;
  }

  /** Every painting of a look checked, each texture taken from the newest painting where it passed. */
  async checked(look: string): Promise<CheckedSheet> {
    return this.check(look, await this.paintings(look)).checked;
  }

  /** Starts checking a look's paintings unless the same ones were checked already; a failed check is tried again next time. */
  private check(look: string, paintings: KitPainting[]): Checking {
    const key = paintings.map((p) => p.id).join(',');
    const kept = this.checking.get(look);
    if (kept?.key === key) return kept;
    if (!paintings.length) {
      // nothing painted yet: nothing to check
      const none: CheckedSheet = { report: {}, textures: {}, tiles: {} };
      const run: Checking = { key, checked: Promise.resolve(none), done: none };
      this.checking.set(look, run);
      return run;
    }
    const run: Checking = { key, checked: this.combined(paintings) };
    run.checked.then(
      (c) => (run.done = c),
      (err) => {
        console.error(`Checking the ${look} building sheets failed:`, (err as Error).message);
        if (this.checking.get(look) === run) this.checking.delete(look);
      },
    );
    this.checking.set(look, run);
    return run;
  }

  /** Paintings checked one after another (each holds a whole sheet while it is read), then taken together. */
  private async combined(paintings: KitPainting[]): Promise<CheckedSheet> {
    const list: { id: string; sheet: CheckedSheet }[] = [];
    for (const p of paintings) list.push({ id: p.id, sheet: await this.one(p) });
    return combineSheets(list);
  }

  /** One painting's checks, run once; a failed run is tried again next time. */
  private one(painting: KitPainting): Promise<CheckedSheet> {
    let kept = this.sheets.get(painting.file);
    if (!kept) {
      const run = checkOffThread(painting);
      run.catch(() => this.sheets.get(painting.file) === run && this.sheets.delete(painting.file));
      this.sheets.set(painting.file, (kept = run));
    }
    return kept;
  }

  /** The textures the renderer draws a look with: only those that passed, each resized once to the detail a render shows. */
  async textures(look: string): Promise<LookTextures> {
    const checked = await this.checked(look);
    const R = regions();
    const textures: Record<string, Texture> = {};
    for (const [name, T] of Object.entries(checked.textures)) {
      if (!checked.report[name]?.ok) continue;
      const tile = checked.tiles[name];
      textures[name] = await prefilter(T, tile ?? R[name]!.world, Boolean(tile));
    }
    return { textures, tiles: { ...TILE, ...checked.tiles }, report: checked.report, missing: KIT_TEXTURES.filter((t) => !textures[t]) };
  }

  /**
   * The guide for painting a look's sheet, and the words sent with it. With
   * `names`, only those textures are painted again: over the newest painting
   * of the whole kit when there is one (the model then matches it), else on
   * their own, one alone made as large as the sheet allows.
   */
  async guide(look: string, names: string[] = [], note = ''): Promise<SheetGuide> {
    const found = this.look(look);
    if (!found) throw new Error('There is no building look by that name.');
    const unknown = names.filter((n) => !(KIT_TEXTURES as readonly string[]).includes(n));
    if (unknown.length) throw new Error(`There is no texture called ${unknown.join(', ')} on a building sheet.`);
    const opts = { note: note.trim().slice(0, 1000) };
    const R = regions();
    if (!names.length) return sheetGuide(R, found, this.options.style, opts);
    const whole = (await this.paintings(look)).find((p) => KIT_TEXTURES.every((t) => p.layout[t]));
    if (!whole) return sheetGuide(repaintLayout(names), found, this.options.style, opts);
    const only = Object.fromEntries(names.map((n) => [n, R[n]!]));
    return sheetGuide(only, found, this.options.style, { ...opts, over: await readImg(whole.file) });
  }

  /** What is sent to the image model for a guide: the guide itself, then the words, for a wide 2K picture. */
  request(guide: SheetGuide): ImageRequest {
    return {
      prompt: guide.prompt,
      references: [{ mimeType: 'image/png', data: guide.picture }],
      labels: ['Layout guide: the green shapes to paint'],
      edit: true,
      aspectRatio: '16:9',
      size: '2K',
    };
  }

  /** Keeps a new painting of a look's sheet beside its layout and the words it was painted from. */
  async keep(look: string, picture: Buffer, guide: SheetGuide): Promise<KitPainting> {
    const all = await this.paintings(look);
    const n = Math.max(0, ...all.map((p) => Number(/sheet-(\d+)$/.exec(p.id)![1]))) + 1;
    const folder = join(this.options.dir, look);
    await mkdir(folder, { recursive: true });
    const base = join(folder, `sheet-${n}`);
    await writeFile(`${base}.png`, await sharp(picture).png().toBuffer());
    await writeFile(`${base}.layout.json`, JSON.stringify(guide.layout, null, 1));
    await writeFile(`${base}.prompt.txt`, guide.prompt);
    return { id: `painted/sheet-${n}`, file: `${base}.png`, layout: guide.layout, prompt: guide.prompt, shipped: false };
  }

  /** Every look's sheets and how each texture fared, for the Art tab. It does not wait for checks still running: those looks say so. */
  async overview(): Promise<KitSheetView[]> {
    const out: KitSheetView[] = [];
    for (const look of Object.values(KIT_LOOKS)) {
      const paintings = await this.paintings(look.id);
      const report = this.check(look.id, paintings).done?.report;
      out.push({
        look: look.id,
        name: look.name,
        paintings: paintings.map((p) => ({ id: p.id, shipped: p.shipped })),
        checking: !report,
        textures: KIT_TEXTURES.map((name) => {
          const r = report?.[name];
          const failed = r ? Object.entries(r.checks).flatMap(([c, v]) => (v.ok ? [] : [c])) : report ? ['not painted yet'] : [];
          return { name, ok: Boolean(r?.ok), ...(r?.painting ? { painting: r.painting } : {}), failed };
        }),
      });
    }
    return out;
  }
}
