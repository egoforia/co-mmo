# Game Loop Debugging Tools: Architecture & Implementation Plan

This plan designs a cohesive suite of observability and debugging tools for co-MMO's server simulation loop. The tools enable the Owner and Stewards to identify performance bottlenecks, diagnose entity and combat behavior, and deterministically reproduce bugs across both single-process file mode and multi-host Scale mode.

---

## 1. System Overview & The Game Loop Today

The server simulation runs at a fixed rate of 20 ticks per second (`TICK_RATE = 20`, `TICK_SECONDS = 0.05s`, `constants.ts`), giving a strict **50 ms budget** per tick.

The loop executes synchronously on each Node process's main event loop:
1. **Gateway** (`app.ts`):
   ```ts
   setInterval(() => meter.tick(() => {
     world.tick(meter.strain);
     rules.tick();
   }), TICK_SECONDS * 1000);
   ```
2. **Region Servers** (`region-server.ts`):
   ```ts
   setInterval(() => this.tick(), TICK_SECONDS * 1000);
   ```
   Each tick executes `meter.tick(() => this.tickRegions())`, then flushes queued network messages to the gateway.
3. **Region Tick Lifecycle** (`region.ts` line 646):
   - **Inputs & Movement**: Process queued inputs per player, walk calculation (`walkOn`), stairways, departures, HP and Energy regeneration.
   - **Sky & Weather**: Light phase and weather turns.
   - **Combat**: `combat.tick(now)` updating damage statuses, traps, summoned helpers, Sanctuaries, stances, and signature gauges.
   - **Minds Think**: `minds.think(now, phase, weather)` running creature AI (`creature-brain.ts`), threat evaluations (`threat.ts`), and creature attacks.
   - **Bodies & Loot**: Fading bodies and closing loot windows.
   - **Minds Live**: `minds.live(phase)` running townsfolk routines and NPC dialogue states.
   - **Fallen**: `fallen.tick(now)` handling player wake-up at shrines.
   - **Player Snapshots**: Area-of-interest entity filtering (`canSeeAcrossFloors`, `VIEW_RADIUS`), formatting entity views, and dispatching WebSocket snapshots (thinned by `snapshotEvery` when strained).
4. **Sandbox Rules**: `rules.tick()` runs scripted wish rules inside the QuickJS sandbox on the gateway.

Currently, `LoadMeter` (`load-meter.ts`) measures aggregate tick time (`tickMs`, `worstTickMs`), event loop lag via `monitorEventLoopDelay`, memory, and caught errors. What is missing is the internal visibility to know *why* a tick is slow, *what* an entity is deciding, and *how* to reproduce glitches deterministically.

---

## 2. The Tool Suite: Detailed Specifications

### Tool 1: Tick Profiler with Per-Phase Timings

#### Why
- **Problem**: When a tick spikes to 65 ms or a process shows high strain, `LoadMeter` only reveals that the tick was slow as a whole. We cannot distinguish whether the stall was caused by complex A* creature pathfinding, quadratic spell collisions (e.g. Chain Spark in a crowded split cell), snapshot serialization overhead, or a long-running QuickJS wish script.
- **Scenario**: In a crowded raid in the Sanctum Catacombs, a Wishweaver casts Chain Spark. Ticks jump to 72 ms, turning the Server Health card red. The profiler instantly shows: `Combat & effects: 54.2 ms (75%)`, `Creature brains: 4.8 ms`, `Player snapshots: 6.1 ms`, immediately isolating the issue to combat effect chain resolution.

#### What
- Times each distinct phase of `Region.tick()`, plus `rules.tick()` on the gateway.
- Computes rolling average (`avgMs`) and worst time (`worstMs`) over the recent 100 ticks (`KEPT = 100`).
- Aggregates phase statistics per host and carries them in `ServerLoad`.
- **Data Shapes**:
  ```ts
  /** Per-phase timing in ms over the recent window. */
  export interface PhaseTiming {
    avgMs: number;
    worstMs: number;
  }

  /** Phase timings keyed by phase name. */
  export type PhaseTimings = Record<string, PhaseTiming>;

  /** Full timing breakdown for a host. */
  export interface HostTickBreakdown {
    phases: PhaseTimings;
    slowestRegion?: {
      id: string;
      phase: string;
      ms: number;
    };
  }
  ```
