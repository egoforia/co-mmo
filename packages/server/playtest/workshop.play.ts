// The world editor's new tools, in a real browser: the Owner makes a blank
// workshop land and builds the testbed's terrace bay (Bay 2) on it from
// nothing with the in-game editor (three open terraces stepping up, and a
// bookmark to look from), as drafts only it sees until it publishes them,
// looks at each floor with the floor picker, picks a
// terrace with Select and takes it away and back, goes to the bookmark,
// stands a shopkeeper on the terrace and trades with them, and designs a kit
// building with battlements and towers.
// The terraces must come out the same as the testbed's. Screenshots land in
// playtest-results/.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { ARCH_TESTBED_REGION, generateRegion, newCharacter, type Storey } from '@co-mmo/shared';
import { account, api, app } from '../test/helpers.ts';
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

/** Where a tile's middle is on the page, on the floor the editor shows. */
async function screenOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('#game canvas').boundingBox())!;
  const at = await page.evaluate(([tx, ty]) => {
    // The scene is on the window for playtests (main.ts).
    const scene = (window as unknown as { scene: { currentMap: unknown; tileCorners(m: unknown, x: number, y: number): { x: number; y: number }[]; cameras: { main: { worldView: { x: number; y: number }; zoom: number } } } }).scene;
    const corners = scene.tileCorners(scene.currentMap, tx!, ty!);
    const cam = scene.cameras.main;
    const mid = corners.reduce((a, c) => ({ x: a.x + c.x / 4, y: a.y + c.y / 4 }), { x: 0, y: 0 });
    return { x: (mid.x - cam.worldView.x) * cam.zoom, y: (mid.y - cam.worldView.y) * cam.zoom };
  }, [x, y]);
  return { x: box.x + at.x, y: box.y + at.y };
}

/** Clicks a tile's middle on the floor the editor shows. */
async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const at = await screenOf(page, x, y);
  // The editor's window stands right of the middle; the bars run along the top.
  if (at.x > 680 || at.y < 60 || at.y > 580) throw new Error(`Tile ${x}, ${y} is at ${Math.round(at.x)}, ${Math.round(at.y)} on the page, under the editor or the bars.`);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y);
}

/** A storey as the bay compares them: where, how big, which floor, open or not, and its look. */
const shape = (s: Storey) => ({ x: s.x, y: s.y, width: s.width, height: s.height, floor: s.floor, open: !!s.open, style: s.style });

