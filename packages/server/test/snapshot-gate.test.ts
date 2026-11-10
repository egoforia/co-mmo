import { describe, expect, it } from 'vitest';
import type { ServerMessage, SnapshotMessage } from '@co-mmo/shared';
import { SnapshotGate } from '../src/snapshot-gate.ts';

const snap = (tick: number): SnapshotMessage => ({ t: 'snapshot', tick, ack: 0, x: 0, y: 0, hp: 1, energy: 1, players: [], creatures: [], bodies: [], npcs: [], online: 1 });

describe('SnapshotGate', () => {
  it('sends everything while the browser keeps up', () => {
    const gate = new SnapshotGate();
    for (let t = 1; t <= 40; t++) {
      expect(gate.pass(snap(t), t * 50, 0)).toBeDefined();
      gate.seen(t, t * 50 + 80);
    }
    expect(gate.skipped).toBe(0);
  });

  it('skips snapshots while the line has fallen behind, keeps one every half second, and says how many it skipped', () => {
    const gate = new SnapshotGate();
    for (let t = 1; t <= 10; t++) gate.pass(snap(t), t * 50, 0);
    gate.seen(1, 50 + 80);
    // Reports start taking far longer: snapshots are waiting in a queue somewhere.
    gate.seen(10, 500 + 900);
    const sent: (ServerMessage | undefined)[] = [];
    for (let t = 11; t <= 30; t++) sent.push(gate.pass(snap(t), 1400 + (t - 11) * 50, 0));
    expect(sent.filter(Boolean)).toHaveLength(2);
    expect(gate.skipped).toBe(18);
    const second = sent.filter(Boolean)[1] as SnapshotMessage;
    expect(second.skipped).toBe(9);
    // The queue drains: reports come back quickly again, and everything goes.
    gate.seen(second.tick, 1900 + 90);
    expect(gate.pass(snap(31), 2410, 0)).toBeDefined();
    expect(gate.pass(snap(32), 2460, 0)).toBeDefined();
  });

  it('skips while the socket itself still holds a lot, and never holds back other messages', () => {
    const gate = new SnapshotGate();
    gate.pass(snap(1), 0, 0);
    expect(gate.pass(snap(2), 50, 100_000)).toBeUndefined();
    expect(gate.pass({ t: 'notice', text: 'Hello' }, 60, 100_000)).toBeDefined();
  });
});
