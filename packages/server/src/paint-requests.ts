import { readFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { Kept } from './kept.ts';

// Painting a wish or an Owner's request can wait a long time behind the
// video model's limits, and the server may restart meanwhile. What was asked
// is kept in the database (kept.ts) until it is painted, and asked again when
// the server starts. Start-up painting needs no keeping: it paints whatever is
// missing every time.

/** A request that is asked again after a restart if it was not finished. */
export type PaintRequest =
  /** A granted wish's pictures; `only` one of them, `force` when the Owner asked for it again. */
  | { kind: 'wish'; record: string; force: boolean; only?: string; prompts?: Record<string, string> }
  /** The Owner's "Paint again" on a building or shipped picture. */
  | { kind: 'repaint'; asset: string; note: string; references?: string[] }
  /** The Owner's "Paint standing picture" for one walk direction, with the prompt they approved. */
  | { kind: 'view'; walker: string; direction: string; prompt?: string; from?: string[] }
  /** The Owner's "Paint the four ways together" for one walker: its isometric ways on one sheet. */
  | { kind: 'ways'; walker: string; note?: string; references?: string[] }
  /** The Owner's "Make walk clip" for one direction, from the standing picture there. */
  | { kind: 'clip'; walker: string; body: string; direction: string; prompt?: string }
  /** The Owner's "Paint the sheet" for a building look's textures: all of them, or only `textures`, with their note. */
  | { kind: 'sheet'; look: string; textures?: string[]; note?: string };

/** How each kind is asked again after a restart. */
export type PaintResumers = { [K in PaintRequest['kind']]: (request: Extract<PaintRequest, { kind: K }>) => Promise<unknown> | unknown };

/** Paint requests kept until they are done. */
export interface PaintRequests {
  /** Keeps `request` until `work` settles, painted or not. */
  hold(request: PaintRequest, work: Promise<unknown>): void;
  /** Asks again for every request a restart cut short; they are kept again by whoever paints them. */
  resume(resumers: PaintResumers): Promise<void>;
  /** Stops changing what is kept, so requests cut short by shutting down are asked again after it. */
  close(): Promise<void>;
}

/** Kind of the kept documents holding paint requests, one per request. */
export const PAINT_REQUESTS = 'paint-request';

/** Paint requests kept in the database, one document each. */
export class KeptPaintRequests implements PaintRequests {
  /** Requests this server holds now, so resume() does not ask for them twice. */
  private readonly mine = new Set<string>();
  private writing: Promise<void> = Promise.resolve();
  /** After closing, finished work is not forgotten: requests cut short are asked again after the restart. */
  private closed = false;

  /** `oldFile` is the JSON file older games kept the requests in; it is brought in once. */
  constructor(private readonly kept: Kept, private readonly oldFile?: string) {}

  hold(request: PaintRequest, work: Promise<unknown>): void {
    const id = randomBytes(6).toString('hex');
    this.mine.add(id);
    this.write(() => this.kept.put(PAINT_REQUESTS, id, request));
    void work.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      this.mine.delete(id);
      if (!this.closed) this.write(() => this.kept.delete(PAINT_REQUESTS, id));
    });
  }

  async resume(resumers: PaintResumers): Promise<void> {
    await this.bringInOldFile();
    await this.writing;
    const left = (await this.kept.list<PaintRequest>(PAINT_REQUESTS)).filter((r) => !this.mine.has(r.key));
    for (const { key, data: request } of left) {
      // Asked again, it is held anew by whoever paints it.
      await this.kept.delete(PAINT_REQUESTS, key);
      try {
        await (resumers[request.kind] as (r: PaintRequest) => unknown)(request);
      } catch (err) {
        console.error(`A ${request.kind} painting from before the restart was dropped:`, (err as Error).message);
      }
    }
    await this.writing;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.writing;
  }

  /** Writes in order, so a request is never forgotten before it was kept. */
  private write(step: () => Promise<void>): void {
    this.writing = this.writing.then(step).catch((err) => console.error('Keeping the paint requests failed:', (err as Error).message));
  }

  /** Brings in requests an older game left in its JSON file, then renames the file so they are not brought in twice. */
  private async bringInOldFile(): Promise<void> {
    if (!this.oldFile) return;
    const text = await readFile(this.oldFile, 'utf8').catch(() => undefined);
    if (text === undefined) return;
    let old: PaintRequest[] = [];
    try {
      old = JSON.parse(text) as PaintRequest[];
    } catch {
      // A broken file has nothing to bring in.
    }
    for (const request of old) await this.kept.put(PAINT_REQUESTS, randomBytes(6).toString('hex'), request);
    await rename(this.oldFile, `${this.oldFile}.in-db`).catch(() => {});
  }
}
