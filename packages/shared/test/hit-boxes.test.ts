import { describe, expect, it } from 'vitest';
import { BodyGrid, PERSON_RADIUS, Predictor, bodiesSeen, bodyList, bodyOf, creatureRadius, generateRegion, pressesInto, pushOut, regionDef, sizeReach, step, type HitBody } from '../src/index.ts';

const creature = (x: number, y: number, floor = 0): HitBody => ({ x, y, floor, r: PERSON_RADIUS, kind: 'creature' });

describe('hit boxes', () => {
  it('stops a step into someone, but lets those already overlapping step apart', () => {
    const me = { r: PERSON_RADIUS, kind: 'creature' as const, floor: 0 };
    const other = creature(1, 0);
    expect(pressesInto(me, { x: 0, y: 0 }, { x: 0.5, y: 0 }, [other])).toBe(true);
    expect(pressesInto(me, { x: 0, y: 0 }, { x: -0.5, y: 0 }, [other])).toBe(false);
    // Already inside one another (put on one spot): stepping out is fine, stepping deeper is not.
    expect(pressesInto(me, { x: 0.8, y: 0 }, { x: 0.7, y: 0 }, [other])).toBe(false);
    expect(pressesInto(me, { x: 0.8, y: 0 }, { x: 0.9, y: 0 }, [other])).toBe(true);
    // Someone on another floor is no one in the way.
    expect(pressesInto(me, { x: 0, y: 0 }, { x: 0.5, y: 0 }, [creature(1, 0, 1)])).toBe(false);
  });

  it('players walk through players and people, but not through creatures', () => {
    const player = { r: PERSON_RADIUS, kind: 'player' as const, floor: 0 };
    const at = { x: 0, y: 0 };
    const to = { x: 0.5, y: 0 };
    expect(pressesInto(player, at, to, [{ x: 1, y: 0, r: PERSON_RADIUS, kind: 'player' }])).toBe(false);
    expect(pressesInto(player, at, to, [{ x: 1, y: 0, r: PERSON_RADIUS, kind: 'npc' }])).toBe(false);
    // People are stopped by players, and step aside for them (pushOut).
    expect(pressesInto({ r: PERSON_RADIUS, kind: 'npc' }, at, to, [{ x: 1, y: 0, r: PERSON_RADIUS, kind: 'player' }])).toBe(true);
    expect(pressesInto(player, at, to, [creature(1, 0)])).toBe(true);
    // A creature is stopped by a player.
    expect(pressesInto({ r: PERSON_RADIUS, kind: 'creature' }, at, to, [{ x: 1, y: 0, r: PERSON_RADIUS, kind: 'player' }])).toBe(true);
  });

  it('never bumps into its own body', () => {
    const me = { x: 3, y: 3, floor: 0 };
    const body = bodyOf(me, PERSON_RADIUS, 'creature');
    expect(pressesInto(body, me, { x: 3.1, y: 3 }, [body])).toBe(false);
    me.x = 4;
    expect(body.x).toBe(4);
  });

  it('bigger creatures stand wider and reach farther', () => {
    expect(creatureRadius()).toBe(PERSON_RADIUS);
    expect(creatureRadius('colossal')).toBeGreaterThan(creatureRadius('high'));
    expect(creatureRadius('tiny')).toBeLessThan(creatureRadius('small'));
    expect(sizeReach('medium')).toBe(0);
    expect(sizeReach('colossal')).toBeGreaterThan(0);
  });

  it('finds bodies close by in the grid, and not far ones', () => {
    const near = creature(10.5, 10.5);
    const far = creature(40, 40);
    const grid = new BodyGrid([near, far]);
    const found = [...grid.near(11, 11, PERSON_RADIUS)];
    expect(found).toContain(near);
    expect(found).not.toContain(far);
  });

  it('pushes out of those it stands inside', () => {
    const me = { r: PERSON_RADIUS, kind: 'creature' as const, floor: 0 };
    const push = pushOut(me, { x: 0, y: 0 }, [creature(0.4, 0)], () => 0);
    expect(push.x).toBeLessThan(0);
    expect(push.y).toBeCloseTo(0);
    expect(pushOut(me, { x: 0, y: 0 }, [creature(2, 0)], () => 0)).toEqual({ x: 0, y: 0 });
    const same = pushOut(me, { x: 0, y: 0 }, [creature(0, 0)], () => 0.25);
    expect(Math.hypot(same.x, same.y)).toBeCloseTo(PERSON_RADIUS * 2);
  });
});

describe('a player among bodies', () => {
  const map = generateRegion(regionDef('sanctum')!);
  const start = { x: map.spawn.x, y: map.spawn.y };

  it('is stopped by a creature in the way, and slides past one off to the side', () => {
    const ahead = creature(start.x + 0.7, start.y);
    const among = { self: { r: PERSON_RADIUS, kind: 'player' as const, floor: 0 }, bodies: bodyList([ahead]) };
    expect(step(map, start, 1, 0, 0, 1, among).x).toBe(start.x);
    expect(step(map, start, 1, 0, 0, 1).x).toBeGreaterThan(start.x);
    const after = step(map, start, 1, 1, 0, 1, among);
    expect(after.y).toBeGreaterThan(start.y);
  });

  it('is predicted to stop where the server stops it', () => {
    const predictor = new Predictor(map, start);
    predictor.bodies = bodiesSeen([{ id: 'c', kind: 'k', asset: 'a', name: 'C', x: start.x + 0.7, y: start.y, health: 1 }]);
    for (let i = 0; i < 10; i++) predictor.apply(1, 0);
    expect(predictor.position.x).toBe(start.x);
    // Big creatures stand wider.
    expect(bodiesSeen([{ id: 'c', kind: 'k', asset: 'a', name: 'C', x: 0, y: 0, health: 1, size: 'colossal' }])[0]!.r).toBe(creatureRadius('colossal'));
  });
});
