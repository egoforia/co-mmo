// The robot tailors a Windfelt outfit in Frostpeak (Region fashion plan):
// a Falcon makes a hood, a tunic leaning toward Spirit and a cloak from
// mountain wool and snow hare fur, wears the three for the full-style bonus,
// and buys the boots from Ysolde, the home tailor.

import { describe, expect, it } from 'vitest';
import { ITEMS, SHOPS, copyBase, copyWords, dodgeChance, fullStyles, toolId, type Character, type ServerMessage } from '@co-mmo/shared';
import type { Bot } from './bot.ts';
import { playWorld } from './harness.ts';

/** The id in the bag of the newest copy of a base item, if any. */
const copyOf = (c: Character, base: string) => c.inventory.map((s) => s.item).reverse().find((id) => id !== base && copyBase(id) === base);

const hasCopy = (base: string) => (m: ServerMessage) => m.t === 'character' && Boolean(copyOf(m.character, base));

/** Makes a recipe and waits for its copy to be in the bag. */
async function make(bot: Bot, recipe: string, lean?: 'agility' | 'spirit'): Promise<string | undefined> {
  await bot.ask({ t: 'craft', recipe, ...(lean ? { lean } : {}) }, hasCopy(recipe), `a ${recipe} to be made`).catch(() => undefined);
  return copyOf(bot.character, recipe);
}

/** Wears an item and waits for it to be on. */
async function wear(bot: Bot, item: string): Promise<void> {
  const slot = ITEMS[item]!.slot!;
  await bot.ask({ t: 'equip', item }, (m) => m.t === 'character' && m.character.equipment[slot] === item, `${item} to be worn`).catch(() => undefined);
}

describe('the robot wears a region style', () => {
  it('tailors Windfelt garments, wears a full style and buys the boots at home', async () => {
    const world = await playWorld();
    const bot = await world.bot('Ysa', {
      region: 'frostpeak',
      character: {
        race: 'falcon',
        gold: 100,
        crafts: { tailoring: { level: 7, xp: 0 }, leatherwork: { level: 5, xp: 0 } },
        inventory: [
          { item: 'bible', qty: 1 },
          { item: toolId('tailoring', 1), qty: 1 },
          { item: 'mountain-wool', qty: 12 },
          { item: 'snow-hare-fur', qty: 4 },
          { item: 'frost-pine', qty: 2 },
        ],
      },
    });

    const hood = await make(bot, 'windfelt-hood');
    const tunic = await make(bot, 'windfelt-tunic', 'spirit');
    const cloak = await make(bot, 'windfelt-cloak');
    expect.soft(hood && tunic && cloak, 'the hood, tunic and cloak are made').toBeTruthy();
    if (!hood || !tunic || !cloak) return void expect(world.problems()).toEqual([]);

    // Made by a Falcon: their lean, the tunic toward Spirit as asked, and the card says who made it.
    expect.soft(ITEMS[tunic]!.copy, 'the tunic carries its maker').toMatchObject({ maker: { name: 'Ysa' }, people: 'falcon', lean: 'spirit', trait: 'warm' });
    expect.soft(ITEMS[tunic]!.bonus?.spirit, 'the tunic leans toward Spirit').toBeGreaterThanOrEqual(1);
    expect.soft(copyWords(ITEMS[hood]), 'the hood says who tailored it').toMatch(/^Tailored by Ysa\./);

    const dodge = dodgeChance(bot.character);
    await wear(bot, hood);
    await wear(bot, tunic);
    expect.soft(fullStyles(bot.character), 'two pieces are not yet a full style').toEqual([]);
    await wear(bot, cloak);
    expect.soft(fullStyles(bot.character), 'three Windfelt pieces are a full style').toEqual(['windfelt']);
    expect.soft(dodgeChance(bot.character), 'the full Windfelt style adds dodge').toBeGreaterThan(dodge);

    // Ysolde sells Windfelt at home: Common, standard quality, with her own Falcon lean.
    const talk = await bot.talkTo('ysolde');
    expect.soft(talk?.shop, 'Ysolde keeps a shop').toBe(true);
    expect.soft(SHOPS.ysolde?.sells.some((s) => s.item === 'windfelt-boots'), 'Ysolde sells Windfelt boots').toBe(true);
    await bot.ask({ t: 'shop', action: 'buy', npc: 'ysolde', id: 'windfelt-boots' }, hasCopy('windfelt-boots'), 'the boots to be bought').catch(() => undefined);
    const boots = copyOf(bot.character, 'windfelt-boots');
    expect.soft(boots && ITEMS[boots]!.copy, 'the boots are Ysolde\'s').toMatchObject({ quality: 100, maker: { kind: 'npc', name: 'Ysolde' }, people: 'falcon' });
    if (boots) await wear(bot, boots);
    expect.soft(bot.character.equipment.feet, 'the boots go in the feet slot').toBe(boots);

    expect(world.problems()).toEqual([]);
  });
});
