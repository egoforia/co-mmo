// The Smugglers' Sea Cave built from its Art Kit, in a real browser: the Owner
// stands in the cave mouth, walks up the stairs to the Smugglers'
// Loft, and is carried to the Lookout at the top and down to the Tide Grotto
// and the Drowned Hoard below, each floor drawn on its own, then sees the
// cave's walls stand up in the isometric preview. Nothing is painted here:
// unpainted kit pieces show their style's tiles, or nothing.
// Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { generateRegion, newCharacter, regionDef } from '@co-mmo/shared';
import { account, app } from '../test/helpers.ts';
import { playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
let browser: Browser;

beforeAll(() => {
  if (!existsSync(resolve(clientDir, 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  mkdirSync(shots, { recursive: true });
}, 180_000);

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

/** Holds a key until `done`, or a while has passed (a browser without a graphics card draws only a few frames a second). */
async function hold(page: Page, key: string, done: () => boolean, ms = 60_000): Promise<void> {
  await page.keyboard.down(key);
  await expect.poll(done, { timeout: ms }).toBe(true).catch(() => undefined);
  await page.keyboard.up(key);
}

describe('the sea cave', () => {
  it('shows each of its six floors on its own, from the Lookout to the Drowned Hoard', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const map = generateRegion(regionDef('shore')!);
    const way = (lower: number) => map.stairways.find((s) => s.lower === lower)!;
    const { id, token } = account(world.store, 'Robo', 'owner');
    world.store.savePosition(id, way(0).bottom.x, way(0).bottom.y, 'shore', newCharacter());

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
    });
    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    await page.goto(`${world.base}/`);
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(2500);
    const shore = () => app!.world.local('shore')!;
    const floor = () => shore().position(id)?.floor ?? 0;
    await page.screenshot({ path: resolve(shots, 'sea-cave-0-mouth.png') });

    // North up the stairs to the loft.
    await hold(page, 'ArrowUp', () => floor() === 1);
    expect(floor(), 'up the stairs').toBe(1);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(shots, 'sea-cave-1-loft.png') });

    // Carried to the other floors, as if by their stairs and ladders.
    for (const [n, at, file] of [
      [2, way(1).top, 'sea-cave-2-gallery'],
      [3, way(2).top, 'sea-cave-3-lookout'],
      [-1, way(-1).bottom, 'sea-cave-minus-1-grotto'],
      [-2, way(-2).bottom, 'sea-cave-minus-2-hoard'],
    ] as const) {
      shore().placePlayer(id, at.x, at.y, n);
      await expect.poll(floor).toBe(n);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: resolve(shots, `${file}.png`) });
    }

    // The isometric preview, with the kit's pieces stood in for by shipped
    // pictures (nothing is painted here): the walkway's planks as the rock
    // face, so the walls' faces show plainly against their tops.
    const standIn = (file: string) => ({ file, kind: 'tile', width: 128, height: 128 });
    await page.route('**/api/art', (route) => route.fulfill({ json: {
      'sea-cave-wall': standIn('art/shore-sea-cave-wall.png'),
      'sea-cave-floor': standIn('art/shore-sea-cave-floor.png'),
      'sea-cave-rock-face': standIn('art/shore-sea-cave-door.png'),
    } }));
    shore().placePlayer(id, way(0).bottom.x, way(0).bottom.y, 0);
    await expect.poll(floor).toBe(0);
    await page.evaluate(() => localStorage.setItem('co-mmo.camera-preview', 'isometric'));
    await page.reload();
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: resolve(shots, 'sea-cave-isometric-0.png') });
    shore().placePlayer(id, way(1).bottom.x, way(1).bottom.y, 1);
    await expect.poll(floor).toBe(1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'sea-cave-isometric-1.png') });

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
