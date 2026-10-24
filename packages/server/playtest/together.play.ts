// Two robots play together: they see each other, chat, form a party, fight
// side by side, and trade.

import { describe, expect, it } from 'vitest';
import { itemCount, type ServerMessage } from '@co-mmo/shared';
import { playWorld } from './harness.ts';

describe('robots play together', () => {
  it('see each other, chat, party up, share a fight and trade', async () => {
    const world = await playWorld();
    const mara = await world.bot('Mara', { region: 'woods', character: { gold: 20 } });
    const ilya = await world.bot('Ilya', { region: 'woods', character: { inventory: [{ item: 'bible', qty: 1 }, { item: 'tonic', qty: 3 }] } });

    // They stand side by side and see each other.
    await mara.tick();
    await ilya.tick();
    expect.soft(mara.snapshot?.players.map((p) => p.name), 'Mara sees Ilya').toContain('Ilya');
    expect.soft(mara.snapshot?.online, 'two players online').toBe(2);

    // Say chat reaches the player nearby.
    const said = ilya.mark();
    mara.send({ t: 'chat', channel: 'say', text: 'Shall we hunt mushrooms?' });
    const heard = await ilya.waitFor<Extract<ServerMessage, { t: 'chat' }>>((m) => m.t === 'chat' && m.text === 'Shall we hunt mushrooms?', { since: said, what: "Mara's words" }).catch(() => null);
    expect.soft(heard?.from.name, 'Ilya hears Mara').toBe('Mara');

    // A party: invite, accept, and both see it.
    const invited = ilya.mark();
    mara.send({ t: 'party', action: 'invite', name: 'Ilya' });
    await ilya.waitFor((m) => m.t === 'party-invite', { since: invited, what: "Mara's party invite" });
    const joined = mara.mark();
    ilya.send({ t: 'party', action: 'accept' });
    const party = await mara.waitFor<Extract<ServerMessage, { t: 'party' }>>((m) => m.t === 'party' && (m.party?.members.length ?? 0) === 2, { since: joined, what: 'the party of two' }).catch(() => null);
    expect.soft(party?.party?.members.map((p) => p.name).sort(), 'both are in the party').toEqual(['Ilya', 'Mara']);

    // Mara fights; Ilya, close by in her party, shares the XP.
    const xp = ilya.character.xp + ilya.character.level * 1000;
    await ilya.walkTo(() => mara.at, { near: 2, quiet: true, ms: 5000 });
    const fight = await mara.hunt('walking-mushroom');
    expect.soft(fight.result, 'Mara defeats a mushroom').toBe('defeated');
    await ilya.tick();
    if (fight.result === 'defeated' && Math.hypot(mara.at.x - ilya.at.x, mara.at.y - ilya.at.y) < 20) {
      expect.soft(ilya.character.xp + ilya.character.level * 1000, 'Ilya shares the XP').toBeGreaterThan(xp);
    }

    // A trade: Ilya gives a Tonic for 5 gold.
    await ilya.walkTo(() => mara.at, { near: 2, what: 'Mara' });
    const asked = ilya.mark();
    mara.send({ t: 'trade', action: 'request', name: 'Ilya' });
    await ilya.waitFor((m) => m.t === 'trade-request', { since: asked, ms: 15_000, what: "Mara's trade request" });
    ilya.send({ t: 'trade', action: 'accept' });
    await mara.waitFor((m) => m.t === 'trade' && m.trade !== null, { since: asked, what: 'the trade window' });
    ilya.send({ t: 'trade', action: 'offer', offer: { items: [{ item: 'tonic', qty: 1 }], gold: 0 } });
    mara.send({ t: 'trade', action: 'offer', offer: { items: [], gold: 5 } });
    await mara.waitFor((m) => m.t === 'trade' && m.trade?.theirs.items.length === 1 && m.trade.mine.gold === 5, { since: asked, what: 'both offers to show' });
    const tonics = itemCount(mara.character, 'tonic');
    const gold = ilya.character.gold;
    const done = mara.mark();
    mara.send({ t: 'trade', action: 'confirm' });
    ilya.send({ t: 'trade', action: 'confirm' });
    await mara.waitFor((m) => m.t === 'trade' && m.trade === null, { since: done, what: 'the trade to finish' });
    await mara.waitFor((m) => m.t === 'character', { since: done, what: 'the bag to change after the trade' }).catch(() => undefined);
    await ilya.tick();
    expect.soft(itemCount(mara.character, 'tonic'), 'Mara got the Tonic').toBe(tonics + 1);
    expect.soft(ilya.character.gold, 'Ilya got the gold').toBe(gold + 5);

    expect(world.problems()).toEqual([]);
  });
});
