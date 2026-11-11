// The network bench (`npm run netbench`, docs/playtest.md): robot players
// walk about the Sanctum through a pretend network (lag-proxy.ts) and the
// bench reports what they felt. Nothing is paid for: the server runs with
// fake AI, as in the playtests. It fails only if robots get no snapshots;
// the numbers are for people to compare before and after a change.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RegionServer } from '../src/region-server.ts';
import { netFromEnv } from '../src/socket-net.ts';
import { account, app, start } from '../test/helpers.ts';
import { BenchBot, smoothness } from './bench-bot.ts';
import { SlowBus, lagProxy, type LagProxy, type Link } from './lag-proxy.ts';

const SECONDS = Number(process.env.NETBENCH_SECONDS ?? 10);
const WARM_UP_MS = 2000;
/** Robots that draw the others and measure smoothness (the rest only walk). */
const WATCHERS = 3;

const LAN: Link = { name: 'same machine', delayMs: 0, jitterMs: 0 };
const WIFI: Link = { name: 'home Wi-Fi', delayMs: 20, jitterMs: 40 };
const MOBILE: Link = { name: 'mobile', delayMs: 50, jitterMs: 120 };
/** Slower than 20 players' snapshots need even compressed (about 4 KB/s), so the server has to skip some. */
const WEAK: Link = { name: 'weak link, 3 KB/s', delayMs: 30, jitterMs: 40, bytesPerSecond: 3_000 };

interface Scenario {
  name: string;
  players: number;
  link: Link;
  /** One more robot on this link, reported on its own row. */
  extra?: Link;
  /** Run the Sanctum on a region server this many ms away from the game server. */
  regionServerMs?: number;
}

const SCENARIOS: Scenario[] = [
  { name: '10 players, same machine', players: 10, link: LAN },
  { name: '10 players, home Wi-Fi', players: 10, link: WIFI },
  { name: '10 players, mobile', players: 10, link: MOBILE },
  { name: '40 players, home Wi-Fi', players: 40, link: WIFI },
  { name: '20 players + one on a weak link', players: 20, link: WIFI, extra: WEAK },
  { name: '10 players, region server 20 ms away', players: 10, link: WIFI, regionServerMs: 20 },
  { name: '40 players, region server 20 ms away', players: 40, link: WIFI, regionServerMs: 20 },
];

/** One line of the report. */
interface Row {
  scenario: string;
  link: string;
  players: number;
  snapshotsPerSecond: number;
  /** Bytes a second each robot received on the wire, KB. */
  kbPerPlayer: number;
  /** Everything the game server sent the robots, MB a second. */
  hostMbPerSecond: number;
  gapP50: number;
  gapP95: number;
  answeredP50: number;
  answeredP95: number;
  /** Median of the last steps answered: whether lag grew over the run. */
  answeredAtEnd: number;
  wobblePct: number;
  /** The same for the server's own positions, tick to tick: uneven steps that start before the network (a robot's late steps, two in one tick). */
  serverWobblePct: number;
  stallPct: number;
  leapPct: number;
  tickMs: number;
  /** Snapshots the server skipped a second for each robot, because it had fallen behind. */
  skippedPerSecond: number;
  /** CPU the whole bench process used (game server, robots and proxies together), % of one core. */
  cpuPct: number;
}

const rows: Row[] = [];

/** `NETBENCH_ONLY=wi-fi` runs the scenarios whose names hold those words. */
const ONLY = process.env.NETBENCH_ONLY?.toLowerCase();

