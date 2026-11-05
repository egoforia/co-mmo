import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Kept } from './kept.ts';

/**
 * One JSON document the Art tab keeps (a queue, notes, found hand points, a
 * recipe) that used to be a file beside the painted art. In the game it lives
 * in the database (kept.ts); the first read brings in the old file, if there
 * is one, and renames it `<name>.in-db` so it is kept as a backup and never
 * brought in twice. With no database (a module made on its own in a test) it
 * stays the file.
 */
export class KeptDoc<T> {
  constructor(
    private readonly kept: Kept | undefined,
    private readonly kind: string,
    private readonly key: string,
    /** Where the file was, or is without a database. */
    private readonly file: string,
  ) {}

  /** The document, or nothing when it was never saved. */
  async read(): Promise<T | undefined> {
    if (!this.kept) return readJson<T>(this.file);
    const saved = await this.kept.get<T>(this.kind, this.key);
    if (saved !== undefined) return saved;
    const old = await readJson<T>(this.file).catch(() => undefined);
    if (old === undefined) return undefined;
    await this.kept.put(this.kind, this.key, old);
    await rename(this.file, `${this.file}.in-db`).catch(() => {});
    return old;
  }

  async write(data: T): Promise<void> {
    if (this.kept) return this.kept.put(this.kind, this.key, data);
    await mkdir(dirname(this.file), { recursive: true });
    // Written beside and renamed, so a crash mid-write never leaves half a file.
    await writeFile(`${this.file}.tmp`, JSON.stringify(data, null, 2));
    await rename(`${this.file}.tmp`, this.file);
  }

  /** Forgets the document, and any old file that was never brought in. */
  async remove(): Promise<void> {
    await this.kept?.delete(this.kind, this.key);
    await rm(this.file, { force: true });
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}
