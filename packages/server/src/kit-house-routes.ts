import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildingKit } from '@co-mmo/shared';
import type { KitHouses } from './assets/building-kit/kit-houses.ts';
import { json } from './http.ts';
import type { Account } from './store.ts';
import type { World } from './world.ts';

// The kit houses of a region's buildings, for the isometric camera every
// player looks through. A house is drawn the first time it is asked for,
// which takes the server a few seconds of work in a worker; after that it
// is kept in the art folder, so later asks only read it.

/** Answers GET /api/kit-houses?region=<id>; false when the request is not for it. */
export async function handleKitHouses(req: IncomingMessage, res: ServerResponse, url: URL, account: Account | undefined, ctx: { world: World; houses: KitHouses }): Promise<boolean> {
  if (url.pathname !== '/api/kit-houses' || req.method !== 'GET') return false;
  if (!account) return json(res, 401, { error: 'unauthorized' }), true;
  const region = ctx.world.regions.get(url.searchParams.get('region') ?? '');
  if (!region) return json(res, 404, { error: 'not_found', message: 'There is no land by that name.' }), true;
  const houses: buildingKit.KitHouseInfo[] = [];
  for (const [i, b] of region.map.buildings.entries()) {
    const house = buildingKit.kitHouse(b);
    if (house) houses.push(await ctx.houses.info(house, i));
  }
  return json(res, 200, { houses }), true;
}
