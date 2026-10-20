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
import { playWorld } from './harness.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const clientDir = resolve(root, 'packages/client/dist');
const shots = resolve(root, 'playtest-results');
/** Pixels a tile spans on a 1280-wide screen (the game's zoom there is a half). */
const TILE_ON_SCREEN = 64;
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
    const clickTile = (dx: number, dy: number) => page.mouse.click(centre.x + dx * TILE_ON_SCREEN, centre.y + dy * TILE_ON_SCREEN);
    const tile = (x: number, y: number) => app!.world.home.map.tiles[y * app!.world.home.map.width + x];
    const edits = () => world.store.worldEdits('sanctum').edits;

    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .tools');

    // Plant a tree three tiles east.
    await page.click('#editor [data-tool="paint"]');
    await page.selectOption('#editor select[name="paint"]', 'tree');
    await clickTile(3, 0);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(1);
    expect.soft(tile(spot.x + 3, spot.y), 'a tree three tiles east').toBe(Tile.Tree);
    await expect.poll(welcomes, { timeout: 5_000 }).toBeGreaterThan(seen);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shots, 'editor-tree.png') });

    // Take it back.
    await page.click('#editor [data-undo]');
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(0);
    expect.soft(tile(spot.x + 3, spot.y), 'the tree is gone again').toBe(Tile.Ground);

    // A road east, and a small house at its end.
    await page.click('#editor [data-tool="road"]');
    await clickTile(1, 1);
    await clickTile(7, 1);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(1);
    await page.click('#editor [data-tool="house"]');
    await page.selectOption('#editor select[name="size"]', '0');
    await clickTile(8, 1);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(2);
    const house = app!.world.home.map.buildings.at(-1)!;
    expect.soft(house.door, 'the doorway is on the road\'s end').toEqual({ x: spot.x + 8, y: spot.y });
    expect.soft(tile(spot.x + 2, spot.y + 1), 'the road').toBe(Tile.Path);

    // Monsters to the west.
    await page.click('#editor [data-tool="spawn"]');
    await page.selectOption('#editor select[name="creature"]', 'lantern-moth');
    const before = app!.world.home.creatureIds().length;
    await clickTile(-5, 2);
    await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(3);
    expect.soft(app!.world.home.creatureIds().length, 'four more monsters').toBe(before + 4);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(shots, 'editor-house.png') });
    await expect.poll(() => page.locator('#editor .edits li').count()).toBe(3);

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  });
});
