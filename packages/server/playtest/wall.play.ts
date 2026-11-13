// The Wall tool, in a real browser: a Steward chooses Wall under Build, R
// turns its side (Shift R back), a line dragged over the ground stands walls
// on that side of each tile on the server and the game draws them upright;
// ticking "Take walls down" and dragging again takes them away. Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { Tile, generateRegion, newCharacter, regionDef, wallOn, type RegionMap } from '@co-mmo/shared';
import { account, app } from '../test/helpers.ts';
import { chooseTool, goLive, playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
/** Half a ground diamond across and down on a 1280-wide screen at the game's zoom there. */
const HALF_W = 40;
const HALF_H = 20;
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

/** A tile of open ground with this many open tiles all around it, near a spot. */
function openGround(map: RegionMap, near: { x: number; y: number }, room: number): { x: number; y: number } {
  const ground = (x: number, y: number) => map.tiles[y * map.width + x] === Tile.Ground;
  for (let r = 0; r < 120; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const [x, y] = [Math.floor(near.x) + dx, Math.floor(near.y) + dy];
        let clear = true;
        for (let j = -room; j <= room && clear; j++) for (let i = -room; i <= room && clear; i++) clear = ground(x + i, y + j);
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open ground');
}

/** How many wall faces standing on a tile's side the game draws. */
const wallsDrawn = (page: Page) => page.evaluate(() => {
  const scene = (window as unknown as { scene: { children: { list: { getData?: (k: string) => unknown }[] } } }).scene;
  return scene.children.list.filter((o) => o.getData?.('edgeWall')).length;
});

describe('the Wall tool', () => {
  it('stands walls on the side R turns to, which stop walkers, and takes them down', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const map = generateRegion(regionDef('sanctum')!);
    const spot = openGround(map, { x: map.spawn.x - 20, y: map.spawn.y + 30 }, 6);
    const { id, token } = account(world.store, 'Sten', 'steward');
    world.store.savePosition(id, spot.x + 0.5, spot.y + 0.5, 'sanctum', newCharacter());

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
    /** The middle of the tile this many tiles east and south of the one we stand on. */
    const tileAt = (dx: number, dy: number) => ({ x: centre.x + (dx - dy) * HALF_W, y: centre.y + (dx + dy) * HALF_H });
    const edits = () => world.store.worldEdits('sanctum').edits;
    const live = () => app!.world.home.map;

    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .editor-rail');
    await goLive(page);

    // Wall is under Build; R turns its side round, Shift R back.
    await chooseTool(page, 'wall');
    const side = () => page.locator('#editor select[name="side"]').inputValue();
    expect.soft(await side()).toBe('north');
    await page.keyboard.press('r');
    expect.soft(await side(), 'R: the next side').toBe('east');
    await page.keyboard.press('r');
    await page.keyboard.press('Shift+R');
    expect.soft(await side(), 'R, then Shift R: back to east').toBe('east');
    await page.selectOption('#editor select[name="shape"]', 'line');

    // A line south from three tiles west of us: walls on the east side of each tile.
    const from = tileAt(-3, 0);
    const to = tileAt(-3, 3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(1);
    const laid = edits()[0]!;
    expect.soft(laid.kind).toBe('wall');
    expect.soft(laid.kind === 'wall' && laid.side).toBe('east');
    expect.soft(laid.kind === 'wall' && laid.tiles.length, 'a line of four tiles').toBe(4);
    for (let dy = 0; dy <= 3; dy++) expect.soft(wallOn(live(), spot.x - 3, spot.y + dy, 'east'), `a wall east of tile ${dy}`).toBeDefined();
    await expect.poll(() => wallsDrawn(page), { timeout: 10_000 }).toBe(4);
    await page.mouse.move(tileAt(-1, 4).x, tileAt(-1, 4).y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(shots, 'wall-line.png') });

    // Take walls down: the same line again.
    await page.check('#editor input[name="down"]');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(2);
    expect.soft(wallOn(live(), spot.x - 3, spot.y, 'east'), 'the walls are down').toBeUndefined();
    await expect.poll(() => wallsDrawn(page), { timeout: 10_000 }).toBe(0);

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
