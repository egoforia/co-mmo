// Wishes as mods: the Owner switches granted wishes off and on again in
// God's View, and undoes one, while robots play. What a sleeping wish made
// leaves the world for everyone and comes back when it wakes.

import { describe, expect, it } from 'vitest';
import { itemCount, type ContentMessage, type ServerMessage } from '@co-mmo/shared';
import { api } from '../test/helpers.ts';
import { playWorld } from './harness.ts';

describe('the robot plays with wishes switched off and on', () => {
  it('sees wished creatures and things leave and come back, and an undone wish gone for good', async () => {
    const world = await playWorld();
    const owner = await world.bot('Keeper', { role: 'owner', character: { favor: 40 } });
    const player = await world.bot('Visitor');
    const admin = (id: string, action: 'off' | 'on' | 'undo') => api(world.base, `/api/admin/content/${id}/${action}`, owner.token, 'POST');
    const entry = async (title: string, since: number) => {
      const isIt = (m: ServerMessage) => m.t === 'content' && m.entries.some((e) => e.title === title && e.status === 'granted');
      return (await owner.waitFor<ContentMessage>(isIt, { since, what: `"${title}" to be granted` })).entries.find((e) => e.title === title)!;
    };

    let since = owner.mark();
    const beast = await owner.wish('I wish for a gentle goat creature');
    const goats = beast && (await entry(beast.card.title, since));
    since = owner.mark();
    const ring = await owner.wish('I wish for a silver ring');
    const silver = ring && (await entry(ring.card.title, since));
    expect(goats && silver, 'both wishes were granted').toBeTruthy();
    if (!goats || !silver) return;
    await owner.ask({ t: 'equip', item: silver.id }, (m) => m.t === 'character' && Object.values(m.character.equipment).includes(silver.id), 'the ring to be worn');

    const goatsSeen = async () => {
      await player.tick();
      await player.tick();
      return player.snapshot?.creatures.filter((c) => c.kind === goats.id).length ?? 0;
    };
    expect.soft(await goatsSeen(), 'the other player sees the wished goats').toBe(3);

    // Off: the goats leave the world; the ring stays in the bag but is no longer worn.
    expect.soft((await admin(goats.id, 'off')).status, 'the goats can be switched off').toBe(200);
    await expect.poll(goatsSeen, { timeout: 5000, message: 'switched-off goats leave the world' }).toBe(0);
    expect.soft((await admin(silver.id, 'off')).status, 'the ring can be switched off').toBe(200);
    await expect.poll(async () => (await owner.tick(), Object.values(owner.character.equipment).includes(silver.id)), { timeout: 5000, message: 'a sleeping ring is taken off' }).toBe(false);
    expect.soft(itemCount(owner.character, silver.id), 'the sleeping ring stays in the bag').toBe(1);
    const sleeping = await owner.ask({ t: 'equip', item: silver.id }, (m) => m.t === 'notice' || (m.t === 'character' && Object.values(m.character.equipment).includes(silver.id)), 'an answer to wearing a sleeping ring').catch(() => null);
    expect.soft(sleeping?.t, 'a sleeping ring cannot be worn').not.toBe('character');

    // On again: the goats come back and the ring can be worn.
    expect.soft((await admin(goats.id, 'on')).status, 'the goats can be switched on').toBe(200);
    await expect.poll(goatsSeen, { timeout: 5000, message: 'the goats come back' }).toBeGreaterThan(0);
    expect.soft((await admin(silver.id, 'on')).status, 'the ring can be switched on').toBe(200);
    await owner.ask({ t: 'equip', item: silver.id }, (m) => m.t === 'character' && Object.values(m.character.equipment).includes(silver.id), 'the woken ring to be worn');

    // Undo: the goats are gone for good, and stay gone.
    expect.soft((await admin(goats.id, 'undo')).status, 'the goats can be undone').toBe(200);
    await expect.poll(goatsSeen, { timeout: 5000, message: 'undone goats leave the world' }).toBe(0);
    expect.soft((await admin(goats.id, 'on')).status, 'an undone wish cannot be switched back on').not.toBe(200);
    expect.soft(await goatsSeen(), 'undone goats stay gone').toBe(0);

    expect(world.problems()).toEqual([]);
  });
});