describe('network bench', () => {
  for (const scenario of SCENARIOS.filter((s) => !ONLY || s.name.toLowerCase().includes(ONLY))) {
    it(scenario.name, async () => {
      const result = await run(scenario);
      rows.push(...result);
      expect(result[0]!.snapshotsPerSecond).toBeGreaterThan(0);
    });
  }
  afterAll(async () => {
    if (!rows.length) return;
    console.log(`\nNetwork bench, ${SECONDS} s each\n\n${table(rows)}\n`);
    const dir = join(process.cwd(), 'netbench-results');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `netbench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify({ seconds: SECONDS, rows }, null, 2));
    console.log(`Saved to ${file}`);
  });
});

/** Plays one scenario and measures it. */
async function run(scenario: Scenario): Promise<Row[]> {
  const bus = scenario.regionServerMs !== undefined ? new SlowBus(scenario.regionServerMs) : undefined;
  // The game's network choices, as .env would set them (NET_COMPRESS=off to compare).
  const { store, ws } = await start({ net: netFromEnv(process.env), ...(bus ? { regionBus: bus } : {}) });
  const port = Number(new URL(ws).port);
  let regionServer: RegionServer | undefined;
  if (bus) {
    regionServer = new RegionServer({ bus, id: 'bench' });
    await regionServer.start();
    const until = Date.now() + 15_000;
    while (app!.world.home.host !== 'bench' && Date.now() < until) await pause(50);
  }
  const proxies: LagProxy[] = [await lagProxy(port, scenario.link)];
  if (scenario.extra) proxies.push(await lagProxy(port, scenario.extra));
  const turns = new Map<string, number>();
  const turned = (id: string) => turns.get(id) ?? 0;
  const bots: BenchBot[] = [];
  const total = scenario.players + (scenario.extra ? 1 : 0);
  try {
    for (let i = 0; i < total; i++) {
      const { token } = account(store, `Bench${i}`);
      const extra = scenario.extra && i === total - 1;
      const proxy = extra ? proxies[1]! : proxies[0]!;
      bots.push(await BenchBot.join(`ws://127.0.0.1:${proxy.port}/ws`, token, i, i < WATCHERS || !!extra, turned));
    }
    const startedAt = performance.now();
    for (const bot of bots) bot.start(startedAt, (id, at) => turns.set(id, at));
    await pause(WARM_UP_MS);
    // Measure from here: the warm-up's numbers are thrown away.
    for (const bot of bots) Object.assign(bot.numbers, { snapshots: 0, gaps: [], answered: [], speeds: [], sourceSpeeds: [], chars: 0, skipped: 0 });
    const before = proxies.map((p) => ({ ...p.counts }));
    const cpuBefore = process.cpuUsage();
    await pause(SECONDS * 1000);
    const cpu = process.cpuUsage(cpuBefore);
    const cpuPct = ((cpu.user + cpu.system) / 1000 / (SECONDS * 1000)) * 100;
    for (const bot of bots) bot.stop();
    const tickMs = (regionServer ? (regionServer as unknown as { meter: { load(): { tickMs: number } } }).meter : app!.meter).load().tickMs;
    const sent = proxies.map((p, i) => p.counts.down - before[i]!.down);
    const main = bots.slice(0, scenario.players);
    const result = [row(scenario.name, scenario.link.name, scenario.players, main, sent[0]!, tickMs, cpuPct)];
    if (scenario.extra) result.push(row(`${scenario.name}: the weak one`, scenario.extra.name, 1, bots.slice(-1), sent[1]!, tickMs, cpuPct));
    return result;
  } finally {
    for (const bot of bots) bot.close();
    for (const proxy of proxies) await proxy.close();
    await regionServer?.stop();
  }
}

/** A report line from the robots that share one link. */
function row(scenario: string, link: string, players: number, bots: BenchBot[], bytes: number, tickMs: number, cpuPct: number): Row {
  const n = bots.map((b) => b.numbers);
  const gaps = n.flatMap((x) => x.gaps);
  const answered = n.flatMap((x) => x.answered);
  const atEnd = n.flatMap((x) => x.answered.slice(-20));
  const smooth = smoothness(n.flatMap((x) => x.speeds));
  const snapshots = n.reduce((a, x) => a + x.snapshots, 0);
  return {
    scenario, link, players,
    snapshotsPerSecond: round(snapshots / bots.length / SECONDS),
    kbPerPlayer: round(bytes / bots.length / SECONDS / 1024),
    hostMbPerSecond: round(bytes / SECONDS / 1024 / 1024, 2),
    gapP50: round(pct(gaps, 0.5)), gapP95: round(pct(gaps, 0.95)),
    answeredP50: round(pct(answered, 0.5)), answeredP95: round(pct(answered, 0.95)), answeredAtEnd: round(pct(atEnd, 0.5)),
    wobblePct: round(smooth.wobble * 100),
    serverWobblePct: round(smoothness(n.flatMap((x) => x.sourceSpeeds)).wobble * 100), stallPct: round(smooth.stalls * 100), leapPct: round(smooth.leaps * 100),
    tickMs: round(tickMs, 2),
    cpuPct: round(cpuPct),
    skippedPerSecond: round(n.reduce((a, x) => a + x.skipped, 0) / bots.length / SECONDS),
  };
}

/** The report as a plain text table. */
function table(list: Row[]): string {
  const head = ['scenario', 'snaps/s', 'KB/s each', 'host MB/s', 'gap p50/p95 ms', 'step answered p50/p95/end ms', 'others wobble % (server)', 'stalls %', 'leaps %', 'tick ms', 'cpu %', 'skipped/s'];
  const lines = list.map((r) => [r.scenario, r.snapshotsPerSecond, r.kbPerPlayer, r.hostMbPerSecond, `${r.gapP50}/${r.gapP95}`, `${r.answeredP50}/${r.answeredP95}/${r.answeredAtEnd}`, `${r.wobblePct} (${r.serverWobblePct})`, r.stallPct, r.leapPct, r.tickMs, r.cpuPct, r.skippedPerSecond].map(String));
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [fmt(head), fmt(widths.map((w) => '-'.repeat(w))), ...lines.map(fmt)].join('\n');
}

function pct(list: number[], p: number): number {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