- **Who Can Use It**: Owner only (in God's View `Server health` tab).
- **UI**: In `packages/client/src/gods-view/servers.ts`, inside each host card:
  - A horizontal proportional phase bar displaying the percentage share of each phase.
  - A table with plain labels ("Creature brains", "Combat & effects", "Player snapshots", "Inputs & movement", "Sandbox rules") showing average and worst ms.

#### Where
- `packages/shared/src/profiler.ts`: Phase timing types (`PhaseTiming`, `PhaseTimings`, `HostTickBreakdown`).
- `packages/server/src/region/profiler.ts`: Lightweight `TickProfiler` engine.
- `packages/server/src/region.ts`: Phase wrapping helper `phase(name, fn)` in `Region.tick()`.
- `packages/server/src/app.ts`: Wrap `rules.tick()` and `world.tick()` with gateway profiler timings.
- `packages/server/src/load-meter.ts`: Add `phases?: PhaseTimings` to `ServerLoad`.
- `packages/server/src/region-link.ts`: Transmit `phases` in `ServerLoad` over the bus.
- `packages/server/src/region-server.ts`: Aggregate region phase timings on beat and send via `ServerLoad`.
- `packages/client/src/gods-view/servers.ts`: Render the phase breakdown under each host.

#### How
- **Approach**:
  `TickProfiler` wraps each tick phase using high-resolution monotonic time (`performance.now()`). To avoid garbage collection overhead in the hot loop, timings are recorded into pre-allocated numeric buffers.
  ```ts
  export class TickProfiler {
    measure<T>(phase: PhaseName, fn: () => T): T {
      const t0 = performance.now();
      try {
        return fn();
      } finally {
        this.record(phase, performance.now() - t0);
      }
    }
  }
  ```
- **Overhead**: `performance.now()` in V8 is a lightweight clock read (~25 ns). With 8 phases per region tick, 16 clock reads cost ~0.4 microseconds (0.0004 ms) per region tick—less than 0.001% of the 50 ms budget. Idle cost is negligible.
- **Privacy & Security**: Owner-only. Only numeric durations and phase names are recorded; no user data or secrets.

#### When
- Always on.
- Dependencies: None. Built in PR 1.
- Works identically in file mode and Scale mode (carried via `ServerLoad` over Redis).

#### Tests
- `packages/server/test/profiler.test.ts`:
  - Verify `measure()` records accurate durations and updates averages and worst values over 100 ticks.
  - Verify errors thrown inside a phase are recorded in `finally` and cleanly rethrown.
  - Verify overhead benchmark: 1,000 iterations introduce < 0.05 ms overhead.
- `packages/server/test/region-servers.test.ts`:
  - Verify region servers pass `phases` to the gateway over Redis bus in `ServerLoad`.

#### Words
- Phase names:
  - `inputs`: "Inputs & movement"
  - `sky`: "Sky & weather"
  - `combat`: "Combat & effects"
  - `minds_think`: "Creature brains"
  - `bodies`: "Loot & fading bodies"
  - `minds_live`: "Townsfolk routines"
  - `fallen`: "Fallen revival"
  - `snapshots`: "Player snapshots"
  - `rules`: "Sandbox rules"

---

### Tool 2: Slow-Tick Capture

#### Why
- **Problem**: Transient spikes (e.g., a tick that takes 80 ms once every 5 minutes when a monster wave spawns) disappear from rolling averages within seconds. When the Owner opens Server Health, the average is back to 4 ms and the transient bottleneck cannot be diagnosed.
- **Scenario**: During a server playtest, a player mentions a stutter in Whispering Woods. The Owner opens Server Health, clicks "Recent slow ticks", and inspects the entry from 2 minutes ago: Tick took 82.4 ms in `woods-cell-1`, with 32 players, 48 creatures, and 85 active statuses; the breakdown reveals `snapshots: 56.1 ms`. The Owner sees that crowded snapshots in that cell caused the lag.

#### What
- Maintains an in-memory ring buffer of the last 20 ticks that exceeded the 50 ms budget (`SLOW_TICK_THRESHOLD_MS = TICK_SECONDS * 1000 = 50`).
- Each entry records: timestamp, host, region or cell, entity counts, active statuses, phase breakdown, and any caught error.
- **Data Shapes**:
  ```ts
  export interface SlowTickRecord {
    id: number;
    at: number;
    host: string;
    region: string;
    cell?: { index: number; count: number };
    totalMs: number;
    phases: Record<string, number>;
    players: number;
    creatures: number;
    activeStatuses: number;
    error?: string;
  }
  ```
- **Who Can Use It**: Owner only in God's View `Server health`.
- **UI**:
  - In `servers.ts`: A collapsible "Recent slow ticks" section.
  - A table showing: Time ("14 s ago"), Server, Land, Entities, Statuses, Slowest Phase, and Total Time ("78 ms", colored red).
  - Clicking a row expands the full per-phase bar and caught error message (if any).
  - A "Clear slow ticks" button.

#### Where
- `packages/shared/src/slow-ticks.ts`: `SlowTickRecord` interface.
- `packages/server/src/debug/slow-tick-buffer.ts`: Fixed-capacity ring buffer (`SlowTickBuffer`).
- `packages/server/src/load-meter.ts`: Hook slow-tick recording when tick duration >= 50 ms.
- `packages/server/src/region-link.ts`: Transmit slow-tick events from region servers to gateway (`ToGateway: { t: 'slow-tick', record: SlowTickRecord }`).
- `packages/server/src/admin.ts`: Add `slowTicks` to `GET /api/admin/servers` and endpoint `POST /api/admin/servers/slow-ticks/clear`.
- `packages/client/src/gods-view/servers.ts`: UI rendering for slow ticks.

#### How
- **Approach**:
  At the end of `meter.tick()`, if `totalMs >= 50`:
  Collect current tick phase timings from `TickProfiler`, count active entities and statuses in the ticked regions, and push a `SlowTickRecord` into `SlowTickBuffer`.
  On region servers, emit a `slow-tick` message over the Redis bus to the gateway, which holds a unified ring buffer of recent slow ticks across the fleet.
- **Cost & Bounds**:
  - Idle: A single numerical comparison `totalMs >= 50` at the end of each tick (~0 ns).
  - Memory: Ring buffer is capped at 20 entries per host (maximum ~15 KB total).
- **Privacy & Security**: Owner-only. Does not record player inputs, chat content, or credentials.

#### When
- Always on.
- Dependencies: Built in PR 1 alongside Tool 1.
- Scale mode: Region servers notify gateway via Redis bus.

#### Tests
- `packages/server/test/slow-ticks.test.ts`:
  - Fast ticks (< 50 ms) do not add to buffer.
  - Slow ticks (>= 50 ms) capture exact phase breakdown and entity counts.
  - Ring buffer wraps at 20 entries without memory leak.
  - Exceptions during a tick are captured in the record's `error` property.

#### Words
- "Slow ticks"
- "No slow ticks recorded recently."
- "Ran over 50 ms budget"
- "Clear slow ticks"

---

### Tool 3: CPU Profile on Demand

#### Why
- **Problem**: When a phase is identified as slow (e.g. `minds_think` taking 40 ms), the cause might be diamond-isometric pathfinding, line-of-sight checks across 4 storeys, regex validation, or GC pressure. Developers need function-level flame charts to pinpoint the exact hot lines of code.
- **Scenario**: In the Coral Palace, tick times rise when many creatures patrol. A 10-second CPU profile is captured on the region server hosting the palace. Opening the `.cpuprofile` in Chrome DevTools shows 85% of CPU time in `RaycastFloor.hasLineOfSight()` checking wall colliders. The line of code is optimized the same afternoon.

#### What
- An Owner-only action in Server Health: **"Record a CPU profile (10 s)"**.
- Runs on the selected process: Game server (gateway) or any Region Server.
- Uses Node.js built-in `node:inspector` without third-party dependencies.
- Produces a standard V8 `.cpuprofile` file for direct download and viewing in Chrome DevTools.
- Also supports an on-demand **"Take heap snapshot"** (`.heapsnapshot`) to inspect memory allocations.
- **Data Shapes**:
  ```ts
  export interface CpuProfileRequest {
    host: string;
    durationSeconds: number;
  }

  export interface ProfileInfo {
    id: string;
    host: string;
    kind: 'cpu' | 'heap';
    startedAt: number;
    sizeBytes: number;
  }
  ```
- **Who Can Use It**: Owner only (`ownerOnly()` check).
- **UI**:
  - In `servers.ts`, action buttons on each host card:
    - Primary button: "Record CPU profile (10 s)"
    - Secondary button: "Take heap snapshot"
  - Live progress countdown: "Recording profile on Region server rs-1... 6 s remaining".
  - On finish: Toast with download prompt ("Download profile (host-timestamp.cpuprofile)").
  - List of stored profiles with download and delete buttons.

#### Where
- `packages/server/src/debug/profiler-session.ts`: `node:inspector` session manager.
- `packages/server/src/region-link.ts`: Bus messages:
  - `ToServer: { t: 'start-profile', profileId: string, durationSeconds: number, kind: 'cpu' | 'heap' }`
  - `ToGateway: { t: 'profile-done', profileId: string, error?: string }`
- `packages/server/src/region-server.ts`: Handle remote profile recording command.
- `packages/server/src/admin.ts`: Owner-only routes:
  - `POST /api/admin/servers/profile`: Initiate profile.
  - `GET /api/admin/servers/profile/status`: Check active recording.
  - `GET /api/admin/servers/profile/:id`: Download `.cpuprofile` or `.heapsnapshot`.
  - `DELETE /api/admin/servers/profile/:id`: Delete profile.
- `packages/client/src/gods-view/servers.ts`: UI controls and download triggers.

#### How
- **Approach**:
  Connects a `node:inspector.Session()`:
  ```ts
  import inspector from 'node:inspector';

  const session = new inspector.Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.start');
  setTimeout(() => {
    session.post('Profiler.stop', (err, { profile }) => {
      // Save profile to disk
      session.post('Profiler.disable');
      session.disconnect();
    });
  }, durationMs);
  ```
  On region servers: The region server records the profile locally and streams or transfers it to the gateway upon completion.
- **Storage & Lifecycle**:
  Profiles are saved to `data/profiles/` (or scratch directory in test runs), ignored by git.
  Storage and retention limits are controlled by environment variables:
  - `PROFILE_DIR`: storage directory (defaults to `data/profiles/`).
  - `PROFILE_MAX_FILES`: maximum profiles retained (defaults to `5`).
  - `PROFILE_PRUNE_HOURS`: maximum age in hours before auto-pruning (defaults to `1`).
  These configured limits are exposed in the God's View Server Health tab alongside the profile recording controls, so the Owner can see the active retention policy at a glance.
- **Cost**:
  - Idle: 0 (inspector disconnected).
  - During 10s recording: ~2% CPU sampling overhead. The simulation continues smoothly.
- **Privacy & Security**: Strictly Owner-only. V8 profiles record script locations and function names, never network payload secrets.

#### When
- Built as PR 2.
- Switched on demand by the Owner.

#### Tests
- `packages/server/test/cpu-profiler.test.ts`:
  - Run inspector session for 200 ms during active CPU work; verify generated JSON contains valid V8 `nodes`, `samples`, and `timeDeltas`.
  - Verify heap snapshot generation produces valid JSON stream.
  - Verify file retention limit (max 5) and auto-deletion work.
- `packages/server/test/region-servers.test.ts`:
  - Test remote profile command over Redis bus and file retrieval.

#### Words
- "Record CPU profile (10 s)"
- "Recording in progress... 7 s left"
- "Profile ready. Download will begin shortly."
- "Take heap snapshot"
- "A profile is already being recorded."

---

### Tool 4: Live Entity Inspector

#### Why
- **Problem**: The Callings system introduces sophisticated mechanics: threat tables with 10% switching thresholds, taunt forced-targeting, 15+ status effects with varying durations and shield values, signature gauges (Momentum, Weave threads, Resolve, Echoes), and creature behavior states. When an entity behaves unexpectedly, Stewards cannot currently inspect its runtime state without server log restarts.
- **Scenario**: In the Sanctum, an Enraged Minotaur switches from a Warden to a Wishweaver. The Warden insists they used Challenge (taunt). The Steward clicks "Inspect" on the Minotaur in God's View:
  - Aggro: `player-wishweaver`
  - Threat table: `player-wishweaver: 520`, `player-warden: 480`
  - Taunt status: Expired 0.5 s ago
  - Switch threshold needed: 528 (520 * 1.1)
  The Steward sees immediately that the taunt expired and the Warden lacked the threat required to hold aggro.

#### What
- Real-time streaming inspector for any player or creature:
  - **Core stats**: ID, name, calling/kind, position (x, y, floor), HP/max HP, Energy/max Energy, alive status.
  - **Threat list** (`threat.ts`): All threatening players, their threat points, current target, taunter, and the 10% switch threshold.
  - **Statuses** (`statuses.ts`): Active statuses, duration remaining, creator (`by`), and magnitude/shield points.
  - **Signature gauge** (`gauges.ts`): Current pips, max pips, Weave thread counts, and active stance.
  - **Brain state** (`creature-brain.ts`): Behavior state (`guard`, `wander`, `chase`, `flee`, `sleep`), leash origin, pace, and time since last attack.
  - **Ability Cooldowns** (`readyAt`): Cooldown timers by ability ID.
- **Data Shapes**:
  ```ts
  export interface EntityInspection {
    id: string;
    kind: 'player' | 'creature';
    name: string;
    x: number;
    y: number;
    floor: number;
    hp: number;
    maxHp: number;
    energy: number;
    maxEnergy: number;
    alive: boolean;
    targetId: string | null;
    statuses: {
      id: string;
      secondsLeft: number;
      by?: string;
      amount?: number;
    }[];
    threat?: {
      targetId: string | null;
      tauntedBy: string | null;
      switchThreshold: number;
      entries: { playerId: string; playerName: string; amount: number; isTarget: boolean }[];
    };
    gauge?: {
      calling: string;
      pips: number;
      max: number;
      threads?: { ember: number; tide: number; gale: number };
      woven?: boolean;
    };
    brain?: {
      state: string;
      leashX: number;
      leashY: number;
      pace: number;
      lastAttackSecondsAgo: number;
    };
    cooldowns: { ability: string; name: string; secondsLeft: number }[];
  }
  ```
- **Who Can Use It**: Stewards and Owner in God's View.
- **UI**:
  - In God's View Overview tab: Clickable "Inspect" button next to any player or creature.
  - Opens a dedicated live inspector modal/sidebar with:
    - Real-time animated health and energy bars.
    - Threat table showing threat shares and switch threshold.
    - Active status tags with countdown timers.
    - Gauge display with visual pips.
    - "Stop watching" button (stream also terminates on tab close).

#### Where
- `packages/shared/src/debug.ts`: `EntityInspection` type definition.
- `packages/server/src/region/inspect.ts`: State extraction submodule (`inspectEntity(region, kind, id)`).
- `packages/server/src/region.ts`: Thin hook `inspect(kind, id): EntityInspection | undefined`.
- `packages/server/src/region-link.ts`: Bus messages:
  - `ToServer: { t: 'watch-entity', region: string, kind: string, id: string, watch: boolean }`
  - `ToGateway: { t: 'entity-inspection', data: EntityInspection }`
- `packages/server/src/admin.ts`: Route `GET /api/admin/inspect/:region/:kind/:id` (Server-Sent Events / short polling).
- `packages/client/src/gods-view/inspector.ts`: Inspector UI view.

#### How
- **Zero Cost When Idle**:
  Entities maintain their state as usual. No extra objects are allocated unless an entity ID is registered in `activeWatchers`.
- **When Active**:
  When watched, `inspectEntity` extracts plain values once per tick (throttled to 10 Hz) and pushes updates to the client.
  If hosted on a region server: The region server sends updates across Redis bus only while the gateway has an active subscriber.
- **Privacy & Security**: Stewards and Owner only. Inspects combat and mechanical state only. Does NOT reveal player chat or account credentials.

#### When
- Built in PR 3 (paired with Tool 5).
- Active only while open in God's View.

#### Tests
- `packages/server/test/inspect.test.ts`:
  - Inspect player: Verify status durations, gauge pips, and ability cooldowns match reality.
  - Inspect creature: Verify threat table and switch threshold match `SWITCH_AT = 1.1`.
  - Verify unwatching stops all streaming and cleans up listener maps.
- Remote test in `packages/server/test/region-servers.test.ts`:
  - Inspect entity hosted on a region server over Redis bus.

#### Words
- "Watching <Name>"
- "Threat list: <Player> holds attention"
- "Needs 10% more threat to turn"
- "Taunted for 2.4 s"
- "Status: Guarded (3 s left)"

---

### Tool 5: Combat Log

#### Why
- **Problem**: Damage calculations combine base ability power, attribute scaling, random variance (0.9 to 1.1), critical strike rolls, dodge rolls, Weakened reductions (0.5x), Mark bonuses (+25%), Armor (physical) and Ward (arcane) reductions, Pierce, shield absorption, and threat multipliers. When balance questions or combat disputes arise, developers need a transparent mathematical breakdown.
- **Scenario**: During balance testing for Callings step 11, a level 10 Duelist's Riposte deals less damage than expected against a Desert Raider. The Combat Log shows:
  - Base: 30, Power scaling: 1.4x, Variance: 0.92
  - Target Armor: 24 (Physical reduction: 45%)
  - Shield absorb: 0
  - Final damage: 17
  The exact damage breakdown confirms the reduction is due to the Raider's Armor rating, verifying the formula.

#### What
- Captures a structured receipt of every attack, ability hit, and status damage tick:
  - Attacker, target, ability/action name.
  - Damage type (physical vs arcane) and pierce flag.
  - Attribute scaling, base power, variance roll.
  - Crit roll & multiplier, dodge roll, stagger roll, shield block roll.
  - Armor/Ward mitigation and shield absorption.
  - Final damage, defeat status, and threat delta.
- Can be activated for a specific region, a specific entity, or during automated test runs.
- Viewable in God's View and downloadable as JSON.
- **Data Shapes**:
  ```ts
  export interface CombatHitTrace {
    id: string;
    at: number;
    tick: number;
    region: string;
    attacker: { id: string; name: string; kind: 'player' | 'creature'; calling?: string };
    target: { id: string; name: string; kind: 'player' | 'creature' };
    action: { id: string; name: string; kind: 'attack' | 'ability' | 'status' };
    damageType: 'physical' | 'arcane';
    pierce: boolean;
    rolls: {
      variance: number;
      dodge?: { chance: number; rolled: number; dodged: boolean };
      crit?: { chance: number; rolled: number; crit: boolean; multiplier: number };
      stagger?: { chance: number; rolled: number; staggered: boolean };
      block?: { chance: number; rolled: number; blocked: boolean; amount: number };
    };
    factors: {
      base: number;
      power: number;
      raw: number;
      weakenedFactor?: number;
      markedFactor?: number;
      wovenFactor?: number;
      gaugeFactor?: number;
    };
    mitigation: {
      shieldAbsorb: number;
      defenseStat: number; // armor or ward
      afterDefense: number;
    };
    finalAmount: number;
    defeated: boolean;
    threat?: {
      added: number;
      newTotal: number;
    };
  }
  ```
- **Who Can Use It**: Stewards and Owner in God's View. Automated tests via `CombatLogger` harness.
- **UI**:
  - In God's View: A "Combat log" tab/panel.
  - Region / entity selector and "Record combat log (max 500 events)" toggle.
  - Color-coded log table (physical vs arcane damage, gold for crits, grey for dodges/blocks).
  - Search filter by character name.
  - "Download JSON" button.

#### Where
- `packages/shared/src/combat-log.ts`: `CombatHitTrace` interface and formatting helpers.
- `packages/server/src/region/combat-logger.ts`: Ring-buffer combat recorder (`CombatLogger`).
- `packages/server/src/region/combat.ts`: Thin hook in `strike()` and `useAbility()`.
- `packages/server/src/region/minds.ts`: Thin hook in `hurt()`.
- `packages/server/src/admin.ts`: Endpoints:
  - `GET /api/admin/combat-log`: Retrieve recent events.
  - `POST /api/admin/combat-log/toggle`: Enable/disable logging.
  - `GET /api/admin/combat-log/export`: Download JSON.
- `packages/client/src/gods-view/combat-log.ts`: God's View UI tab.

#### How
- **Zero Cost When Idle**:
  When logging is inactive (default), the hook is a single null check: `if (!this.logger?.active) return;` (~0 ns).
- **When Active**:
  Stores events in an in-memory ring buffer of 500 entries (~250 KB max). Automatically evicts oldest entries.
- **Support for Callings Step 11 Balance Test**:
  The automated balance test (`packages/shared/test/balance.test.ts`) can attach a `CombatLogger` to capture and assert on exact DPS, mitigation, and crit rates directly.

#### When
- Built in PR 3 (paired with Tool 4).
- Switched on by Steward/Owner or enabled in test suites.

#### Tests
- `packages/server/test/combat-log.test.ts`:
  - Physical attack: Verify variance, Armor mitigation, damage, and threat addition.
  - Arcane ability (Firebolt): Verify Ward mitigation.
  - Critical hits and dodges: Verify roll entries and multipliers.
  - Ring buffer capacity (500) and JSON export format.
- Balance test integration test verifying DPS measurement.

#### Words
- "Combat log"
- "Recording combat in Sanctum..."
- "Hit: <Attacker> dealt <Damage> <type> damage to <Target>"
- "Critical hit!"
- "Blow absorbed by shield"
- "Download combat records (JSON)"

---

### Tool 6: Headless Record and Replay

#### Why
- **Problem**: Simulation bugs involving race conditions, multi-cell handoffs, threat transitions, or status expiration under specific input sequences are difficult to reproduce manually. Developers need the ability to record the exact inputs and replay them tick-by-tick headlessly in a Node test or CLI debugger.
- **Scenario**: A player encounters an unhandled exception in Shore-cell-1 when dodging across a cell boundary while taking burn damage. The Owner records a 30-second trace. The developer runs `npx tsx packages/server/src/tools/replay.ts trace.json` in VS Code. The simulation replays tick-by-tick, hitting breakpoints and deterministically reproducing the bug in 0.5 seconds.

#### What
- **Recording**:
  - Initial region state: Region definition, players, creatures, bodies, NPCs, and initial sky time.
  - Starting random seed and clock epoch ms.
  - Stream of per-tick inputs: `{ tick, clock, inputs: { playerId, message }[] }`.
- **Headless Replayer**:
  - CLI runner in `packages/server/src/tools/replay.ts`.
  - Replays the trace headlessly in a bare `Region` with injected seed and clock, verifying snapshot hashes or stopping on error.
  - Flags: `--tick <N>` (run up to tick N), `--step` (interactive single-step), `--verify` (validate snapshots).
- **Dev-Only Pause & Step Controls**:
  - In local development mode (`NODE_ENV !== 'production'`):
    - Admin endpoints `/api/admin/dev/pause`, `/api/admin/dev/step`, `/api/admin/dev/resume`.
- **Data Shapes**:
  ```ts
  export interface ReplayHeader {
    version: 1;
    regionId: string;
    regionDef: RegionDef;
    recordedAt: number;
    seed: number;
    startClock: number;
    initialState: {
      players: PlayerStateSnapshot[];
      creatures: CreatureStateSnapshot[];
      bodies: Body[];
      townsfolk: Townsperson[];
    };
  }

  export interface ReplayTickEvent {
    tick: number;
    clock: number;
    inputs: {
      playerId: string;
      message: ClientMessage;
    }[];
    departures?: Departure[];
    snapshotHash?: string;
  }

  export interface ReplayTrace {
    header: ReplayHeader;
    ticks: ReplayTickEvent[];
  }
  ```
- **Who Can Use It**: Owner only in God's View, and developers via CLI and Vitest.
- **UI**:
  - In God's View `Server health` or `Overview`:
    - Button: "Record region replay (30 s)".
    - On finish: Prompts download of `<region>-<timestamp>.replay.json`.

#### Where
- `packages/shared/src/replay.ts`: `ReplayTrace`, `ReplayHeader`, `ReplayTickEvent` definitions.
- `packages/server/src/debug/region-recorder.ts`: Region recording manager.
- `packages/server/src/debug/prng.ts`: Mulberry32 seeded pseudo-random number generator.
- `packages/server/src/tools/replay.ts`: Standalone CLI replay runner.
- `packages/server/src/admin.ts`: Replay recording endpoints and dev-only pause/step hooks.
- `packages/client/src/gods-view/servers.ts`: Replay recording UI button.

#### How
- **Determinism Audit**:
  - `Math.random`: Our audit verified that `Region.ts` and all its subsystems (`combat.ts`, `minds.ts`, `creature-brain.ts`, `townsfolk.ts`, `walkers.ts`, `statuses.ts`, `gauges.ts`) already exclusively use the injected `this.random()` function passed from constructor! Zero direct calls to `Math.random` exist in the simulation loop.
  - `Date.now`: The simulation in `Region.ts` exclusively uses `this.now()` passed via constructor. Zero direct calls to `Date.now` exist in `packages/server/src/region/`.
  - QuickJS Sandbox: Rules sandbox already receives injected `random` and `now` (`rules.ts`).
  - Iteration order: In JavaScript, `Map` retains insertion order. To guarantee bit-exact determinism across platforms, entity loops sort by ID where insertion order could vary.
- **Cost**:
  - Idle: 0 (recorder inactive).
  - Recording: Appends input messages to an in-memory buffer (~5–10 KB/s; ~200 KB for 30 seconds).
  - Replayer: Replays 600 ticks (30s game time) in under 200 ms.
- **Privacy & Security**: Player movement and skill inputs are recorded; private chat messages (`say`, `region`, `world`) are stripped before writing the trace.

#### When
- Built as PR 4.
- Depends on the clean seed and clock injection already present in `World` and `Region`.

#### Tests
- `packages/server/test/replay.test.ts`:
  - Run a 100-tick battle with 2 players and 3 creatures using a seeded PRNG.
  - Record the trace and replay it in a fresh `Region` instance with the same seed.
  - Assert that all final HP, positions, creature states, and threat tables match identically down to the floating-point bit.
- CLI verification: `tsx packages/server/src/tools/replay.ts` on a sample trace file exits with code 0.

#### Words
- "Record region replay (30 s)"
- "Recording in progress... 18 s remaining"
- "Replay saved. Download will begin shortly."
- Dev mode only: "Simulation paused", "Step one tick", "Resume simulation"

---

## 3. Pull Request Breakdown

Each PR is kept small, self-contained, fully tested, and leaves the game functioning smoothly.

```
┌────────────────────────────────────────┐
│ PR 1: Tick Profiler & Slow-Tick Capture │
│ (Tools 1 & 2: Loop Timings & History)   │
└──────────────────┬─────────────────────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
┌──────────────────┐  ┌───────────────────────────────┐
│ PR 2: On-Demand  │  │ PR 3: Live Entity Inspector   │
│ CPU Profiler     │  │ & Combat Log                  │
│ (Tool 3)         │  │ (Tools 4 & 5: Combat & State) │
└────────┬─────────┘  └───────────────┬───────────────┘
         │                            │
         └─────────┬──────────────────┘
                   ▼
┌────────────────────────────────────────┐
│ PR 4: Headless Record & Replay         │
│ (Tool 6: CLI & Deterministic Replayer) │
└────────────────────────────────────────┘
```

1. **PR 1: Tick Profiler with per-phase timings & Slow-tick capture** (Tools 1 & 2)
   - *Why together*: Both touch the tick loop, `LoadMeter`, `ServerLoad`, and the `Server health` tab. Combining them avoids refactoring `ServerLoad` twice.
   - *Files*: `packages/shared/src/profiler.ts`, `packages/server/src/region/profiler.ts`, `packages/server/src/debug/slow-tick-buffer.ts`, `packages/server/src/region.ts`, `packages/server/src/load-meter.ts`, `packages/server/src/region-link.ts`, `packages/client/src/gods-view/servers.ts`.
   - *Tests*: `profiler.test.ts`, `slow-ticks.test.ts`.

2. **PR 2: CPU profile on demand & heap snapshots** (Tool 3)
   - *Can run in parallel with PR 3*: PR 2 touches `node:inspector` and host management routes; PR 3 touches entity inspection. They are completely orthogonal.
   - *Files*: `packages/server/src/debug/profiler-session.ts`, `packages/server/src/region-link.ts`, `packages/server/src/region-server.ts`, `packages/server/src/admin.ts`, `packages/client/src/gods-view/servers.ts`.
   - *Tests*: `cpu-profiler.test.ts`.

3. **PR 3: Live entity inspector & Combat log** (Tools 4 & 5)
   - *Why together*: Both inspect live Callings combat state (threat, statuses, gauges, damage scaling, abilities). They share common debug types and God's View inspection components.
   - *Files*: `packages/shared/src/debug.ts`, `packages/shared/src/combat-log.ts`, `packages/server/src/region/inspect.ts`, `packages/server/src/region/combat-logger.ts`, `packages/server/src/region/combat.ts`, `packages/server/src/region/minds.ts`, `packages/server/src/admin.ts`, `packages/client/src/gods-view/inspector.ts`, `packages/client/src/gods-view/combat-log.ts`.
   - *Tests*: `inspect.test.ts`, `combat-log.test.ts`.

4. **PR 4: Headless record and replay** (Tool 6)
   - *Files*: `packages/shared/src/replay.ts`, `packages/server/src/debug/region-recorder.ts`, `packages/server/src/debug/prng.ts`, `packages/server/src/tools/replay.ts`, `packages/server/src/admin.ts`, `packages/client/src/gods-view/servers.ts`.
   - *Tests*: `replay.test.ts`.

---

## 4. Decisions on Open Questions (Approved by egoforia)

1. **Inspector & Combat Log Permissions**:
   - **Decision**: The Live Entity Inspector and Combat Log are accessible to both **Stewards and the Owner**. CPU Profiler, Heap Snapshots, and Replay Recording remain strictly Owner-only.
2. **CPU Profile & Heap Snapshot Storage & Retention**:
   - **Decision**: Profiles are stored in `data/profiles/` with a default retention cap of 5 files and 1-hour auto-prune.
   - **Environment Variables**: Controllable via `PROFILE_DIR`, `PROFILE_MAX_FILES`, and `PROFILE_PRUNE_HOURS`.
   - **UI Exposure**: The active retention values are explicitly surfaced on the God's View Server Health HUD so the Owner can see the active retention limits at a glance.
3. **Combat Log in Production**:
   - **Decision**: **Disabled by default** in production (0 CPU/memory overhead). Can be temporarily toggled on by an Owner or Steward for a specific region (capped at 500 events or 5 minutes), or attached programmatically during test suites.
4. **Dev-Only Pause & Step**:
   - **Decision**: Strictly restricted to non-production environments (`NODE_ENV !== 'production'`) behind a development configuration guard. Never exposed in production.
5. **Slow Tick Threshold**:
   - **Decision**: Default to 50 ms (`TICK_SECONDS * 1000`, the 1-tick budget at 20 ticks/sec), with a setting in God's View if fine-tuning is needed.

---

## 5. Documentation Updates

1. `docs/architecture.md`:
   - Document new debug submodules (`packages/server/src/region/profiler.ts`, `packages/server/src/debug/*`).
   - Document `TickProfiler` and `CombatLogger` contracts and the headless `tools/replay.ts` utility.
2. `docs/scale.md`:
   - Document the enhanced Server Health tab in God's View: per-phase tick breakdowns, recent slow tick captures, on-demand CPU profiling across region servers, and heap snapshots.
3. `docs/playtest.md`:
   - Explain how robot playtests and automated tests can leverage `CombatLogger` and `ReplayTrace` for combat regression testing and balance assertions.

---

## 6. Verification & Rules Adherence Check

- **Dependency Rule**: Zero new npm dependencies. All profiling and time utilities leverage built-in Node modules (`node:inspector`, `node:perf_hooks`, `performance.now()`).
- **File Size Rule**: All new files are small, modular submodules (< 400 lines). `region.ts` (~800 lines) receives only thin delegation hooks.
- **Player Words Rule**: Plain, friendly words for all UI labels, table headers, and toasts (no jargon, error codes, or technical stack traces).
- **Core Changes Rule**: Normal branch `game-loop-debug-tools`, PR against `main`. All PRs maintain `npm run typecheck` and `npm test` passing.
- **Stop Condition**: No code changes will be made until egoforia reviews and approves this plan.
