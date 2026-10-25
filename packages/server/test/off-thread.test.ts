import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { offThread } from '../src/assets/building-kit/off-thread.ts';
import type { CheckedSheet } from '../src/assets/building-kit/sheet-checks.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SHEET = join(repo, 'assets/kit-sheets/timber-cottage/sheet-4');

describe('building work off the game thread', () => {
  // Run in the game's own thread, a sheet check or house drawing stalls every
  // request for many seconds (Art tab calls took over 20 s on Node 20).
  it('checks a painted sheet in a worker, never in the game thread', async () => {
    const layout = JSON.parse(await readFile(`${SHEET}.layout.json`, 'utf8'));
    const checked = await offThread<CheckedSheet>(new URL('../src/assets/building-kit/sheet-worker.ts', import.meta.url), { file: `${SHEET}.png`, layout }, () => {
      throw new Error('The worker did not start, so the check ran in the game thread.');
    });
    expect(Object.keys(checked.report).length).toBeGreaterThan(0);
  }, 60_000);
});
