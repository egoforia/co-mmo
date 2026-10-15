import { describe, expect, it } from 'vitest';
import { newCharacter, regionDef, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import { Region, snapshotEvery, type Connection } from '../src/region.ts';

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const snapshots = (c: { messages: ServerMessage[] }) => c.messages.filter((m) => m.t === 'snapshot').length;

describe('update rates in a crowd', () => {
  it('sends snapshots less often as the crowd in view or the load grows, never slower than every 4 ticks', () => {
    expect(snapshotEvery(5)).toBe(1);
    expect(snapshotEvery(50)).toBe(2);
    expect(snapshotEvery(100)).toBe(3);
    expect(snapshotEvery(500)).toBe(4);
    expect(snapshotEvery(5, 1)).toBe(2);
    expect(snapshotEvery(500, 2)).toBe(4);
  });

  it('a player in a crowd gets fewer snapshots; one alone gets one every tick', () => {
    const region = new Region(regionDef('sanctum')!, undefined, Date.now, () => 0.5);
    const conns = new Map<string, ReturnType<typeof fakeConn>>();
    for (let i = 0; i < 60; i++) {
      const c = fakeConn();
      conns.set(`p${i}`, c);
      region.join(info(`p${i}`), c, { x: null, y: null }, newCharacter(), '');
    }
    for (let i = 0; i < 20; i++) region.tick();
    // 59 others in view: every second tick after the first snapshot counted them.
    const crowded = snapshots(conns.get('p0')!);
    expect(crowded).toBeGreaterThanOrEqual(10);
    expect(crowded).toBeLessThanOrEqual(11);

    const quiet = new Region(regionDef('woods')!, undefined, Date.now, () => 0.5);
    const alone = fakeConn();
    quiet.join(info('a'), alone, { x: null, y: null }, newCharacter(), '');
    quiet.strain = 0;
    for (let i = 0; i < 20; i++) quiet.tick();
    expect(snapshots(alone)).toBe(20);
    // A busy process slows even a quiet region down.
    quiet.strain = 2;
    alone.messages.length = 0;
    for (let i = 0; i < 21; i++) quiet.tick();
    expect(snapshots(alone)).toBe(7);
  });
});
