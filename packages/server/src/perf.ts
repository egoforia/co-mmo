import { TICK_RATE, type PerfView } from '@co-mmo/shared';
import type { HostStatus } from './region-servers.ts';
import type { World } from './world.ts';

/**
 * The server's side of the performance overlay for one player: how the
 * server that runs their part of the world keeps up. Machine names and
 * process ids stay in the Owner's Server health tab.
 */
export function perfView(world: World, playerId: string, hosts: HostStatus[]): PerfView {
  const region = world.regionOf(playerId);
  // A split region runs in parts, each maybe on its own server: the part you stand in is the one that matters.
  const unit = region?.cells?.find((c) => c.has(playerId)) ?? region;
  const host = unit && hosts.find((h) => h.regions.some((r) => r.id === unit.key));
  const row = host?.regions.find((r) => r.id === unit?.key);
  const view: PerfView = { online: hosts.reduce((n, h) => n + h.players, 0), servers: hosts.length, tickRate: TICK_RATE };
  if (!host || !row) return view;
  const l = host.load;
  return {
    ...view,
    here: {
      region: row.name,
      ...(row.parts ? { part: row.part, parts: row.parts } : {}),
      players: row.players,
      creatures: row.creatures,
      server: host.kind === 'gateway' ? 'Game server' : `Region server ${host.id}`,
      tickMs: l.tickMs, worstTickMs: l.worstTickMs, ticksPerSecond: l.ticksPerSecond,
      lagMs: l.lagMs, worstLagMs: l.worstLagMs, memoryMb: l.memoryMb, heapMb: l.heapMb,
    },
  };
}
