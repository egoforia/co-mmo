// The world editor, in a real browser: a Steward opens it from the HUD,
// plants a tree beside them, takes it back, builds a house with a road to
// its door and places a monster spawn, while a robot player in the same
// land is shown each change. Screenshots land in playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { Tile, generateRegion, newCharacter, regionDef, type RegionMap } from '@co-mmo/shared';
import { account, app } from '../test/helpers.ts';
import { chooseTool, goLive, pickAsset, playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
/** Half a ground diamond across and down on a 1280-wide screen: 160 by 80 at the game's zoom there, a half. */
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

/** A tile of open ground with this many open tiles all around it. */
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

describe('the world editor', () => {
  it('lets a Steward plant, undo, build a house with a road, and place monsters', async () => {
    const world = await playWorld({ clientDir });
    const problems: string[] = [];
    const map = generateRegion(regionDef('sanctum')!);
    const spot = openGround(map, { x: map.spawn.x - 20, y: map.spawn.y + 30 }, 6);
    const { id, token } = account(world.store, 'Sten', 'steward');
    world.store.savePosition(id, spot.x + 0.5, spot.y + 0.5, 'sanctum', newCharacter());
    const watcher = await world.bot('Pip', { region: 'sanctum' });
    const welcomes = () => watcher.log.filter((m) => m.t === 'welcome').length;
    const seen = welcomes();

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
    /** Clicks the tile this many tiles east and south of the one we stand on. */
    const clickTile = (dx: number, dy: number) => page.mouse.click(centre.x + (dx - dy) * HALF_W, centre.y + (dx + dy) * HALF_H);
    const tile = (x: number, y: number) => app!.world.home.map.tiles[y * app!.world.home.map.width + x];
    const edits = () => world.store.worldEdits('sanctum').edits;

    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .editor-rail');
    // These changes are for everyone at once, not drafts.
    await goLive(page);

    // Plant a tree three tiles south (east of us is under the editor's window).
    await chooseTool(page, 'paint');
    await page.selectOption('#editor select[name="tile"]', 'tree');
    await clickTile(0, 3);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(1);
    expect.soft(tile(spot.x, spot.y + 3), 'a tree three tiles south').toBe(Tile.Tree);
    await expect.poll(welcomes, { timeout: 5_000 }).toBeGreaterThan(seen);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shots, 'editor-tree.png') });

    // Take it back.
    await page.click('#editor [data-undo]');
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(0);
    expect.soft(tile(spot.x, spot.y + 3), 'the tree is gone again').toBe(Tile.Ground);

    // A road west (east of us is under the editor's window), and a small house at its end.
    await chooseTool(page, 'road');
    await clickTile(-1, 1);
    await clickTile(-7, 1);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(1);
    await chooseTool(page, 'house');
    await page.selectOption('#editor select[name="size"]', '0');
    await clickTile(-8, 1);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(2);
    const house = app!.world.home.map.buildings.at(-1)!;
    expect.soft(house.door, 'the doorway is on the road\'s end').toEqual({ x: spot.x - 8, y: spot.y });
    expect.soft(tile(spot.x - 2, spot.y + 1), 'the road').toBe(Tile.Path);

    // Monsters to the south.
    await chooseTool(page, 'spawn');
    await pickAsset(page, 'creature', 'lantern-moth');
    const before = app!.world.home.creatureIds().length;
    await clickTile(2, 5);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(3);
    expect.soft(app!.world.home.creatureIds().length, 'four more monsters').toBe(before + 4);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'editor-house.png') });
    // With Select and nothing picked, the panel shows the land: its three changes.
    await chooseTool(page, 'select');
    await expect.poll(() => page.locator('#editor [data-edit]').count()).toBe(3);

    // The Plan camera (Tab): the land from above, where the same tools work. A tree four tiles south of us.
    await page.keyboard.press('Tab');
    const plan = page.locator('#editor .editor-plan canvas');
    await plan.waitFor();
    await chooseTool(page, 'paint');
    await page.selectOption('#editor select[name="tile"]', 'tree');
    const box = (await plan.boundingBox())!;
    await page.mouse.click(box.x + ((spot.x + 0.5) / map.width) * box.width, box.y + ((spot.y + 4.5) / map.height) * box.height);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(4);
    expect.soft(tile(spot.x, spot.y + 4), 'a tree drawn on the plan').toBe(Tile.Tree);
    await page.screenshot({ path: resolve(shots, 'editor-plan.png') });
    // The Architect has its tab in the land panel, in either camera.
    await chooseTool(page, 'select');
    await page.click('#editor [data-land-tab="architect"]');
    await page.waitForSelector('#editor #architect-form textarea');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.locator('#editor .editor-plan').isHidden()).toBe(true);

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
