import { describe, expect, it } from 'vitest';
import { newCharacter, regionDef, type PlayerInfo, type ServerMessage, type SnapshotMessage } from '@co-mmo/shared';
import { Region, snapshotEvery, type Connection } from '../src/region.ts';
import { FAR_FROM, STEADY, crowdOf, thinOut, tuningFor } from '../src/region/far.ts';

// Fewer updates for far things (region/far.ts): near ones every snapshot,
// far ones every other, named in `kept` in between.

function fakeConn() {
  const messages: ServerMessage[] = [];
  const conn: Connection & { messages: ServerMessage[] } = { messages, send: (m) => messages.push(m), close() {} };
  return conn;
}

const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
const snaps = (c: { messages: ServerMessage[] }) => c.messages.filter((m): m is SnapshotMessage => m.t === 'snapshot');
const someone = (id: string, x: number, y: number) => ({ id, name: id, color: 0, x, y, health: 1 });

describe('fewer updates for far things', () => {
  it('leaves far things out every other snapshot and names them instead', () => {
    const view = { players: [someone('near', 5, 5), someone('far', 5 + FAR_FROM + 3, 5)], creatures: [], bodies: [], npcs: [] };
    const full = thinOut(view, { x: 5, y: 5 }, 10, 2);
    expect(full.players.map((p) => p.id)).toEqual(['near', 'far']);
    expect(full.kept).toEqual([]);
    const thin = thinOut(view, { x: 5, y: 5 }, 11, 2);
    expect(thin.players.map((p) => p.id)).toEqual(['near']);
    expect(thin.kept).toEqual(['far']);
    // Far ones count for half toward the crowd rule.
    expect(crowdOf(thin, 2)).toBe(1.5);
    // Off: everything every time.
    expect(thinOut(view, { x: 5, y: 5 }, 11, 1).players).toHaveLength(2);
  });

  it('starts the crowd rule at 80 in view when snapshots are compressed, and thins far things out only when they are not', () => {
    expect(tuningFor({ compress: true })).toEqual({ farEvery: 1, crowdFrom: 80 });
    expect(tuningFor({ compress: false })).toEqual({ farEvery: 2, crowdFrom: 40 });
    expect(tuningFor({ compress: false, farLess: false })).toEqual({ farEvery: 1, crowdFrom: 40 });
    expect(snapshotEvery(60, 0, 80)).toBe(1);
    expect(snapshotEvery(100, 0, 80)).toBe(2);
    expect(snapshotEvery(60, 0, STEADY.crowdFrom)).toBe(2);
  });

  it('sends a far player in every other snapshot and a near one in all of them', () => {
    const region = new Region(regionDef('sanctum')!, undefined, Date.now, () => 0.5);
    region.tuning = tuningFor({ compress: false });
    const spawn = region.map.spawn;
    const [farSpot] = region.findSpots(spawn.x, spawn.y, 1, FAR_FROM + 2, FAR_FROM + 8).filter((s) => Math.abs(s.x - spawn.x) > FAR_FROM || Math.abs(s.y - spawn.y) > FAR_FROM);
    const [nearSpot] = region.findSpots(spawn.x, spawn.y, 1, 2, 4);
    const me = fakeConn();
    region.join(info('me'), me, { x: spawn.x, y: spawn.y }, newCharacter(), '');
    region.join(info('far'), fakeConn(), farSpot!, newCharacter(), '');
    region.join(info('near'), fakeConn(), nearSpot!, newCharacter(), '');
    for (let i = 0; i < 10; i++) region.tick();
    const list = snaps(me);
    expect(list).toHaveLength(10);
    for (const s of list) expect(s.players.some((p) => p.id === 'near')).toBe(true);
    const withFar = list.filter((s) => s.players.some((p) => p.id === 'far'));
    expect(withFar).toHaveLength(5);
    // In between, it is named so the browser keeps drawing it.
    for (const s of list) if (!withFar.includes(s)) expect(s.kept).toContain('far');
  });

  it('sends everything every snapshot as before with NET_FAR_LESS=off', () => {
    const region = new Region(regionDef('sanctum')!, undefined, Date.now, () => 0.5);
    region.tuning = tuningFor({ compress: false, farLess: false });
    const spawn = region.map.spawn;
    const [farSpot] = region.findSpots(spawn.x, spawn.y, 1, FAR_FROM + 2, FAR_FROM + 8).filter((s) => Math.abs(s.x - spawn.x) > FAR_FROM || Math.abs(s.y - spawn.y) > FAR_FROM);
    const me = fakeConn();
    region.join(info('me'), me, { x: spawn.x, y: spawn.y }, newCharacter(), '');
    region.join(info('far'), fakeConn(), farSpot!, newCharacter(), '');
    for (let i = 0; i < 6; i++) region.tick();
    expect(snaps(me).every((s) => s.players.some((p) => p.id === 'far') && !s.kept)).toBe(true);
  });
});
