// The automated test run a scripted rule must pass before a Steward can let
// it into the world (design doc: "Automated test run in a simulated region,
// then Steward review"). It builds a fresh copy of the launch world, puts a
// test player beside water in every region, and plays the rule's events
// through the real sandbox, with time fast-forwarded.

import { CREATURES, Tile, collides, newCharacter, outsideSide, tileAt, type RuleWish, type ServerMessage } from '@co-mmo/shared';
import { RuleError, RuleRuntime, worldHost, type RuleStatus } from './rules.ts';
import { World } from './world.ts';

export interface RuleTestReport {
  passed: boolean;
  at: number;
  /** What happened, in plain lines for God's View. */
  summary: string[];
  errors: string[];
  effects: Record<string, number>;
  /** A few of the messages players would have seen. */
  sample: string[];
}

/** Simulated seconds the test lets timers run for. */
const SIMULATED_SECONDS = 15 * 60;

export async function testRule(id: string, def: RuleWish, at = Date.now()): Promise<RuleTestReport> {
  let clock = at;
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const world = new World(() => clock, random);
  const seen: string[] = [];
  const errors: string[] = [];
  const state: Record<string, Record<string, Record<string, unknown>>> = {};

  let rule: RuleRuntime;
  try {
    rule = await RuleRuntime.load(id, def, {
      host: worldHost(world),
      state: { read: (r) => state[r] ?? {}, write: (r, d) => void (state[r] = d) },
      now: () => clock,
      random,
    });
  } catch (err) {
    const message = err instanceof RuleError ? err.message : `The script did not load: ${(err as Error).message}`;
    return { passed: false, at, summary: ['The script did not load.'], errors: [message], effects: {}, sample: [] };
  }

  try {
    const testers: string[] = [];
    for (const region of world.regions.values()) {
      const id = `tester-${region.def.id}`;
      const spot = besideWater(region.map) ?? region.map.spawn;
      world.join({ id, name: `Tester of ${region.def.name}`, color: 0xffffff, role: 'player' }, {
        send: (m: ServerMessage) => {
          if ((m.t === 'notice' || m.t === 'system') && !/entered|left|arrived|set off/.test(m.text)) seen.push(`${region.def.name}: ${m.text}`);
        },
        close: () => undefined,
      }, { regionId: region.def.id, ...spot }, newCharacter());
      testers.push(id);
    }
    const rounds: [string, Record<string, string | number>][] = [
      ['join', {}],
      ['enter', {}],
      ...Object.keys(def.items).map((key): [string, Record<string, string | number>] => ['use', { item: key }]),
      ['interact', { tile: 'water' }],
      ['interact', { tile: 'tree' }],
      ['interact', { tile: 'rock' }],
      ['interact', { tile: 'ground' }],
      ...Object.keys(CREATURES).filter((k) => !/^w[0-9a-z]{6,}/.test(k)).map((creature): [string, Record<string, string | number>] => ['defeat', { creature }]),
    ];
    const play = (type: string, data: Record<string, string | number>) => {
      for (const player of testers) {
        const where = world.regionOf(player)?.def.id;
        rule.fire(type, player, { ...data, ...(type === 'enter' && where ? { region: where } : {}) });
      }
    };
    for (const [type, data] of rounds) play(type, data);
    // Let time pass, acting again now and then, as a player would.
    for (let s = 1; s <= SIMULATED_SECONDS && !rule.status.paused; s++) {
      clock += 1000;
      rule.tick();
      if (s % 20 === 0 && s <= 300) play('interact', { tile: 'water' });
      if (s % 60 === 0 && s <= 300) for (const key of Object.keys(def.items)) play('use', { item: key });
    }
    return report(rule.status, rule.pendingTimers, at, seen, errors);
  } finally {
    rule.dispose();
  }
}

function report(status: RuleStatus, timersLeft: number, at: number, seen: string[], errors: string[]): RuleTestReport {
  const all = [...errors, ...status.errors.map((e) => e.message)];
  const unique = [...new Set(all)];
  const did = Object.entries(status.effects).filter(([k]) => !k.startsWith('capped-'));
  const capped = Object.entries(status.effects).filter(([k]) => k.startsWith('capped-'));
  const summary = [
    `Ran ${status.runs} events across the four launch regions over ${SIMULATED_SECONDS / 60} simulated minutes.`,
    did.length ? `Effects: ${did.map(([k, n]) => `${k} ${n}`).join(', ')}.` : 'It did nothing that players would notice.',
    ...(capped.length ? [`Balance limits stopped it: ${capped.map(([k, n]) => `${k.slice(7)} ${n}x`).join(', ')}.`] : []),
    ...(timersLeft ? [`${timersLeft} timers were still waiting at the end.`] : []),
    unique.length ? `${all.length} errors.` : 'No errors.',
    ...(status.paused ? [`It paused itself: ${status.reason}`] : []),
  ];
  return {
    passed: !status.paused && unique.length === 0 && did.length > 0,
    at,
    summary,
    errors: unique.slice(0, 8),
    effects: status.effects,
    sample: [...new Set(seen)].slice(0, 12),
  };
}

/** A walkable spot right beside water, so rules about water can be tried. */
function besideWater(map: World['home']['map']): { x: number; y: number } | undefined {
  const cx = map.width / 2;
  const cy = map.height / 2;
  let best: { x: number; y: number } | undefined;
  let bestD = Infinity;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (tileAt(map, x, y) !== Tile.Water) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const s = { x: x + dx + 0.5, y: y + dy + 0.5 };
        if (outsideSide(map, s.x, s.y) || collides(map, s.x, s.y)) continue;
        const d = Math.hypot(s.x - cx, s.y - cy);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
  }
  return best;
}
