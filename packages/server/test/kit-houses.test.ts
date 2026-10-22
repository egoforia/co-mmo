import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { WORLD_REGIONS, buildingKit, generateRegion } from '@co-mmo/shared';
import { KitHouses } from '../src/assets/building-kit/kit-houses.ts';
import { KitSheets } from '../src/assets/building-kit/kit-sheets.ts';
import { account, start } from './helpers.ts';

const repo = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SHIPPED = join(repo, 'assets/kit-sheets');
const SLOW = 120_000;

/** The Sanctum Arcanum, as the kit builds it. */
function arcanum(): { house: buildingKit.KitHouse; index: number } {
  const map = generateRegion(WORLD_REGIONS.find((r) => r.id === 'sanctum')!);
  const index = map.buildings.findIndex((b) => b.style === 'sanctum-arcanum');
  return { house: buildingKit.kitHouse(map.buildings[index]!)!, index };
}

/** Asks for a house until it is no longer being drawn. */
async function settled(houses: KitHouses, house: buildingKit.KitHouse, index: number): Promise<buildingKit.KitHouseInfo> {
  for (;;) {
    const info = await houses.info(house, index);
    if (info.status !== 'building') return info;
    await houses.idle();
  }
}

describe('kit houses on the server', () => {
  it('draws the Sanctum Arcanum from the shipped sheets, checks it, and keeps it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-mmo-houses-'));
    const sheets = new KitSheets({ shippedDir: SHIPPED, dir: join(dir, 'kit-sheets'), style: 'flat' });
    // Coarse, to stay quick: the game draws at HOUSE_U.
    const houses = new KitHouses({ dir: join(dir, 'kit-houses'), url: '/wished-art/kit-houses', sheets, u: 40 });
    const { house, index } = arcanum();
    expect((await houses.info(house, index)).status).toBe('building');
    const info = await settled(houses, house, index);
    expect(info.failed ?? []).toEqual([]);
    expect(info.status).toBe('ready');
    expect(Object.keys(info.views!)).toEqual(['outside', 'storey-1']);
    expect(info.views!.outside!.normal).toMatch(new RegExp(`^/wished-art/kit-houses/${house.key}/outside-normal\\.png\\?v=\\d+$`));
    const files = await readdir(join(dir, 'kit-houses', house.key));
    expect(files.sort()).toEqual(['house.json', ...['outside', 'storey-1'].flatMap((v) => [`${v}-glow.png`, `${v}-normal.png`, `${v}.png`])].sort());
    // Every view on one frame, pinned where the kit's corner falls.
    const { width, height, origin, u } = info.frame!;
    expect(u).toBe(40);
    for (const v of ['outside', 'storey-1']) {
      const meta = await sharp(join(dir, 'kit-houses', house.key, `${v}.png`)).metadata();
      expect([meta.width, meta.height]).toEqual([width, height]);
    }
    expect(origin[0]).toBeGreaterThan(0);
    expect(origin[1]).toBeLessThan(height);
    // Kept: a server started again offers it at once, without drawing it again.
    const again = new KitHouses({ dir: join(dir, 'kit-houses'), url: '/wished-art/kit-houses', sheets, u: 40 });
    expect((await again.info(house, index)).status).toBe('ready');
    const kept = JSON.parse(await readFile(join(dir, 'kit-houses', house.key, 'house.json'), 'utf8'));
    expect(kept.paintings).toBe('shipped/sheet-4,shipped/sheet-2');
  }, SLOW);

  it('shows nothing until its look is painted, to every signed-in player', async () => {
    // The test server ships no kit sheets.
    const { base, store } = await start();
    const owner = account(store, 'Ego', 'owner');
    const player = account(store, 'Pip');
    const ask = (token: string, region = 'sanctum') => fetch(`${base}/api/kit-houses?region=${region}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await fetch(`${base}/api/kit-houses?region=sanctum`)).status).toBe(401);
    expect((await ask(owner.token, 'nowhere')).status).toBe(404);
    const { index } = arcanum();
    let houses: buildingKit.KitHouseInfo[] = [];
    for (let i = 0; i < 50; i++) {
      houses = ((await (await ask(player.token)).json()) as { houses: buildingKit.KitHouseInfo[] }).houses;
      if (houses.length && houses.every((h) => h.status !== 'building')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // Every kit house in the region (Arcanum, Temple, Cathedral, Scriptorium, Inn), waiting for its look to be painted.
    expect(houses).toHaveLength(5);
    expect(houses.find((h) => h.building === index)).toMatchObject({ status: 'failed' });
    for (const h of houses) expect(h.failed![0]).toMatch(/not painted yet/);
  });
});
