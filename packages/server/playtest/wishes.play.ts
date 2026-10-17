// The robot makes wishes the way players do, by praying to the God (the
// offline God here, so nothing is paid), and then plays with what it got:
// wears the wished thing, fights the wished creature, talks to the wished
// person, learns and casts the wished power, loots the wished drop and walks
// into the wished land.

import { describe, expect, it } from 'vitest';
import { itemCount, type ContentEntry, type ContentMessage, type ServerMessage } from '@co-mmo/shared';
import type { Bot } from './bot.ts';
import { unreachable } from './checks.ts';
import { playWorld } from './harness.ts';

/** The content entry the God made for a granted card, once it reached the bot. */
async function granted(bot: Bot, title: string, since: number): Promise<ContentEntry | undefined> {
  const isIt = (m: ServerMessage) => m.t === 'content' && m.entries.some((e) => e.title === title && e.status === 'granted');
  const message = await bot.waitFor<ContentMessage>(isIt, { since, what: `"${title}" to appear in the world` }).catch(() => undefined);
  return message?.entries.find((e) => e.title === title);
}

/** Waits for a wish's picture to be painted (by the fake painter). */
async function painted(bot: Bot, id: string, since: number): Promise<boolean> {
  const isIt = (m: ServerMessage) => m.t === 'content' && m.entries.some((e) => e.id === id && Boolean(e.art));
  return Boolean(await bot.waitFor(isIt, { since, ms: 15_000, what: `the picture for wish ${id}` }).catch(() => undefined));
}

describe('the robot makes wishes', () => {
  it('wishes for a thing, a creature, a person, a power, a drop and a land, and plays with each', async () => {
    const world = await playWorld();
    const bot = await world.bot('Wisher', { role: 'owner', character: { favor: 60 } });

    // Small talk gets an answer and no card.
    const hello = await bot.pray('Hello God, how are you today?');
    expect.soft(hello.card, 'small talk offers no wish').toBeUndefined();
    expect.soft(hello.say.length, 'the God answers').toBeGreaterThan(0);

    // A thing to wear: in the bag, worn, and painted.
    let since = bot.mark();
    const lantern = await bot.wish('I wish for a glowing lantern');
    const lanternEntry = lantern && (await granted(bot, lantern.card.title, since));
    expect.soft(lanternEntry, 'the lantern was granted').toBeDefined();
    if (lanternEntry) {
      expect.soft(itemCount(bot.character, lanternEntry.id), 'the lantern is in the bag').toBe(1);
      expect.soft(await painted(bot, lanternEntry.id, since), 'the lantern is painted').toBe(true);
      await bot.ask({ t: 'equip', item: lanternEntry.id }, (m) => m.t === 'character' && Object.values(m.character.equipment).includes(lanternEntry.id), 'the lantern to be worn');
    }

    // A creature: three appear nearby, and one can be fought and looted.
    since = bot.mark();
    const beast = await bot.wish('I wish for a fierce wolf creature');
    const beastEntry = beast && (await granted(bot, beast.card.title, since));
    expect.soft(beastEntry, 'the wolf was granted').toBeDefined();
    if (beastEntry) {
      await bot.tick();
      const wolves = bot.snapshot?.creatures.filter((c) => c.kind === beastEntry.id) ?? [];
      expect.soft(wolves.length, 'wished wolves stand nearby').toBe(3);
      const fight = await bot.fight((c) => c.kind === beastEntry.id);
      expect.soft(fight.result, 'a wished wolf can be defeated').toBe('defeated');
      if (fight.result === 'defeated') await bot.lootNearest();
    }

    // A person: they stand nearby and answer.
    since = bot.mark();
    const bard = await bot.wish('I wish for a friendly bard');
    const bardEntry = bard && (await granted(bot, bard.card.title, since));
    expect.soft(bardEntry, 'the bard was granted').toBeDefined();
    if (bardEntry) {
      await bot.tick();
      const npc = bot.snapshot?.npcs.find((n) => n.id === bardEntry.id || n.name === bardEntry.title);
      expect.soft(npc, 'the bard stands nearby').toBeDefined();
      if (npc) {
        const talk = await bot.talkTo(npc.id);
        expect.soft(talk?.text, 'the bard answers').toBeTruthy();
      }
    }

    // A power: the scroll is read, the power learned and cast.
    since = bot.mark();
    const spell = await bot.wish('I wish for a fire bolt spell');
    const spellEntry = spell && (await granted(bot, spell.card.title, since));
    expect.soft(spellEntry, 'the spell was granted').toBeDefined();
    if (spellEntry) {
      const known = bot.character.abilities.length;
      await bot.ask({ t: 'use', item: spellEntry.id }, (m) => m.t === 'character' && m.character.abilities.length > known, 'the scroll to teach its power');
      const ability = bot.character.abilities.at(-1)!;
      const fight = bot.snapshot?.creatures.find((c) => c.kind === beastEntry?.id);
      if (fight) {
        await bot.walkTo({ x: fight.x, y: fight.y }, { near: 4, quiet: true });
        const cast = await bot.ask({ t: 'ability', ability, target: fight.id }, (m) => (m.t === 'hit' && m.ability === ability) || m.t === 'notice', 'the wished power to be cast').catch(() => null);
        expect.soft(cast?.t === 'hit' ? 'hit' : cast, 'the wished power strikes').toBe('hit');
      }
    }

    // A drop: walking mushrooms now drop goat horns too.
    since = bot.mark();
    const drop = await bot.wish('I wish walking mushrooms would drop goat horns');
    expect.soft(drop?.after.say, 'the God grants the drop').toMatch(/press E beside its body/);

    // Not enough Favor: the God says so and nothing is made.
    const poor = await world.bot('Pauper', { character: { favor: 0 } });
    const before = world.store.content.length;
    const answer = await poor.pray('I wish for a golden ring');
    if (answer.card) {
      const after = await poor.ask({ t: 'wish', card: answer.card.id, confirm: true }, (m) => m.t === 'god', 'the God to answer a wish without Favor');
      expect.soft((after as { say: string }).say, 'without Favor the God says so').toMatch(/Favor/);
    }
    expect.soft(world.store.content.length, 'no wish granted without Favor').toBe(before);

    // A land: a road appears, the robot walks into it, and everything there is in reach.
    since = bot.mark();
    const land = await bot.wish('I wish for a misty valley region with wolves');
    const landEntry = land && (await granted(bot, land.card.title, since));
    expect.soft(landEntry, 'the land was granted').toBeDefined();
    if (landEntry) {
      const regionId = landEntry.id;
      expect.soft(await bot.travelTo(regionId), 'the robot walks into the wished land').toBe(true);
      if (bot.region.id === regionId) bot.problems.push(...unreachable(bot.map, bot.at));
      expect.soft(await bot.travelTo('sanctum'), 'and back home').toBe(true);
    }

    expect(world.problems()).toEqual([]);
  });
});