describe('the world editor in a workshop land', () => {
  it('builds the testbed\'s terrace bay from nothing', async () => {
    const world = await playWorld({ clientDir, kitSheets: resolve(root, 'assets/kit-sheets') });
    const problems: string[] = [];
    const { id, token } = account(world.store, 'Ego', 'owner');
    const made = await api(world.base, '/api/world-edits/lands', token, 'POST', { name: 'Terrace Lab', biome: 'frostpeak' });
    expect(made.body.ok).toBe(true);
    const region: string = made.body.region;
    world.store.savePosition(id, 106.5, 46.5, region, newCharacter(), 0);
    const land = () => app!.world.region(region)!.map;
    const edits = () => world.store.worldEdits(region).edits;

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
    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .tools');
    // Let the land settle (the editor reads its edits) before pointing at it.
    await page.waitForTimeout(1500);

    /** Turns the camera so these tiles' middle (on the floor shown) sits left of the editor's window, clear of the chat and the bars. */
    const aim = async (a: [number, number], b: [number, number]) => {
      await page.evaluate(([ax, ay, bx, by]) => {
        type V = { x: number; y: number };
        const scene = (window as unknown as { scene: { currentMap: unknown; tileCorners(m: unknown, x: number, y: number): V[]; cameras: { main: { zoom: number; stopFollow(): void; centerOn(x: number, y: number): void } } } }).scene;
        const mid = [scene.tileCorners(scene.currentMap, ax!, ay!)[0]!, scene.tileCorners(scene.currentMap, bx!, by!)[2]!];
        const cam = scene.cameras.main;
        cam.stopFollow();
        cam.centerOn((mid[0]!.x + mid[1]!.x) / 2 + 240 / cam.zoom, (mid[0]!.y + mid[1]!.y) / 2 + 60 / cam.zoom);
      }, [...a, ...b]);
      await page.waitForTimeout(300);
    };

    /** Lays an open terrace of the eyrie's look on a floor, corner to corner, the editor showing that floor. */
    const terrace = async (floor: number, from: [number, number], to: [number, number]) => {
      const before = edits().length;
      await page.selectOption('#editor select[name="view-floor"]', String(floor));
      await page.click('#editor [data-tool="storey"]');
      await page.selectOption('#editor select[name="storey"]', String(floor));
      await page.selectOption('#editor select[name="style"]', 'frostpeak-eyrie');
      await page.check('#editor input[name="open"]');
      await aim(from, to);
      await clickTile(page, ...from);
      await clickTile(page, ...to);
      await expect.poll(() => edits().length, { timeout: 10_000 }).toBe(before + 1);
    };

    await terrace(1, [100, 40], [111, 51]);
    await terrace(2, [102, 40], [109, 45]);
    await terrace(4, [118, 40], [123, 45]);

    // Drafts: the editor shows them, players do not see them yet.
    const seen = () => page.evaluate(() => (window as unknown as { scene: { currentMap: { storeys: unknown[] } } }).scene.currentMap.storeys.length);
    await expect.poll(seen, { timeout: 10_000 }).toBe(3);
    expect(land().storeys).toHaveLength(0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shots, 'workshop-drafts.png') });
    await page.click('#editor [data-publish]');
    await expect.poll(() => land().storeys.length, { timeout: 10_000 }).toBe(3);

    // The bay matches the testbed's, terrace for terrace.
    const testbed = generateRegion(ARCH_TESTBED_REGION).storeys.filter((s) => s.y === 40 && s.x >= 100 && s.x < 130);
    expect(land().storeys.map(shape)).toEqual(testbed.map(shape));

    // Select the summit, take it away, and take that back: made live at once this time.
    await page.check('#editor input[name="live"]');
    await page.click('#editor [data-tool="select"]');
    await aim([120, 42], [120, 42]);
    await clickTile(page, 120, 42);
    await expect.poll(() => page.locator('#editor .picked strong').textContent()).toBe('A terrace');
    await page.click('#editor [data-pick="remove"]');
    await expect.poll(() => land().storeys.length, { timeout: 10_000 }).toBe(2);
    await page.click('#editor [data-undo]');
    await expect.poll(() => land().storeys.length, { timeout: 10_000 }).toBe(3);

    // A bookmark on the first terrace, and going there.
    await page.selectOption('#editor select[name="view-floor"]', '1');
    await aim([100, 40], [111, 51]);
    await page.click('#editor [data-tool="bookmark"]');
    await page.fill('#editor input[name="name"]', 'Terrace floor');
    await page.fill('#editor input[name="note"]', 'High terrace open interior floor');
    await page.locator('#editor input[name="note"]').blur();
    await clickTile(page, 106, 46);
    await expect.poll(() => land().bookmarks?.length ?? 0, { timeout: 10_000 }).toBe(1);
    expect(land().bookmarks![0]).toMatchObject({ name: 'Terrace floor', x: 106.5, y: 46.5, floor: 1, note: 'High terrace open interior floor' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shots, 'workshop-terraces-floor-1.png') });
    await page.click('#editor .bookmarks-box summary');
    await page.click('#editor [data-go="0"]');
    await page.waitForFunction(() => (window as unknown as { scene: { floor: number } }).scene.floor === 1, undefined, { timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(shots, 'workshop-bookmark.png') });

    // Someone new on the terrace: a smith who sells tools, buys, and makes masters of smithing.
    await page.click('#editor [data-tool="person"]');
    await page.fill('#editor input[name="name"]', 'Hesper');
    await page.fill('#editor input[name="greeting"]', 'Mind the forge, traveller.');
    await page.locator('#editor input[name="greeting"]').blur();
    await page.selectOption('#editor select[name="look"]', 'frostpeak-kaen');
    await page.selectOption('#editor select[name="wares"]', 'tools:smithing');
    await page.check('#editor input[name="buys"]');
    await page.selectOption('#editor select[name="masters"]', 'smithing');
    await page.selectOption('#editor select[name="view-floor"]', '1');
    await aim([100, 40], [111, 51]);
    await clickTile(page, 108, 46);
    await expect.poll(() => land().npcs.find((n) => n.name === 'Hesper')?.floor, { timeout: 10_000 }).toBe(1);
    // Spoken to and traded with in the game, the editor closed.
    await page.click('#editor .close');
    app!.world.local(region)!.placePlayer(id, 107.5, 46.5, 1);
    await page.evaluate(() => {
      const scene = (window as unknown as { scene: { me: { body: unknown }; cameras: { main: { startFollow(b: unknown): void } } } }).scene;
      scene.cameras.main.startFollow(scene.me.body);
    });
    await page.waitForTimeout(1500);
    await page.keyboard.press('e');
    await expect.poll(() => page.locator('#dialogue').textContent(), { timeout: 10_000 }).toContain('Mind the forge, traveller.');
    await page.click('#dialogue [data-shop]');
    await expect.poll(() => page.locator('#shop').textContent(), { timeout: 10_000 }).toContain('Become a master');
    await page.screenshot({ path: resolve(shots, 'workshop-person.png') });
    await page.click('#shop [data-close]');
    await page.click('#edit-world-button');
    await page.waitForSelector('#editor:not([hidden]) .tools');
    await page.check('#editor input[name="live"]');

    // A kit building from the designer: a flat roof behind battlements with towers at the front, its shape checked as it is chosen.
    await page.click('#editor [data-tool="kit"]');
    await page.selectOption('#editor select[name="style"]', 'sanctum-arcanum');
    for (const name of ['across', 'deep']) {
      await page.fill(`#editor input[name="${name}"]`, '4');
      await page.dispatchEvent(`#editor input[name="${name}"]`, 'change');
    }
    await page.selectOption('#editor select[name="roof"]', 'flat');
    await page.check('#editor input[name="battlements"]');
    await page.selectOption('#editor select[name="towers"]', 'front');
    await expect.poll(() => page.locator('#editor .tool-notes li').first().textContent()).toBe('Shape checks: every part meets, nothing floats.');
    await page.selectOption('#editor select[name="view-floor"]', '0');
    await aim([96, 60], [106, 70]);
    await clickTile(page, 96, 60);
    await expect.poll(() => land().buildings.length, { timeout: 10_000 }).toBe(1);
    expect(land().buildings[0]).toMatchObject({ x: 96, y: 60, width: 10, height: 10, kit: { W: 4, D: 4, roof: 'flat', battlements: true } });
    // The server builds its kit house from the spec (a few seconds in a worker), then every browser draws it.
    const status = async () => (await api(world.base, `/api/kit-houses?region=${region}`, token)).body.houses[0]?.status;
    await expect.poll(status, { timeout: 90_000, interval: 2000 }).toBe('ready');
    // Seen from the ground outside it, the editor closed.
    await page.click('#editor .close');
    app!.world.local(region)!.placePlayer(id, 101, 76, 0);
    await page.waitForFunction(() => (window as unknown as { scene: { floor: number } }).scene.floor === 0, undefined, { timeout: 10_000 });
    await page.evaluate(() => {
      const scene = (window as unknown as { scene: { me: { body: unknown }; cameras: { main: { startFollow(b: unknown): void } } } }).scene;
      scene.cameras.main.startFollow(scene.me.body);
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: resolve(shots, 'workshop-kit-building.png') });

    expect(problems).toEqual([]);
    expect(world.problems()).toEqual([]);
    await context.close();
  }, 300_000);
});
