#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Departure, ReplayTickEvent, ReplayTrace } from '@co-mmo/shared';
import { mulberry32 } from '../debug/prng.ts';
import { computeSnapshotHash } from '../debug/region-recorder.ts';
import { Region } from '../region.ts';

export interface ReplayOptions {
  /** Stop replay once this tick number is reached. */
  maxTick?: number;
  /** Verify snapshot hashes and departures at each tick. Throws on mismatch. */
  verify?: boolean;
  /** Interactive tick-by-tick execution (waits for prompt). */
  step?: boolean;
  /** Hook called after each tick with current event and region. */
  onTick?: (event: ReplayTickEvent, region: Region) => void | Promise<void>;
}

export interface ReplayResult {
  success: boolean;
  ticks: number;
  region: Region;
  mismatches: string[];
  durationMs: number;
}

/**
 * Headless region replay runner.
 * Initializes a bare Region with the trace's seed and clock, restores initial state,
 * feeds player inputs tick-by-tick, and verifies state consistency.
 */
export async function replayTrace(trace: ReplayTrace, options: ReplayOptions = {}): Promise<ReplayResult> {
  const startTime = performance.now();
  const mismatches: string[] = [];

  let currentClock = trace.header.startClock;
  const clock = () => currentClock;
  const prng = mulberry32(trace.header.seed);

  // Bare region without network sockets or storage
  const region = new Region(trace.header.regionDef, undefined, clock, prng);

  const startTick = trace.ticks[0]?.tick ? trace.ticks[0].tick - 1 : 0;
  region.restoreInitialState(trace.header.initialState, startTick);
  // Ensure PRNG starts at exact initial sequence for ticking
  region.setRandom(mulberry32(trace.header.seed));

  let ticksReplayed = 0;

  for (const tickEvent of trace.ticks) {
    if (options.maxTick !== undefined && tickEvent.tick > options.maxTick) {
      break;
    }

    currentClock = tickEvent.clock;

    // Feed player inputs for this tick
    for (const input of tickEvent.inputs) {
      region.handle(input.playerId, input.message);
    }

    // Advance simulation by 1 tick
    const departures: Departure[] = region.tick();

    // Verify snapshot hash and departures
    if (options.verify) {
      const expectedDepartures = tickEvent.departures ?? [];
      const actualJson = JSON.stringify(departures);
      const expectedJson = JSON.stringify(expectedDepartures);
      if (actualJson !== expectedJson) {
        mismatches.push(`Tick ${tickEvent.tick}: Departure mismatch! Expected ${expectedJson}, got ${actualJson}`);
      }

      if (tickEvent.snapshotHash) {
        const actualHash = computeSnapshotHash(region);
        if (actualHash !== tickEvent.snapshotHash) {
          mismatches.push(`Tick ${tickEvent.tick}: Snapshot hash mismatch! Expected ${tickEvent.snapshotHash}, got ${actualHash}`);
        }
      }
    }

    if (options.onTick) {
      await options.onTick(tickEvent, region);
    }

    ticksReplayed++;

    if (mismatches.length > 0 && options.verify) {
      break;
    }
  }

  const durationMs = performance.now() - startTime;
  return {
    success: mismatches.length === 0,
    ticks: ticksReplayed,
    region,
    mismatches,
    durationMs,
  };
}

function printUsage(): void {
  console.log(`
co-MMO Headless Record & Replay Tool

Usage:
  tsx packages/server/src/tools/replay.ts <trace.json> [flags]

Flags:
  --tick <N>   Stop replay after tick N
  --step       Step tick-by-tick interactively (press Enter to advance)
  --verify     Verify snapshot hashes and departures at every tick
  --quiet, -q  Suppress per-tick output
  --help, -h   Show this help message

Examples:
  tsx packages/server/src/tools/replay.ts trace.json --verify
  tsx packages/server/src/tools/replay.ts trace.json --tick 100
  tsx packages/server/src/tools/replay.ts trace.json --step
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let maxTick: number | undefined;
  let step = false;
  let verify = false;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--step') {
      step = true;
    } else if (arg === '--verify') {
      verify = true;
    } else if (arg === '--quiet' || arg === '-q') {
      quiet = true;
    } else if (arg === '--tick') {
      const val = args[++i];
      if (!val || Number.isNaN(Number(val))) {
        console.error('Error: --tick requires a numeric tick count.');
        process.exit(1);
      }
      maxTick = Number(val);
    } else if (arg.startsWith('--tick=')) {
      const val = arg.slice('--tick='.length);
      maxTick = Number(val);
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  if (!filePath) {
    console.error('Error: Missing trace file path.');
    printUsage();
    process.exit(1);
  }

  let trace: ReplayTrace;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    trace = JSON.parse(raw) as ReplayTrace;
  } catch (err) {
    console.error(`Error reading trace file "${filePath}":`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (!trace.header || !Array.isArray(trace.ticks)) {
    console.error('Error: Invalid trace format. Expected { header, ticks: [] }.');
    process.exit(1);
  }

  if (!quiet) {
    console.log(`Replaying trace: Region "${trace.header.regionId}" | Version ${trace.header.version} | Seed ${trace.header.seed} | ${trace.ticks.length} ticks`);
    if (verify) console.log('Verification: ENABLED (verifying snapshot hashes and departures per tick)');
    if (maxTick !== undefined) console.log(`Stopping at tick: ${maxTick}`);
  }

  let rl: ReturnType<typeof createInterface> | undefined;
  if (step) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }

  const promptEnter = async (): Promise<void> => {
    if (!rl) return;
    return new Promise((resolve) => {
      rl!.question('Press Enter to step to next tick...', () => resolve());
    });
  };

  const result = await replayTrace(trace, {
    maxTick,
    verify,
    step,
    onTick: async (event, reg) => {
      if (step) {
        const players = reg.allPlayers().map((p) => `${p.info.name} (HP: ${p.character.hp.toFixed(1)})`).join(', ');
        const creatures = reg.allCreatures().map((c) => `${c.def.name} (HP: ${c.hp.toFixed(1)}, Aggro: ${c.aggro ?? 'none'})`).join(', ');
        console.log(`\n[Tick ${event.tick}] Clock: ${event.clock} | Inputs: ${event.inputs.length} | Hash: ${event.snapshotHash ?? 'none'}`);
        if (players) console.log(`  Players:   ${players}`);
        if (creatures) console.log(`  Creatures: ${creatures}`);
        await promptEnter();
      }
    },
  });

  if (rl) rl.close();

  if (!result.success) {
    console.error(`\n❌ Replay verification failed after ${result.ticks} ticks:`);
    for (const mismatch of result.mismatches) {
      console.error(`  - ${mismatch}`);
    }
    process.exit(1);
  }

  if (!quiet) {
    console.log(`\n✓ Replay completed successfully: ${result.ticks} ticks replayed in ${result.durationMs.toFixed(1)} ms.`);
  }

  process.exit(0);
}

// Run CLI directly if executed from command line
const isDirectCli = process.argv[1]?.endsWith('replay.ts') || process.argv[1]?.endsWith('replay');
if (isDirectCli) {
  main().catch((err) => {
    console.error('Fatal replay error:', err);
    process.exit(1);
  });
}
