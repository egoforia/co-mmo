import { describe, expect, it } from 'vitest';
import { CREATURES, PARTY_SIZE, newCharacter, partyXp, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import type { Connection } from '../src/region.ts';
import { Parties } from '../src/parties.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
const said = (c: { messages: ServerMessage[] }, text: string) => of(c, 'chat').some((m) => m.text === text);

/** A world with a controllable clock and dice that always roll the middle, and three players. */
function setup() {
  const clock = { now: 1_000_000 };
  const world = new World(() => clock.now, () => 0.5);
  const mara = fakeConn();
  const ilya = fakeConn();
  const tom = fakeConn();
  world.join(info('m', 'Mara'), mara, { regionId: 'woods', x: null, y: null }, newCharacter());
  world.join(info('i', 'Ilya'), ilya, { regionId: 'woods', x: null, y: null }, newCharacter());
  world.join(info('t', 'Tom'), tom, { regionId: 'desert', x: null, y: null }, newCharacter());
  return { world, clock, mara, ilya, tom };
}

function party(world: World, leader: string, ...names: [string, string][]) {
  for (const [id, name] of names) {
    world.handle(leader, { t: 'party', action: 'invite', name });
    world.handle(id, { t: 'party', action: 'accept' });
  }
}

describe('chat channels', () => {
  it('Region reaches everyone in the region and nobody outside it', () => {
    const { world, mara, ilya, tom } = setup();
    world.region('woods')!.placePlayer('i', 2, 2);
    world.handle('m', { t: 'chat', channel: 'region', text: 'anyone near the pool?' });
    expect(said(ilya, 'anyone near the pool?')).toBe(true);
    expect(said(mara, 'anyone near the pool?')).toBe(true);
    expect(said(tom, 'anyone near the pool?')).toBe(false);
  });

  it('a whisper reaches one player in any region, echoes to the sender, and /r answers', () => {
    const { world, mara, ilya, tom } = setup();
    world.handle('m', { t: 'chat', channel: 'whisper', to: 'tom', text: 'meet me at the shrine' });
    expect(of(tom, 'chat').at(-1)).toMatchObject({ channel: 'whisper', from: { name: 'Mara' }, to: { name: 'Tom' }, text: 'meet me at the shrine' });
    expect(said(mara, 'meet me at the shrine')).toBe(true);
    expect(said(ilya, 'meet me at the shrine')).toBe(false);

    world.handle('t', { t: 'chat', channel: 'whisper', text: 'on my way' });
    expect(of(mara, 'chat').at(-1)).toMatchObject({ from: { name: 'Tom' }, to: { name: 'Mara' }, text: 'on my way' });
  });

  it('says plainly when a whisper cannot be delivered', () => {
    const { world, mara } = setup();
    world.handle('m', { t: 'chat', channel: 'whisper', to: 'Nobody', text: 'hello?' });
    expect(of(mara, 'error').at(-1)?.message).toBe('Nobody is not online right now.');
    world.handle('m', { t: 'chat', channel: 'party', text: 'hello party' });
    expect(of(mara, 'error').at(-1)?.message).toMatch(/not in a party/);
  });
});

describe('parties', () => {
  it('invite, accept, party chat across regions, and the party list', () => {
    const { world, mara, ilya, tom } = setup();
    world.handle('m', { t: 'party', action: 'invite', name: 'Tom' });
    expect(of(tom, 'party-invite').at(-1)).toMatchObject({ from: { name: 'Mara' } });
    world.handle('t', { t: 'party', action: 'accept' });
    expect(of(mara, 'party').at(-1)!.party).toMatchObject({
      leader: 'm',
      members: [{ name: 'Mara', online: true, region: 'Whispering Woods' }, { name: 'Tom', online: true, region: 'Mirage Desert' }],
    });

    world.handle('t', { t: 'chat', channel: 'party', text: 'found a ruin' });
    expect(said(mara, 'found a ruin')).toBe(true);
    expect(said(ilya, 'found a ruin')).toBe(false);

    // Going offline keeps your place; the others see you as away.
    world.leave('t');
    expect(of(mara, 'party').at(-1)!.party!.members[1]).toMatchObject({ name: 'Tom', online: false });
  });

  it('an invite runs out after a minute', () => {
    const { world, clock, ilya } = setup();
    world.handle('m', { t: 'party', action: 'invite', name: 'Ilya' });
    clock.now += 61_000;
    world.handle('i', { t: 'party', action: 'accept' });
    expect(of(ilya, 'notice').at(-1)?.text).toMatch(/run out/);
    expect(world.parties.of('i')).toBeUndefined();
  });

  it('leaving a party of two breaks it up; the next member leads when the leader leaves', () => {
    const { world, ilya } = setup();
    party(world, 'm', ['i', 'Ilya'], ['t', 'Tom']);
    world.handle('m', { t: 'party', action: 'leave' });
    expect(world.parties.of('i')!.leader).toBe('i');
    world.handle('t', { t: 'party', action: 'leave' });
    expect(world.parties.of('i')).toBeUndefined();
    expect(of(ilya, 'party').at(-1)!.party).toBeNull();
  });

  it('shares XP and defeat-quest progress with members nearby, not with members far away', () => {
    const { world, clock } = setup();
    party(world, 'm', ['i', 'Ilya'], ['t', 'Tom']);
    const woods = world.region('woods')!;
    const id = woods.creatureIds().find((c) => c.includes('walking-mushroom'))!;
    const me = woods.position('m')!;
    woods.placeCreature(id, me.x + 1, me.y);
    woods.placePlayer('i', me.x, me.y + 1);
    while (woods.creature(id)!.alive) {
      world.handle('m', { t: 'attack' });
      clock.now += 1000;
    }
    const xp = CREATURES['walking-mushroom']!.xp;
    expect(partyXp(xp, 2)).toBeLessThan(xp);
    expect(woods.character('m')!.xp).toBe(partyXp(xp, 2));
    expect(woods.character('i')!.xp).toBe(partyXp(xp, 2));
    // Tom is in the desert: no share.
    expect(world.region('desert')!.character('t')!.xp).toBe(0);
  });
});

describe('party rules', () => {
  it('fighting together pays a little more in total than fighting alone', () => {
    expect(partyXp(10, 1)).toBe(10);
    expect(partyXp(10, 2) * 2).toBeGreaterThan(10);
    expect(partyXp(10, 3)).toBe(5);
  });

  it(`a party holds ${PARTY_SIZE} by default, a tuning value`, () => {
    const parties = new Parties(Date.now, 2);
    expect(parties.invite('a', 'b')).toBeNull();
    expect(parties.accept('b')).not.toBeTypeOf('string');
    expect(parties.invite('a', 'c')).toMatch(/full/);
    expect(parties.invite('a', 'a')).toMatch(/yourself/);
  });
});
