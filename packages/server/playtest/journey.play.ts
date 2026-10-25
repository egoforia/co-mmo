// The robot plays the first hours of the game as a new player would: it
// follows the quests from the Sanctum into the Woods and down to the Shore,
// fights, loots bodies, learns a power and uses it, and trades at a shop.

import { describe, expect, it } from 'vitest';
import { QUESTS, itemCount, type Character } from '@co-mmo/shared';
import type { Bot, FightResult } from './bot.ts';
import { playWorld } from './harness.ts';

/** Fights creatures of a kind until `count` are defeated, looting what they leave; walks back after a fall. */
async function defeat(bot: Bot, regionId: string, kind: string, count: number): Promise<{ won: number; looted: number; fell: number }> {
  let won = 0;
  let looted = 0;
  let fell = 0;
  // Bodies only sometimes hold something: fight a few more until one did.
  for (let tries = 0; (won < count || (looted === 0 && won < count + 4)) && tries < count * 3; tries++) {
    if (bot.region.id !== regionId && !(await bot.travelTo(regionId))) break;
    const fight: FightResult = await bot.hunt(kind);
    if (fight.result === 'fell') fell++;
    if (fight.result !== 'defeated') continue;
    won++;
    // The body falls where the creature did; its loot is anyone's.
    await bot.idle(150);
    if (await bot.lootNearest()) looted++;
  }
  return { won, looted, fell };
}

const quest = (c: Character, id: string) => c.quests.find((q) => q.id === id);

describe('the robot plays the first quests', () => {
  it('follows the quests through three regions, fighting, looting, learning and trading', async () => {
    const world = await playWorld();
    const bot = await world.bot('Pilgrim', { character: { gold: 30 } });

    // Sister Amala sends new players into the Woods.
    const amala = await bot.talkTo('sister-amala');
    expect.soft(amala?.offer?.quest, 'Sister Amala offers the first quest').toBe('meet-bramble');
    await bot.ask({ t: 'accept', quest: 'meet-bramble' }, (m) => m.t === 'character' && Boolean(quest(m.character, 'meet-bramble')), 'the quest to be taken');

    // Learning Mend from her costs gold.
    const gold = bot.character.gold;
    await bot.ask({ t: 'shop', action: 'learn', npc: 'sister-amala', id: 'mend' }, (m) => m.t === 'character' && m.character.abilities.includes('mend'), 'Mend to be learned').catch(() => undefined);
    expect.soft(bot.character.gold, 'Mend costs 15 gold').toBe(gold - 15);

    // Old Bramble, in her cottage in the Woods.
    expect(await bot.travelTo('woods')).toBe(true);
    const bramble = await bot.talkTo('old-bramble');
    expect.soft(bramble?.text, 'Old Bramble thanks the pilgrim').toContain(QUESTS['meet-bramble']!.thanks);
    expect.soft(quest(bot.character, 'meet-bramble')?.done, 'the first quest is done').toBe(true);
    expect.soft(bramble?.offer?.quest, 'Old Bramble offers the next quest').toBe('mushroom-trouble');
    await bot.ask({ t: 'accept', quest: 'mushroom-trouble' }, (m) => m.t === 'character' && Boolean(quest(m.character, 'mushroom-trouble')), 'the mushroom quest to be taken');

    // Four mushrooms, and whatever they drop.
    const xp = bot.character.xp + bot.character.level * 1000;
    const mushrooms = await defeat(bot, 'woods', 'walking-mushroom', 4);
    expect.soft(mushrooms.won, 'mushrooms defeated').toBeGreaterThanOrEqual(4);
    expect.soft(bot.character.xp + bot.character.level * 1000, 'fighting earns XP').toBeGreaterThan(xp);
    expect.soft(quest(bot.character, 'mushroom-trouble')?.count, 'the quest counts the mushrooms').toBeGreaterThanOrEqual(4);
    const thanks = await bot.talkTo('old-bramble');
    expect.soft(thanks?.text, 'Old Bramble thanks them for the mushrooms').toContain(QUESTS['mushroom-trouble']!.thanks);
    expect.soft(bot.character.abilities, 'Power Strike is learned').toContain('power-strike');

    // Power Strike on the next mushroom.
    const hunted = await bot.hunt('walking-mushroom', 30_000);
    if (hunted.result !== 'none') {
      const target = bot.snapshot?.creatures.find((c) => c.kind === 'walking-mushroom');
      if (target) {
        // Mushrooms wander, so one may step out of reach as the strike goes off: close in and try again.
        let struck = null;
        for (let tries = 0; tries < 5 && struck?.t !== 'hit'; tries++) {
          if (!bot.snapshot?.creatures.some((c) => c.id === target.id)) break;
          await bot.walkTo(() => bot.snapshot?.creatures.find((c) => c.id === target.id), { near: 1.2, what: 'a mushroom', quiet: true });
          // A slow server may still be applying the last steps; strike from where it has us.
          await bot.caughtUp();
          struck = await bot.ask({ t: 'ability', ability: 'power-strike', target: target.id }, (m) => (m.t === 'hit' && m.ability === 'power-strike') || m.t === 'notice', 'Power Strike to land').catch(() => null);
        }
        expect.soft(struck?.t === 'hit' ? 'hit' : struck, 'Power Strike lands').toBe('hit');
      }
    }

    // Down to the Shore: Marina buys and sells.
    expect(await bot.travelTo('shore')).toBe(true);
    const marina = await bot.talkTo('marina');
    expect.soft(marina?.shop, 'Marina keeps a shop').toBe(true);
    const tonics = itemCount(bot.character, 'tonic');
    if (bot.character.gold >= 8) {
      await bot.ask({ t: 'shop', action: 'buy', npc: 'marina', id: 'tonic' }, (m) => m.t === 'character' && itemCount(m.character, 'tonic') === tonics + 1, 'a Tonic to be bought');
    }
    const caps = itemCount(bot.character, 'mushroom-cap');
    if (caps > 0) {
      const before = bot.character.gold;
      await bot.ask({ t: 'shop', action: 'sell', npc: 'marina', id: 'mushroom-cap' }, (m) => m.t === 'character' && itemCount(m.character, 'mushroom-cap') === caps - 1, 'a Mushroom Cap to be sold');
      expect.soft(bot.character.gold, 'selling pays gold').toBeGreaterThan(before);
    }
    expect.soft(mushrooms.looted, 'a body was looted along the way').toBeGreaterThan(0);

    expect(world.problems()).toEqual([]);
  });
});
