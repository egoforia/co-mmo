import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  CREATURES,
  newCharacter,
  regionDef,
  type PlayerInfo,
  type ServerMessage,
} from '@co-mmo/shared';
import { Region, type Connection } from '../src/region.ts';
import { addThreat } from '../src/threat.ts';
import { inspectEntity } from '../src/region/inspect.ts';

function fakeConn(): Connection & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return { messages, send: (m) => messages.push(m), close() {} };
}

const info = (id: string, name = id): PlayerInfo => ({ id, name, color: 0xffffff, role: 'player' });

describe('Live Entity Inspector (Tool 4)', () => {
  it('inspects a player with core stats, statuses, signature gauge and cooldowns', () => {
    const clock = { now: 1_000_000 };
    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
    const conn = fakeConn();
    const ch = newCharacter();
    ch.calling = 'warden';
    ch.abilities = ['strike', 'challenge'];
    ch.hp = 85;
    ch.energy = 40;

    region.join(info('p1', 'Mara'), conn, { x: 10, y: 15, floor: 0 }, ch);

    // Add status
    region.afflict('p1', 'burning', 5);

    // Put ability on cooldown
    const p = region.state.players.get('p1')!;
    p.readyAt.set('challenge', clock.now + 4000);

    // Add gauge pips
    region.gaugeSystem.add(p, 3, 'resolve');

    // Inspect
    const inspection = region.inspect('player', 'p1');
    expect(inspection).toBeDefined();
    expect(inspection!.id).toBe('p1');
    expect(inspection!.kind).toBe('player');
    expect(inspection!.name).toBe('Mara');
    expect(inspection!.x).toBe(10);
    expect(inspection!.y).toBe(15);
    expect(inspection!.floor).toBe(0);
    expect(inspection!.hp).toBe(85);
    expect(inspection!.energy).toBe(p.character.energy);
    expect(inspection!.alive).toBe(true);

    // Statuses
    expect(inspection!.statuses.length).toBe(1);
    expect(inspection!.statuses[0].id).toBe('burning');
    expect(inspection!.statuses[0].secondsLeft).toBeCloseTo(4.6, 1);

    // Gauge
    expect(inspection!.gauge).toBeDefined();
    expect(inspection!.gauge!.calling).toBe('warden');
    expect(inspection!.gauge!.pips).toBe(3);
    expect(inspection!.gauge!.max).toBe(5);

    // Cooldowns
    const challengeCd = inspection!.cooldowns.find((c) => c.ability === 'challenge');
    expect(challengeCd).toBeDefined();
    expect(challengeCd!.secondsLeft).toBe(4);
    const strikeCd = inspection!.cooldowns.find((c) => c.ability === 'strike');
    expect(strikeCd).toBeDefined();
    expect(strikeCd!.secondsLeft).toBe(0);
  });

  it('inspects a creature with threat list, switch threshold, taunt and brain state', () => {
    const clock = { now: 1_000_000 };
    const region = new Region(regionDef('shore')!, undefined, () => clock.now, () => 0.5);
    const conn1 = fakeConn();
    const conn2 = fakeConn();

    region.join(info('p1', 'Mara'), conn1, { x: 10, y: 10 }, newCharacter());
    region.join(info('p2', 'Tolle'), conn2, { x: 12, y: 10 }, newCharacter());

    const cId = region.creatureIds()[0];
    const c = region.state.creatures.find((cr) => cr.id === cId)!;
    c.aggro = 'p1';
    addThreat(c, 'p1', 100);
    addThreat(c, 'p2', 80);

    // Inspect creature
    const inspection = region.inspect('creature', cId);
    expect(inspection).toBeDefined();
    expect(inspection!.id).toBe(cId);
    expect(inspection!.kind).toBe('creature');
    expect(inspection!.name).toBe(c.def.name);
    expect(inspection!.alive).toBe(true);
    expect(inspection!.targetId).toBe('p1');

    // Threat
    expect(inspection!.threat).toBeDefined();
    expect(inspection!.threat!.targetId).toBe('p1');
    expect(inspection!.threat!.tauntedBy).toBeNull();
    // 100 * 1.1 = 110
    expect(inspection!.threat!.switchThreshold).toBe(110);
    expect(inspection!.threat!.entries.length).toBe(2);
    expect(inspection!.threat!.entries[0].playerName).toBe('Mara');
    expect(inspection!.threat!.entries[0].amount).toBe(100);
    expect(inspection!.threat!.entries[0].isTarget).toBe(true);
    expect(inspection!.threat!.entries[1].playerName).toBe('Tolle');
    expect(inspection!.threat!.entries[1].amount).toBe(80);
    expect(inspection!.threat!.entries[1].isTarget).toBe(false);

    // Brain state
    expect(inspection!.brain).toBeDefined();
    expect(inspection!.brain!.state).toBe('chase');

    // Taunt
    region.afflict(cId, 'taunted', 4, { by: 'p2' });
    const tauntedInspection = region.inspect('creature', cId);
    expect(tauntedInspection!.threat!.tauntedBy).toBe('p2');
  });

  it('returns undefined for non-existent entities', () => {
    const region = new Region(regionDef('shore')!);
    expect(region.inspect('player', 'non-existent')).toBeUndefined();
    expect(region.inspect('creature', 'non-existent')).toBeUndefined();
  });
});
