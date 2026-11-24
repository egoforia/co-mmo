// Combat through a pretend network (`npm run netbench`, docs/playtest.md): a
// robot stands beside a creature that neither dies nor strikes back and holds
// Space as the browser does (client held-strike.ts: a swing each time its own
// clock says the cooldown is over), over a wired line, home Wi-Fi and mobile,
// with the line's wobble on its keys as well as on what it hears. It reports
// how long a strike took to be answered and how many of the swings it showed
// never landed. Nothing is painted: no AI runs at all.

import { afterAll, describe, it } from 'vitest';
import { WebSocket } from 'ws';
import { attackCooldown, type ServerMessage } from '@co-mmo/shared';
import { account, app, start, stop } from '../test/helpers.ts';
import { lagProxy, type Link } from './lag-proxy.ts';

const SECONDS = Number(process.env.NETBENCH_SECONDS ?? 10);

const LINKS: Link[] = [
  { name: 'same machine', delayMs: 0, jitterMs: 0 },
  { name: 'home Wi-Fi', delayMs: 20, jitterMs: 40, upJitterMs: 40 },
  { name: 'mobile', delayMs: 50, jitterMs: 120, upJitterMs: 120 },
];

/** `NETBENCH_ONLY=combat` runs these alone; `NETBENCH_ONLY=mobile` the mobile one among the rest. */
const ONLY = process.env.NETBENCH_ONLY?.toLowerCase();

interface CombatResult {
  scenario: string;
  swings: number;
  landed: number;
  emptyPct: number;
  answeredP50: number;
  answeredP95: number;
}

const results: CombatResult[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (list: number[], p: number) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!) : NaN;
};

describe('network bench: combat', () => {
  afterAll(() => {
    if (!results.length) return;
    const head = ['scenario', 'swings shown', 'landed', 'empty %', 'strike answered p50/p95 ms'];
    const lines = results.map((r) => [r.scenario, r.swings, r.landed, r.emptyPct, `${r.answeredP50}/${r.answeredP95}`].map(String));
    const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
    const row = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
    console.log(`\nCombat bench, Space held ${SECONDS} s\n\n${[row(head), row(widths.map((w) => '-'.repeat(w))), ...lines.map(row)].join('\n')}\n`);
  });

  for (const link of LINKS) {
    const name = `combat, ${link.name}`;
    it.skipIf(Boolean(ONLY && !name.includes(ONLY)))(name, async () => {
      results.push(await holdSpace(name, link));
    }, 60_000 + SECONDS * 1000);
  }
});

/** One robot holds Space beside a creature over `link`: what it showed, what landed, and how soon. */
async function holdSpace(scenario: string, link: Link): Promise<CombatResult> {
  const { store, ws } = await start({});
  const proxy = link.delayMs || link.jitterMs ? await lagProxy(Number(new URL(ws).port), link) : undefined;
  const { token } = account(store, 'Fighter');
  const socket = new WebSocket(proxy ? `ws://127.0.0.1:${proxy.port}/ws` : ws);
  let me = '';
  let seen = false;
  const sent: number[] = [];
  const answered: number[] = [];
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', token })));
  socket.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as ServerMessage;
    if (m.t === 'welcome') me = m.you.id;
    if (m.t === 'snapshot') seen = true;
    // Each strike answers the swing sent just before it.
    if (m.t === 'hit' && m.by === me && sent.length) answered.push(performance.now() - sent.at(-1)!);
  });
  while (!me || !seen) await pause(20);

  // A creature beside us that takes every blow and gives none.
  const s = (app!.world.home as unknown as { s: any }).s;
  s.map.safe = [];
  const p = s.players.get(me);
  const c = s.creatures.find((x: any) => x.respawnAt === null && (x.width ?? 1) === 1 && !x.floor);
  c.def = { ...c.def, behavior: 'wander', notice: 0, damage: 0, active: 'always' };
  Object.assign(c, { x: Math.floor(p.x) + 1.5, y: Math.floor(p.y) + 0.5, floor: 0, rest: 1e9, hp: 1e9 });
  c.home = { x: c.x, y: c.y, floor: 0 };
  delete c.to;
  await pause(300);

  // Space held: a swing each time our own clock says the cooldown is over.
  const cooldown = attackCooldown(p.character) * 1000;
  const began = performance.now();
  await new Promise<void>((resolve) => {
    const swing = () => {
      if (performance.now() - began >= SECONDS * 1000) return resolve();
      sent.push(performance.now());
      socket.send(JSON.stringify({ t: 'attack', target: c.id }));
      c.hp = 1e9;
      setTimeout(swing, cooldown);
    };
    swing();
  });
  await pause(600);
  socket.close();
  await proxy?.close();
  await stop();
  const landed = answered.length;
  return {
    scenario,
    swings: sent.length,
    landed,
    emptyPct: Math.round((1 - landed / sent.length) * 100),
    answeredP50: pct(answered, 0.5),
    answeredP95: pct(answered, 0.95),
  };
}
