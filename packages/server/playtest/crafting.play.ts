// Two robots gather, craft and trade (gather and craft plan, step 7): a
// Cervid gathers sage with the sickle their people gave them and brews a
// tonic, then fells an oak branch and trades it to a Scorpid, who digs copper
// with their own pick and smiths a pair of pliers from it.

import { describe, expect, it } from 'vitest';
import { itemCount, startCharacter, type GatherSpot, type ServerMessage } from '@co-mmo/shared';
import { playWorld } from './harness.ts';
import type { Bot } from './bot.ts';

/** Gathers at the nearest spots of a kind until the bag holds `want` of the item, trying a few spots. */
async function gather(bot: Bot, kind: string, item: string, want: number): Promise<boolean> {
  const tried = new Set<string>();
  for (let tries = 0; tries < 5 && itemCount(bot.character, item) < want; tries++) {
    const at = bot.at;
    const spot = bot.map.spots
      .filter((s) => s.kind === kind && !tried.has(s.id))
      .sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0] as GatherSpot | undefined;
    if (!spot) return false;
    tried.add(spot.id);
    // Beside it: every spot stands with open ground all round.
    if (!(await bot.walkTo({ x: spot.x + 1.5, y: spot.y + 0.5 }, { near: 0.5, what: `the ${kind} spot`, quiet: true }))) continue;
    await bot.caughtUp();
    const before = itemCount(bot.character, item);
    const started = await bot.ask({ t: 'interact' }, (m) => m.t === 'gather' || m.t === 'notice', `gathering at the ${kind} spot`).catch(() => null);
    if (started?.t !== 'gather') continue;
    await bot.waitFor((m: ServerMessage) => m.t === 'character' && itemCount(m.character, item) > before, { what: `${item} from the spot`, ms: 8000 }).catch(() => undefined);
  }
  return itemCount(bot.character, item) >= want;
}

describe('robots gather, craft and trade', () => {
  it('gather with their people\'s tools, craft, and trade materials', async () => {
    const world = await playWorld();
    const moss = await world.bot('Moss', { region: 'sanctum', character: { ...startCharacter('cervid', 'warden'), gold: 20 } });
    const forge = await world.bot('Forge', { region: 'sanctum', character: { ...startCharacter('scorpid', 'warden'), gold: 20 } });
    await moss.tick();
    await forge.tick();

    // Their people's first tools came with them.
    expect.soft(itemCount(moss.character, 'tool-herbalism-1'), 'the Cervid has a sickle').toBe(1);
    expect.soft(itemCount(moss.character, 'tool-woodcarving-1'), 'the Cervid has an axe').toBe(1);
    expect.soft(itemCount(forge.character, 'tool-smithing-1'), 'the Scorpid has a pick').toBe(1);

    // Moss gathers sage and brews a tonic.
    expect.soft(await gather(moss, 'sanctum-sage', 'temple-sage', 2), 'Moss gathers two Temple Sage').toBe(true);
    const tonics = itemCount(moss.character, 'tonic');
    if (itemCount(moss.character, 'temple-sage') >= 2) {
      await moss.ask({ t: 'craft', recipe: 'sage-tonic' }, (m) => m.t === 'character' && itemCount(m.character, 'tonic') > tonics, 'a Sage Tonic to be made').catch(() => null);
      expect.soft(itemCount(moss.character, 'tonic'), 'Moss made a tonic').toBeGreaterThan(tonics);
      expect.soft(moss.character.crafts?.herbalism?.xp ?? 0, 'Herbalism grew').toBeGreaterThan(0);
    }

    // Moss fells an oak branch; Forge digs copper.
    expect.soft(await gather(moss, 'sanctum-branch', 'oak-branch', 1), 'Moss gathers an Oak Branch').toBe(true);
    expect.soft(await gather(forge, 'sanctum-copper', 'copper-ore', 2), 'Forge gathers two Copper Ore').toBe(true);

    // Moss trades the branch to Forge for 5 gold.
    await forge.walkTo(() => moss.at, { near: 2, what: 'Moss' });
    const asked = forge.mark();
    moss.send({ t: 'trade', action: 'request', name: 'Forge' });
    await forge.waitFor((m) => m.t === 'trade-request', { since: asked, ms: 15_000, what: "Moss's trade request" }).catch(() => undefined);
    forge.send({ t: 'trade', action: 'accept' });
    await moss.waitFor((m) => m.t === 'trade' && m.trade !== null, { since: asked, what: 'the trade window' }).catch(() => undefined);
    moss.send({ t: 'trade', action: 'offer', offer: { items: [{ item: 'oak-branch', qty: 1 }], gold: 0 } });
    forge.send({ t: 'trade', action: 'offer', offer: { items: [], gold: 5 } });
    await moss.waitFor((m) => m.t === 'trade' && m.trade?.mine.items.length === 1 && m.trade.theirs.gold === 5, { since: asked, what: 'both offers to show' }).catch(() => undefined);
    const done = forge.mark();
    moss.send({ t: 'trade', action: 'confirm' });
    forge.send({ t: 'trade', action: 'confirm' });
    await forge.waitFor((m) => m.t === 'character' && itemCount(m.character, 'oak-branch') > 0, { since: done, what: 'the branch to arrive' }).catch(() => undefined);
    expect.soft(itemCount(forge.character, 'oak-branch'), 'Forge has the branch').toBeGreaterThan(0);

    // Forge smiths pliers from copper and oak.
    if (itemCount(forge.character, 'oak-branch') > 0 && itemCount(forge.character, 'copper-ore') >= 2) {
      await forge.ask({ t: 'craft', recipe: 'tool-jewellery-1' }, (m) => m.t === 'character' && itemCount(m.character, 'tool-jewellery-1') > 0, 'Pliers to be made').catch(() => null);
      expect.soft(itemCount(forge.character, 'tool-jewellery-1'), 'Forge smithed pliers').toBe(1);
    }

    expect(world.problems()).toEqual([]);
  });
});
