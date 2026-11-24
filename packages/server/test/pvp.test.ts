import { afterEach, describe, expect, it } from 'vitest';
import { ABILITIES, EDIT_KINDS, SAFE_IN, SAFE_OUT, TICK_SECONDS, collides, isSafe, newCharacter, regionDef, safeAreas, type AbilityDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

// PvP version 1 (combat decisions, step 5): outside safe areas players hurt
// players as they hurt monsters; never inside one, never in their own party.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const notices = (c: { messages: ServerMessage[] }) => c.messages.flatMap((m) => (m.t === 'notice' ? [m.text] : []));

const taught: string[] = [];
afterEach(() => {
  for (const id of taught.splice(0)) delete ABILITIES[id];
});

function ability(effect: AbilityDef['effect'], more: Partial<AbilityDef> = {}): string {
  const id = `test-pvp-${effect}-${taught.length}`;
  ABILITIES[id] = { name: `Test ${effect}`, description: 'For a test.', effect, energy: 0, cooldown: 0, range: 5, base: 6, stat: 'might', factor: 0, ...more };
  taught.push(id);
  return id;
}

/** Mara (a), Tolle (b) and Ivo (c) in the woods; `party` lists who is in Mara's party. Out on open ground unless `home`. */
function setup(party: string[] = ['a'], abilities: string[] = []) {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('woods')!, { worldChat: () => undefined, online: () => 3, party: (id) => (party.includes(id) ? party : [id]) }, () => clock.now, () => 0.5);
  const conns = { a: fakeConn(), b: fakeConn(), c: fakeConn() };
  for (const id of ['a', 'b', 'c'] as const) {
    const ch = newCharacter();
    ch.abilities.push(...abilities);
    region.join(info(id, { a: 'Mara', b: 'Tolle', c: 'Ivo' }[id]), conns[id], { x: null, y: null }, ch);
  }
  // Away from every safe area, with room round it; the creatures sent far off.
  const at = openGround(region);
  region.placePlayer('a', at.x, at.y);
  region.placePlayer('b', at.x + 1, at.y);
  region.placePlayer('c', at.x + 1, at.y + 1);
  region.creatureIds().forEach((id, i) => region.placeCreature(id, at.x - 30 - i, at.y - 30));
  const tick = (seconds = TICK_SECONDS) => {
    for (let i = 0; i < Math.max(1, Math.round(seconds / TICK_SECONDS)); i++) {
      clock.now += TICK_SECONDS * 1000;
      region.tick();
    }
  };
  return { region, clock, conns, at, tick, hp: (id: string) => region.character(id)!.hp };
}

function openGround(region: Region): { x: number; y: number } {
  const map = region.map;
  for (let y = 4; y < map.height - 4; y++) {
    for (let x = 4; x < map.width - 4; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (isSafe(map, px, py) || isSafe(map, px + 3, py + 3) || isSafe(map, px - 3, py - 3)) continue;
      let clear = true;
      for (let dy = -2; dy <= 2 && clear; dy++) for (let dx = -2; dx <= 3 && clear; dx++) clear = !collides(map, px + dx, py + dy);
      if (clear) return { x: px, y: py };
    }
  }
  throw new Error('no open ground');
}

describe('safe areas', () => {
  it('cover the whole Sanctum, and the arrival square of every other land', () => {
    const sanctum = new Region(regionDef('sanctum')!, undefined, () => 0, () => 0.5).map;
    expect(isSafe(sanctum, 1, 1)).toBe(true);
    const woods = new Region(regionDef('woods')!, undefined, () => 0, () => 0.5).map;
    expect(isSafe(woods, woods.spawn.x + 2, woods.spawn.y)).toBe(true);
    expect(isSafe(woods, woods.spawn.x + 30, woods.spawn.y)).toBe(false);
  });

  it('are laid and taken away with the world editor', () => {
    const map = new Region(regionDef('woods')!, undefined, () => 0, () => 0.5).map;
    const at: [number, number] = [Math.floor(map.spawn.x) + (map.spawn.x < map.width / 2 ? 20 : -20), Math.floor(map.spawn.y)];
    const lay = { ...EDIT_KINDS.safe.make({ at }, { radius: 5 }), id: 'e1' } as never;
    expect(EDIT_KINDS.safe.check(map, lay, {} as never)).toBeUndefined();
    EDIT_KINDS.safe.apply(map, lay);
    expect(isSafe(map, at[0] + 3, at[1])).toBe(true);
    expect(safeAreas(map)).toHaveLength(2);
    EDIT_KINDS.safe.apply(map, { ...EDIT_KINDS.safe.make({ at: [Math.floor(map.spawn.x), Math.floor(map.spawn.y)] }, { radius: 0 }), id: 'e2' } as never);
    expect(isSafe(map, map.spawn.x, map.spawn.y)).toBe(false);
    expect(safeAreas(map)).toHaveLength(1);
  });
});

