import { describe, expect, it } from 'vitest';
import { REGROW_MS, addItem, itemCount, newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });
const notices = (c: { messages: ServerMessage[] }) => c.messages.filter((m) => m.t === 'notice').map((m) => (m as { text: string }).text);

/** A Sanctum copper vein well away from anyone to talk to, and a player beside it with a pick. */
function atCopper() {
  const clock = { now: 1_000_000 };
  const region = new Region(regionDef('sanctum')!, undefined, () => clock.now, () => 0.5);
  const spot = region.map.spots.find((s) => s.kind === 'sanctum-copper' && region.map.npcs.every((n) => Math.hypot(n.x - s.x, n.y - s.y) > 6))!;
  const conn = fakeConn();
  const c = newCharacter();
  addItem(c, 'tool-smithing-1');
  region.join(info('a', 'Mara'), conn, { x: null, y: null }, c);
  region.placePlayer('a', spot.x + 1.5, spot.y + 0.5);
  return { region, clock, conn, spot };
}

describe('gathering on the server', () => {
  it('takes a moment, gives the material, raises the craft and grows back for that player only', () => {
    const { region, clock, conn, spot } = atCopper();
    region.handle('a', { t: 'interact' });
    expect(conn.messages.at(-2)).toEqual({ t: 'gather', tool: 'tool-smithing-1', ms: 2000 });
    expect(notices(conn).at(-1)).toMatch(/You gather at the Copper Vein/);
    region.tick();
    expect(itemCount(region.character('a')!, 'copper-ore')).toBe(0);
    clock.now += 2100;
    region.tick();
    // 1 to 3; the test's luck is always 0.5.
    expect(itemCount(region.character('a')!, 'copper-ore')).toBe(2);
    expect(notices(conn).some((t) => /You gather 2 × Copper Ore/.test(t))).toBe(true);
    expect(region.character('a')!.crafts?.smithing?.xp).toBeGreaterThan(0);
    expect(conn.messages.some((m) => m.t === 'gather' && !('tool' in m && m.tool))).toBe(true);

    region.handle('a', { t: 'interact' });
    expect(notices(conn).at(-1)).toMatch(/nothing left for you yet/);

    // Someone else finds it full.
    const other = fakeConn();
    const c = newCharacter();
    addItem(c, 'tool-smithing-1');
    region.join(info('b', 'Ilya'), other, { x: null, y: null }, c);
    region.placePlayer('b', spot.x - 0.5, spot.y + 0.5);
    region.handle('b', { t: 'interact' });
    expect(notices(other).at(-1)).toMatch(/You gather at the Copper Vein/);

    clock.now += REGROW_MS;
    region.handle('a', { t: 'interact' });
    expect(notices(conn).at(-1)).toMatch(/You gather at the Copper Vein/);
  });

  it('stops when you walk away, and needs a tool', () => {
    const { region, clock, conn, spot } = atCopper();
    region.handle('a', { t: 'interact' });
    region.placePlayer('a', spot.x + 6, spot.y);
    clock.now += 2100;
    region.tick();
    expect(notices(conn)).toContain('You stop gathering.');
    expect(itemCount(region.character('a')!, 'copper-ore')).toBe(0);

    region.character('a')!.inventory = [];
    region.placePlayer('a', spot.x + 1.5, spot.y + 0.5);
    region.handle('a', { t: 'interact' });
    expect(notices(conn).at(-1)).toMatch(/need a pick/);
  });
});
