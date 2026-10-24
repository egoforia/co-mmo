// The mini map, in a real browser: the Owner gives the Sanctum Arcanum a
// floor up and a cellar, and the map in the corner shows the ground floor
// around them, zooms in and out, looks at the floor above and the cellar
// without moving them, follows them up the stairs, maximizes, minimizes
// (drawing nothing) and closes, turned with the isometric camera.
// Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildFloors, generateRegion, newCharacter, regionDef } from '@co-mmo/shared';
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

const caption = (page: Page) => page.locator('#mini-map .mm-caption').textContent();

/** How many of the map's pixels have something drawn on them, out of every 97th. */
function painted(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#mini-map canvas')!;
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i]! > 0) n++;
    return n / Math.ceil(data.length / (4 * 97));
  });
}

describe('the mini map', () => {
  it('shows your floor, zooms, and looks at the floors above and below where you stand', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const map = generateRegion(regionDef('sanctum')!);
    const shop = map.buildings.find((b) => b.style === 'sanctum-arcanum')!;
    // The Sanctum has stairs of its own (the cathedral, the catacombs); the shop's are added after them.
    const own = map.stairways.length;
    expect(buildFloors(map, shop, 1, 1)).toBe(true);
    const shopStairs = map.stairways.slice(own);
    const up = shopStairs.find((s) => s.lower === 0)!;
    const start = { x: up.bottom.x, y: up.bottom.y + 1 };
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
    await page.waitForSelector('#mini-map:not([hidden])', { timeout: 10_000 });
    const canvas = (await page.locator('#game canvas').boundingBox())!;
    const floor = () => app!.world.home.position(id)?.floor ?? 0;

    // Out in the land there is only the ground to look at.
    await expect.poll(() => caption(page), { timeout: 15_000 }).toBe('The ground floor');
    expect(await painted(page), 'the land is drawn').toBeGreaterThan(0.9);

    await page.click('#edit-world-button');
    await page.click('#editor [data-tool="floors"]');
    await page.selectOption('#editor select[name="up"]', '1');
    await page.selectOption('#editor select[name="down"]', '1');
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await expect.poll(() => world.store.worldEdits('sanctum').edits.length, { timeout: 10_000 }).toBe(1);
    await page.click('#editor .close');
    await expect.poll(() => page.locator('#mini-map [data-act="up"]').isEnabled(), { timeout: 10_000 }).toBe(true);
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-ground.png') });

    // Zoom: in to the last step, out to the first, and back to where it was.
    const zoomIn = page.locator('#mini-map [data-act="in"]');
    const zoomOut = page.locator('#mini-map [data-act="out"]');
    while (await zoomIn.isEnabled()) await zoomIn.click();
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-near.png') });
    while (await zoomOut.isEnabled()) await zoomOut.click();
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-far.png') });
    for (let i = 0; i < 3; i++) await zoomIn.click();

    // Look up and down without moving.
    await page.click('#mini-map [data-act="up"]');
    expect(await caption(page)).toBe('Floor 1 (you are on the ground floor)');
    expect(await page.locator('#mini-map [data-act="up"]').isDisabled(), 'no floor 2').toBe(true);
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-look-up.png') });
    await page.click('#mini-map [data-act="down"]');
    await page.click('#mini-map [data-act="down"]');
    expect(await caption(page)).toBe('Underground floor 1 (you are on the ground floor)');
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-look-down.png') });
    expect(floor(), 'looking does not move you').toBe(0);
    await page.click('#mini-map [data-act="back"]');
    expect(await caption(page)).toBe('The ground floor');

    // Up the stairs, the map follows.
    await page.keyboard.down('ArrowUp');
    await expect.poll(floor, { timeout: 60_000 }).toBe(1);
    await page.keyboard.up('ArrowUp');
    await expect.poll(() => caption(page)).toBe('Floor 1');
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-upstairs.png') });

    // Maximized it is drawn larger; minimized only its title bar stays and nothing is drawn.
    const width = () => page.locator('#mini-map canvas').evaluate((c: HTMLCanvasElement) => c.width);
    const usual = await width();
    await page.click('#mini-map [data-act="max"]');
    await expect.poll(width, { timeout: 10_000 }).toBeGreaterThan(usual);
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-max.png') });
    await page.click('#mini-map [data-act="max"]');
    await expect.poll(width, { timeout: 10_000 }).toBe(usual);
    await page.click('#mini-map [data-act="min"]');
    expect(await page.locator('#mini-map canvas').isHidden()).toBe(true);
    expect(await width(), 'its canvas let go').toBe(0);
    await page.waitForTimeout(500);
    expect(await width(), 'not drawn while minimized').toBe(0);
    await page.locator('#mini-map').screenshot({ path: resolve(shots, 'mini-map-min.png') });
    await page.click('#mini-map [data-act="min"]');
    await expect.poll(width, { timeout: 10_000 }).toBe(usual);

    // Closed, M or the Map button brings it back.
    await page.click('#mini-map [data-act="close"]');
    expect(await page.locator('#mini-map').isHidden()).toBe(true);
    await page.keyboard.press('m');
    expect(await page.locator('#mini-map').isVisible()).toBe(true);
    await page.keyboard.press('m');
    expect(await page.locator('#mini-map').isHidden()).toBe(true);
    await page.click('#map-button');
    expect(await page.locator('#mini-map').isVisible()).toBe(true);

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
