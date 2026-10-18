import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { buildingKit } from '@co-mmo/shared';
import { drawHouse, type HouseDrawn, type HouseJob } from './house-build.ts';
import type { KitSheets } from './kit-sheets.ts';
import { offThread } from './off-thread.ts';

type KitHouse = buildingKit.KitHouse;
type KitHouseInfo = buildingKit.KitHouseInfo;

// The game's kit houses, drawn on the server the first time the game asks
// for one and kept in the art folder: the outside and each storey's cutaway,
// each a colour picture with its normal and glow maps, on one frame. A house
// is shown only once every shape and picture check passed, and is drawn
// again when its look's sheet is painted again.

/** Pixels per bay a house is drawn at: at the camera's usual zoom, a little finer than the screen shows it. */
export const HOUSE_U = 100;

export interface KitHousesOptions {
  /** Where houses are kept: `<dir>/<key>/` holds one house's maps and its `house.json`. */
  dir: string;
  /** The URL `dir` is served at. */
  url: string;
  sheets: KitSheets;
  /** Pixels per bay, and how much finer the drawing is before it is averaged down. */
  u?: number;
  ss?: number;
}

/** A house drawn, or tried, as kept in its `house.json`: with the paintings it was drawn from and when. */
interface Kept extends HouseDrawn {
  paintings: string;
  at: number;
}

/** Every kit house drawn for the game. */
export class KitHouses {
  private readonly kept = new Map<string, Kept>();
  private readonly drawing = new Map<string, Promise<void>>();
  /** Houses are drawn one at a time: each holds a whole drawing in memory. */
  private line: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: KitHousesOptions) {}

  /** A house as the game is offered it, by its building's place in its region; drawing starts when it is not drawn yet or its look was painted again. */
  async info(house: KitHouse, building: number): Promise<KitHouseInfo> {
    const paintings = (await this.options.sheets.paintings(house.look)).map((p) => p.id).join(',');
    const kept = this.kept.get(house.key) ?? (await this.read(house.key));
    const fresh = kept?.paintings === paintings;
    if (!fresh) this.draw(house, paintings);
    if (!kept || (!fresh && kept.failed.length)) return { building, key: house.key, status: 'building' };
    if (kept.failed.length || !kept.frame) return { building, key: house.key, status: 'failed', failed: kept.failed };
    // Drawn from older paintings: shown as it is until the new drawing replaces it.
    const file = (name: string) => `${this.options.url}/${house.key}/${name}.png?v=${kept.at}`;
    const views = Object.fromEntries(kept.views.map((v) => [v, { picture: file(v), normal: file(`${v}-normal`), glow: file(`${v}-glow`) }]));
    return { building, key: house.key, status: 'ready', views, frame: kept.frame };
  }

  /** Resolves once a house drawing started earlier has finished. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.drawing.values()]);
  }

  /** Stops drawing new houses and waits for the one under way. */
  async close(): Promise<void> {
    this.closed = true;
    await this.idle();
  }

  private async read(key: string): Promise<Kept | undefined> {
    const kept = await readFile(join(this.options.dir, key, 'house.json'), 'utf8').then((t) => JSON.parse(t) as Kept, () => undefined);
    if (kept) this.kept.set(key, kept);
    return kept;
  }

  /** Draws a house in its turn, unless it is already being drawn. */
  private draw(house: KitHouse, paintings: string): void {
    if (this.closed || this.drawing.has(house.key)) return;
    const run = this.line.then(() => this.drawNow(house, paintings));
    this.line = run.catch(() => undefined);
    const done = run.then(
      () => undefined,
      (err) => console.error(`Drawing the ${house.key} kit house failed:`, (err as Error).message),
    ).finally(() => this.drawing.delete(house.key));
    this.drawing.set(house.key, done);
  }

  private async drawNow(house: KitHouse, paintings: string): Promise<void> {
    if (this.closed) return;
    const { textures, tiles, missing } = await this.options.sheets.textures(house.look);
    const dir = join(this.options.dir, house.key);
    let drawn: HouseDrawn;
    if (missing.length) drawn = { views: [], failed: [`Its look is not painted yet: ${missing.join(', ')}.`] };
    else {
      const job: HouseJob = { spec: house.spec, textures, tiles, u: this.options.u ?? HOUSE_U, ss: this.options.ss ?? 2, dir };
      drawn = await offThread(new URL('./house-worker.ts', import.meta.url), job, () => drawHouse(job));
    }
    const kept: Kept = { ...drawn, paintings, at: Date.now() };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'house.json'), JSON.stringify(kept, null, 1));
    this.kept.set(house.key, kept);
  }
}