describe('players fighting players', () => {
  it('a chosen player in reach is struck, and told who attacks them', () => {
    const s = setup();
    const before = s.hp('b');
    s.region.handle('a', { t: 'attack', target: 'b' });
    expect(s.hp('b')).toBeLessThan(before);
    expect(notices(s.conns.b)).toContain('Mara attacks you!');
  });

  it('Space never hits a player who is not the chosen target', () => {
    const s = setup();
    const before = s.hp('b');
    s.region.handle('a', { t: 'attack' });
    expect(s.hp('b')).toBe(before);
  });

  it('party members cannot hurt each other', () => {
    const s = setup(['a', 'b']);
    const before = s.hp('b');
    s.region.handle('a', { t: 'attack', target: 'b' });
    expect(s.hp('b')).toBe(before);
    expect(notices(s.conns.a)).toContain('Tolle is in your party. Leave the party first to fight them.');
  });

  it('no one is hurt in a safe area, and stepping in and out says so', () => {
    const s = setup();
    s.tick();
    const spawn = s.region.map.spawn;
    s.region.placePlayer('a', spawn.x, spawn.y);
    s.region.placePlayer('b', spawn.x + 1, spawn.y);
    s.tick();
    expect(notices(s.conns.a)).toContain(SAFE_IN);
    const before = s.hp('b');
    s.clock.now += 5000;
    s.region.handle('a', { t: 'attack', target: 'b' });
    expect(s.hp('b')).toBe(before);
    expect(notices(s.conns.a)).toContain('No one can be hurt in a safe area.');
    s.region.placePlayer('a', s.at.x, s.at.y);
    s.tick();
    expect(notices(s.conns.a)).toContain(SAFE_OUT);
  });

  it('an area skill hurts every rival it covers, bystanders too, but not the party', () => {
    const blast = ability('area', { range: 0, radius: 2, stat: 'wit', damageType: 'arcane' } as Partial<AbilityDef>);
    const s = setup(['a', 'b'], [blast]);
    const b = s.hp('b');
    const c = s.hp('c');
    s.region.handle('a', { t: 'ability', ability: blast });
    expect(s.hp('b')).toBe(b);
    expect(s.hp('c')).toBeLessThan(c);
  });

  it('a strike skill chosen at a rival hits them', () => {
    const blow = ability('strike', { range: 1.5 });
    const s = setup(['a'], [blow]);
    const before = s.hp('b');
    s.region.handle('a', { t: 'ability', ability: blow, target: 'b' });
    expect(s.hp('b')).toBeLessThan(before);
  });

  it('monsters give up on a player who steps into a safe area', () => {
    const s = setup();
    const foe = s.region.creatureIds().find((id) => s.region.creature(id)!.kind !== 'lantern-moth')!;
    s.region.placeCreature(foe, s.at.x - 1, s.at.y);
    s.region.facePlayer('a', -1, 0);
    s.region.handle('a', { t: 'attack', target: foe });
    s.tick(0.5);
    expect(s.region.creatureMood(foe)!.aggro).toBe('a');
    const spawn = s.region.map.spawn;
    s.region.placePlayer('a', spawn.x, spawn.y);
    s.tick(2);
    expect(s.region.creatureMood(foe)!.aggro).toBeNull();
  });
});
