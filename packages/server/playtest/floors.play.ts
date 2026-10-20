// Floors above and below the ground, in a real browser: the Owner opens the
// world editor inside the Sanctum Arcanum, gives it a floor up and one down,
// walks up the stairs and back down, and is carried into the cellar. Each
// floor is drawn on its own: upstairs over the shop, underground with the
// land above out of sight, and still upstairs after the page reloads.
// Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildFloors, collides, generateRegion, newCharacter, regionDef } from '@co-mmo/shared';
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

describe('floors', () => {
  it('let the Owner add floors to a house, and walk up, down and into the cellar', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    // Where the stairs will go, worked out the way the editor lays them.
    const map = generateRegion(regionDef('sanctum')!);
    const shop = map.buildings.find((b) => b.style === 'sanctum-arcanum')!;
    expect(buildFloors(map, shop, 1, 1)).toBe(true);
    const up = map.stairways.find((s) => s.lower === 0)!;
    const start = { x: up.bottom.x, y: up.bottom.y + 1 };
    expect(collides(map, start.x, start.y), 'room to stand south of the stairs').toBe(false);
    const { id, token } = account(world.store, 'Robo', 'owner');
    world.store.savePosition(id, start.x, start.y, 'sanctum', newCharacter());

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => problems.push(`The page threw: ${err.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`The page logged an error: ${m.text()}`);
    });
    await context.addInitScript((t) => localStorage.setItem('co-mmo.token', t), token);
    await page.goto(`${world.base}/`);
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    const canvas = (await page.locator('#game canvas').boundingBox())!;
    const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    const floor = () => app!.world.home.position(id)?.floor ?? 0;

    // The Floors tool, clicked on the shop we stand in.
    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .tools');
    await page.click('#editor [data-tool="floors"]');
    await page.selectOption('#editor select[name="up"]', '1');
    await page.selectOption('#editor select[name="down"]', '1');
    await page.mouse.click(centre.x, centre.y);
    await expect.poll(() => world.store.worldEdits('sanctum').edits.length, { timeout: 10_000 }).toBe(1);
    expect(app!.world.home.map.stairways).toEqual(map.stairways);
    await page.click('#editor .close');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'floors-ground.png') });

    // North up the stairs.
    await hold(page, 'ArrowUp', () => floor() === 1);
    expect(floor(), 'up the stairs').toBe(1);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(shots, 'floors-upstairs.png') });

    // Back south, down again.
    await hold(page, 'ArrowDown', () => floor() === 0);
    expect(floor(), 'back down').toBe(0);

    // Into the cellar.
    const cellar = app!.world.home.map.stairways.find((s) => s.upper === 0)!;
    app!.world.local('sanctum')!.placePlayer(id, cellar.bottom.x, cellar.bottom.y, -1);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'floors-cellar.png') });

    // Coming back draws the floor we are on in place.
    app!.world.local('sanctum')!.placePlayer(id, up.top.x, up.top.y, 1);
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector('#game canvas', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    expect(floor(), 'still upstairs after coming back').toBe(1);
    await page.screenshot({ path: resolve(shots, 'floors-isometric.png') });

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
