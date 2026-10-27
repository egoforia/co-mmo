import { describe, expect, it } from 'vitest';
import { FALLEN_MS, maxHp, newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { FALLEN_WORDS } from '../src/region/fallen.ts';
import { World } from '../src/world.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const of = <T extends ServerMessage['t']>(c: { messages: ServerMessage[] }, t: T) =>
  c.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);

/** A region with a controllable clock and dice that always roll the middle. */
function setup(id: string) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef(id)!, undefined, () => clock.now, () => 0.5);
  return { region, clock };
}

/** A world in the desert with Mara at 1 HP beside a scarab, ticked until she falls. */
function fallInDesert() {
  const clock = { now: 5_000_000 };
  const world = new World(() => clock.now, () => 0.5);
  const conn = fakeConn();
  const ch = newCharacter();
  ch.hp = 1;
  world.join(info('a', 'Mara'), conn, { regionId: 'desert', x: null, y: null }, ch);
  const desert = world.local('desert')!;
  const scarab = desert.creatureIds()[0]!;
  const me = desert.position('a')!;
  desert.placeCreature(scarab, me.x + 1, me.y);
  for (let i = 0; i < 5 && !desert.isFallen('a'); i++) {
    clock.now += 2000;
    world.tick();
  }
  return { world, desert, conn, clock, scarab };
}

describe('the Fallen', () => {
  it('a player at 0 HP lies Fallen where they fell, told how to come back', () => {
    const { world, desert, conn } = fallInDesert();
    expect(desert.isFallen('a')).toBe(true);
    expect(world.regionOf('a')!.def.id).toBe('desert');
    expect(desert.character('a')!.hp).toBe(0);
    expect(of(conn, 'notice').some((n) => n.text === FALLEN_WORDS)).toBe(true);
    const snap = of(conn, 'snapshot').at(-1)!;
    expect(snap.fallen).toBe(FALLEN_MS / 1000);

    // Steps are counted but not taken.
    const at = desert.position('a')!;
    world.handle('a', { t: 'input', seq: 1000, dx: 1, dy: 0 });
    world.tick();
    expect(desert.position('a')).toEqual(at);
    expect(of(conn, 'snapshot').at(-1)!.ack).toBe(1000);
  });

  it('others nearby see the player as Fallen', () => {
    const { region, clock } = setup('woods');
    const mara = fakeConn();
    const bo = fakeConn();
    region.join(info('a', 'Mara'), mara, { x: null, y: null }, newCharacter());
    region.join(info('b', 'Bo'), bo, { x: null, y: null }, newCharacter());
    region.updateCharacter('a', (c) => { c.hp = 0; });
    clock.now += 100;
    region.tick();
    const seen = of(bo, 'snapshot').at(-1)!.players.find((p) => p.id === 'a')!;
    expect(seen.fallen).toBe(true);
    expect(of(bo, 'system').some((m) => m.text === 'Mara has fallen.')).toBe(true);
  });

  it('creatures leave the Fallen be', () => {
    const { desert, conn, clock, world, scarab } = fallInDesert();
    const hits = of(conn, 'hit').filter((h) => h.target === 'a').length;
    const me = desert.position('a')!;
    desert.placeCreature(scarab, me.x + 1, me.y);
    for (let i = 0; i < 4; i++) {
      clock.now += 2000;
      world.tick();
    }
    expect(of(conn, 'hit').filter((h) => h.target === 'a').length).toBe(hits);
    expect(desert.creatureMood(scarab)!.aggro).toBeNull();
  });

  it('the Wake at the shrine button ends it early, Weakened', () => {
    const { world, conn, clock } = fallInDesert();
    world.handle('a', { t: 'wake' });
    clock.now += 100;
    world.tick();
    expect(world.regionOf('a')!.def.id).toBe('sanctum');
    const after = world.regionOf('a')!.character('a')!;
    expect(after.hp).toBe(maxHp(after));
    expect(after.weakenedUntil).toBeGreaterThan(clock.now);
    expect(of(conn, 'notice').at(-1)!.text).toContain('woke at the shrine');
  });

  it('after 10 seconds the Fallen wake at the shrine on their own', () => {
    const { world, desert, clock } = fallInDesert();
    clock.now += FALLEN_MS - 1000;
    world.tick();
    expect(world.regionOf('a')!.def.id).toBe('desert');
    expect(desert.isFallen('a')).toBe(true);
    clock.now += 1000;
    world.tick();
    expect(world.regionOf('a')!.def.id).toBe('sanctum');
    expect(world.regionOf('a')!.character('a')!.weakenedUntil).toBeGreaterThan(clock.now);
  });

  it('a friend raises the Fallen where they lie, with no Weakened', () => {
    const { region, clock } = setup('woods');
    const mara = fakeConn();
    const bo = fakeConn();
    region.join(info('a', 'Mara'), mara, { x: null, y: null }, newCharacter());
    region.join(info('b', 'Bo'), bo, { x: null, y: null }, newCharacter());
    expect(region.raise('a', 0.25, 'b')).toBe(false);
    region.updateCharacter('a', (c) => { c.hp = 0; });
    region.tick();
    const at = region.position('a');

    expect(region.raise('a', 0.25, 'b')).toBe(true);
    const ch = region.character('a')!;
    expect(ch.hp).toBe(Math.round(maxHp(ch) * 0.25));
    expect(ch.weakenedUntil).toBeLessThanOrEqual(clock.now);
    expect(region.isFallen('a')).toBe(false);
    expect(region.position('a')).toEqual(at);
    expect(of(mara, 'notice').at(-1)!.text).toBe('Bo rang you back. You rise where you fell.');
    expect(of(bo, 'notice').at(-1)!.text).toBe('You raised Mara.');

    // Raised, they stay: the shrine's time no longer runs.
    clock.now += FALLEN_MS * 2;
    expect(region.tick().some((d) => d.id === 'a')).toBe(false);
    expect(of(mara, 'snapshot').at(-1)!.fallen).toBeUndefined();
  });
});
