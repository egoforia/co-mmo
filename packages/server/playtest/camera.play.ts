// The isometric camera, in a real browser: a player sees the world through
// it, and the Sanctum Arcanum stands as a kit house, drawn on the server from
// the shipped texture sheets. The robot walks up to it, and inside. The
// Owner can still look through the old top-down view in the Account window,
// and come back. Screenshots land in playtest-results/ to look at afterwards.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildingKit, collides, generateRegion, newCharacter, regionDef } from '@co-mmo/shared';
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

/** Holds a key until the player stands where `done` says, or a while has passed. */
async function walk(page: Page, key: string, done: () => boolean, ms = 15_000): Promise<void> {
  await page.keyboard.down(key);
  await expect.poll(done, { timeout: ms }).toBe(true).catch(() => undefined);
  await page.keyboard.up(key);
}

describe('the isometric camera', () => {
  it('shows every player the Sanctum Arcanum as a kit house', async () => {
    const world = await playWorld({ clientDir, kitSheets: resolve(root, 'assets/kit-sheets') });
    const problems: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
    });

    // The player starts a little way south of the Arcanum's door.
    const map = generateRegion(regionDef('sanctum')!);
    const shop = map.buildings.find((b) => b.style === 'sanctum-arcanum')!;
    expect(buildingKit.kitHouse(shop), 'the Arcanum is a kit house').toBeDefined();
    const { id, token } = account(world.store, 'Robo');
    // On the lane that runs west from the doorstep, far enough off to see the house from outside.
    const start = { x: shop.door.x - 8, y: shop.door.y + 3 };
    expect(collides(map, start.x, start.y), 'the lane is open').toBe(false);
    world.store.savePosition(id, start.x, start.y, 'sanctum', newCharacter());
    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    const drawn = page.waitForResponse((r) => /\/wished-art\/kit-houses\/.+\/outside\.png/.test(r.url()), { timeout: 90_000 });
    await page.goto(`${world.base}/`);
    const again = page;
    await again.waitForSelector('#game canvas', { timeout: 20_000 });
    await again.waitForTimeout(1500);
    await again.screenshot({ path: resolve(shots, 'camera-world.png') });
    expect((await drawn).status()).toBe(200);
    await again.waitForTimeout(3000);
    await again.screenshot({ path: resolve(shots, 'camera-house.png') });

    // The keys walk along the grid: D is due east, along the lane towards the doorstep.
    await again.locator('#game canvas').click();
    const at = () => app!.world.regionOf(id)!.position(id)!;
    await walk(again, 'd', () => at().x > start.x + 1, 30_000);
    expect(at().x, 'walked east').toBeGreaterThan(start.x + 1);
    expect(Math.abs(at().y - start.y), 'without drifting north or south').toBeLessThan(0.5);

    // Inside, the house opens to its cutaway. (A browser without a graphics
    // card draws a few frames a second, too few to walk all the way in.)
    await again.close();
    await expect.poll(() => app!.world.regionOf(id), { timeout: 10_000 }).toBeUndefined();
    world.store.savePosition(id, shop.door.x + 1, shop.door.y - 1.5, 'sanctum', newCharacter());
    const inside = await context.newPage();
    inside.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    await inside.goto(`${world.base}/`);
    await inside.waitForSelector('#game canvas', { timeout: 20_000 });
    await inside.waitForResponse((r) => /\/wished-art\/kit-houses\/.+\/storey-1\.png/.test(r.url()), { timeout: 30_000 });
    await inside.waitForTimeout(3000);
    await inside.screenshot({ path: resolve(shots, 'camera-inside.png') });
    expect(at().y, 'standing in the shop').toBeLessThan(shop.door.y);
    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });

  it('lets the Owner look through the old top-down view, and come back', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    const { token } = account(world.store, 'Ego', 'owner');
    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    await page.goto(`${world.base}/`);
    await page.waitForSelector('#game canvas', { timeout: 20_000 });

    // Switched in the Account window; the page reloads through the other camera.
    await page.click('#account-button');
    expect(await page.locator('#old-view').textContent()).toBe('Look through the old top-down view');
    await page.click('#old-view');
    await page.waitForEvent('load');
    expect(await page.evaluate(() => localStorage.getItem('co-mmo.camera'))).toBe('top-down');
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'camera-old-view.png') });
    await page.click('#account-button');
    await page.click('#old-view');
    await page.waitForEvent('load');
    expect(await page.evaluate(() => localStorage.getItem('co-mmo.camera'))).toBeNull();
    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
