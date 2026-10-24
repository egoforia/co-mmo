import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Painting a wish or an Owner's request can wait a long time behind the
// video model's limits, and the server may restart meanwhile. What was asked
// is kept in a small JSON file until it is painted, and asked again when the
// server starts. Start-up painting needs no keeping: it paints whatever is
// missing every time. A shared store (Redis) can replace the file by
// implementing PaintRequests.

/** A request that is asked again after a restart if it was not finished. */
export type PaintRequest =
  /** A granted wish's pictures; `only` one of them, `force` when the Owner asked for it again. */
  | { kind: 'wish'; record: string; force: boolean; only?: string; prompts?: Record<string, string> }
  /** The Owner's "Paint again" on a building or shipped picture. */
  | { kind: 'repaint'; asset: string; note: string }
  /** The Owner's "Paint standing picture" for one walk direction, with the prompt they approved. */
  | { kind: 'view'; walker: string; direction: string; prompt?: string; from?: string[] }
  /** The Owner's "Paint the four ways together" for one walker: its isometric ways on one sheet. */
  | { kind: 'ways'; walker: string }
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

/** Paint requests kept in a JSON file. */
export class FilePaintRequests implements PaintRequests {
  private requests = new Map<string, PaintRequest>();
  private saving: Promise<void> = Promise.resolve();
  /** Nothing is written until the requests from before are read, or after closing. */
  private writable = false;

  constructor(private readonly path: string) {}

  hold(request: PaintRequest, work: Promise<unknown>): void {
    const id = randomBytes(4).toString('hex');
    this.requests.set(id, request);
    this.save();
    void work.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      this.requests.delete(id);
      this.save();
    });
  }

  async resume(resumers: PaintResumers): Promise<void> {
    const text = await readFile(this.path, 'utf8').catch(() => '[]');
    let left: PaintRequest[];
    try {
      left = JSON.parse(text) as PaintRequest[];
    } catch {
      left = [];
    }
    this.writable = true;
    for (const request of left) {
      try {
        await (resumers[request.kind] as (r: PaintRequest) => unknown)(request);
      } catch (err) {
        console.error(`A ${request.kind} painting from before the restart was dropped:`, (err as Error).message);
      }
    }
    // Requests asked again are held anew; the rest are done with.
    this.save();
    await this.saving;
  }

  async close(): Promise<void> {
    this.writable = false;
    await this.saving;
  }

  private save(): void {
    if (!this.writable) return;
    const json = JSON.stringify([...this.requests.values()], null, 2);
    this.saving = this.saving.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      // Written beside and renamed, so a crash mid-write never leaves half a file.
      await writeFile(`${this.path}.tmp`, json);
      await rename(`${this.path}.tmp`, this.path);
    }).catch((err) => console.error('Keeping the paint requests failed:', (err as Error).message));
  }
}
