// The Server health tab: each server's regions, players, tick time, memory,
// phase breakdown, and recent slow ticks, with restart and move.

import { escapeHtml } from '../ui.ts';
import { PHASE_LABELS, TICK_RATE, TICK_SECONDS, type PhaseTimings, type SlowTickRecord } from '@co-mmo/shared';
import { api, toast, type Handled, type Tab } from './core.ts';

interface ServerLoad {
  tickMs: number;
  worstTickMs: number;
  ticksPerSecond: number;
  lagMs: number;
  worstLagMs: number;
  memoryMb: number;
  heapMb: number;
  errors: number;
  lastError?: string;
  host: string;
  pid: number;
  startedAt: number;
  phases?: PhaseTimings;
  slowestRegion?: {
    id: string;
    phase: string;
    ms: number;
  };
}

interface Host {
  id: string;
  kind: 'gateway' | 'region-server';
  /** Whole regions, or cells of a crowded region split into parts. */
  regions: { id: string; region: string; name: string; players: number; creatures: number; part?: number; parts?: number }[];
  players: number;
  load: ServerLoad;
  seen: number;
}

/** Distinct colors for tick phase breakdown bars and legends. */
const PHASE_COLORS: Record<string, string> = {
  inputs: '#4dabf7',
  sky: '#74c0fc',
  combat: '#ff6b6b',
  minds_think: '#da77f2',
  bodies: '#ffd43b',
  minds_live: '#69db7c',
  fallen: '#adb5bd',
  snapshots: '#ffa94d',
  rules: '#38d9a9',
};

/** A tick has this long before the next one is due. */
const TICK_MS = TICK_SECONDS * 1000;

const since = (ms: number) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);

async function servers(): Promise<string> {
  const s = await api<{ hosts: Host[]; regionServers: boolean; store: string; now: number; slowTicks?: SlowTickRecord[] }>('servers');
  const hostName = (h: Host) => (h.kind === 'gateway' ? 'Game server' : `Region server ${escapeHtml(h.id)}`);

  const phaseBarAndTable = (phases?: PhaseTimings) => {
    if (!phases) return '';
    const entries = Object.entries(phases).filter(([_, t]) => t.avgMs > 0 || t.worstMs > 0);
    if (!entries.length) return '';
    const totalAvg = entries.reduce((sum, [_, t]) => sum + t.avgMs, 0);

    const segments = entries.map(([phase, t]) => {
      const pct = totalAvg > 0 ? (t.avgMs / totalAvg) * 100 : 0;
      const label = PHASE_LABELS[phase] ?? phase;
      const color = PHASE_COLORS[phase] ?? '#ced4da';
      return `<div class="phase-segment" style="width: ${pct.toFixed(1)}%; background: ${color};" title="${escapeHtml(label)}: ${t.avgMs.toFixed(1)} ms (${pct.toFixed(0)}%)"></div>`;
    }).join('');

    const rows = entries.map(([phase, t]) => {
      const pct = totalAvg > 0 ? (t.avgMs / totalAvg) * 100 : 0;
      const label = PHASE_LABELS[phase] ?? phase;
      const color = PHASE_COLORS[phase] ?? '#ced4da';
      return `<tr>
        <td><span class="phase-dot" style="background: ${color}"></span><b>${escapeHtml(label)}</b></td>
        <td>${t.avgMs.toFixed(1)} ms</td>
        <td>${t.worstMs.toFixed(1)} ms</td>
        <td>${pct.toFixed(0)}%</td>
      </tr>`;
    }).join('');

    return `
      <div class="phase-breakdown">
        <h4>Tick phases</h4>
        <div class="phase-bar">${segments}</div>
        <table class="log phase-table">
          <thead><tr><th>Phase</th><th>Average</th><th>Slowest</th><th>Share</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  const card = (h: Host) => {
    const l = h.load;
    // Half a tick is fine; a whole tick means players feel it.
    const busy = l.worstTickMs >= TICK_MS ? 'bad' : l.tickMs >= TICK_MS / 2 ? 'warn' : '';
    // Fewer ticks than the rate means the world runs slow for everyone there.
    const behind = l.ticksPerSecond && l.ticksPerSecond < TICK_RATE * 0.9 ? 'bad' : '';
    // A busy event loop holds up ticks, messages and God's View alike.
    const waiting = l.worstLagMs >= TICK_MS ? 'warn' : '';
    const quiet = s.now - h.seen;
    const moveTo = () => s.hosts.filter((o) => o.id !== h.id).map((o) => `<option value="${escapeHtml(o.id)}">${o.kind === 'gateway' ? 'Game server' : escapeHtml(o.id)}</option>`).join('');
    const rows = h.regions.map((r) => `<tr><td><b>${escapeHtml(r.name)}</b>${r.parts ? ` <small>part ${r.part} of ${r.parts}</small>` : ''}</td><td>${r.players} here, ${r.creatures} creature${r.creatures === 1 ? '' : 's'}</td><td class="actions">
        <button type="button" data-region-restart="${escapeHtml(r.region)}" data-players="${r.players}">Restart${r.parts ? ' all parts' : ''}</button>
        ${s.hosts.length > 1 && !r.parts ? `<select data-move-for="${escapeHtml(r.id)}" aria-label="Move ${escapeHtml(r.name)} to">${moveTo()}</select><button type="button" data-region-move="${escapeHtml(r.id)}" data-players="${r.players}">Move</button>` : ''}
      </td></tr>`).join('');

    const slowestNote = l.slowestRegion
      ? `<p class="note">Slowest region: <b>${escapeHtml(l.slowestRegion.id)}</b> (${escapeHtml(PHASE_LABELS[l.slowestRegion.phase] ?? l.slowestRegion.phase)}: ${l.slowestRegion.ms.toFixed(1)} ms)</p>`
      : '';

    return `<div class="host">
      <h3>${hostName(h)}</h3>
      <div class="stats">
        <div class="stat ${busy}"><b>${l.tickMs.toFixed(1)} ms</b><span>a tick on average (slowest ${l.worstTickMs.toFixed(1)} ms of ${TICK_MS} ms)</span></div>
        <div class="stat"><b>${h.players}</b><span>player${h.players === 1 ? '' : 's'} in ${h.regions.length} region${h.regions.length === 1 ? '' : 's'}</span></div>
        <div class="stat ${behind}"><b>${l.ticksPerSecond.toFixed(0)}</b><span>ticks a second (of ${TICK_RATE})</span></div>
        <div class="stat ${waiting}"><b>${l.lagMs.toFixed(1)} ms</b><span>waiting to run (worst ${l.worstLagMs.toFixed(0)} ms)</span></div>
        <div class="stat"><b>${l.memoryMb} MB</b><span>memory (${l.heapMb} MB of it data)</span></div>
        <div class="stat ${l.errors ? 'warn' : ''}"><b>${l.errors}</b><span>error${l.errors === 1 ? '' : 's'} since it started</span></div>
      </div>
      ${l.lastError ? `<p class="note warn">Last error: ${escapeHtml(l.lastError)}</p>` : ''}
      <p class="note">On ${escapeHtml(l.host)} (process ${l.pid}), running for ${since(s.now - l.startedAt)}${h.kind === 'region-server' ? `, last heard from ${since(quiet)} ago` : ''}.</p>
      ${slowestNote}
      ${phaseBarAndTable(l.phases)}
      ${rows ? `<table class="log">${rows}</table>` : '<p class="note">No regions run here right now.</p>'}
    </div>`;
  };

  const slowTicksSection = () => {
    const list = s.slowTicks ?? [];
    if (!list.length) {
      return `<details class="slow-ticks">
        <summary><b>Recent slow ticks</b></summary>
        <p class="note">No slow ticks recorded recently.</p>
      </details>`;
    }

    const rows = list.map((t) => {
      const phaseEntries = Object.entries(t.phases);
      const totalPhases = phaseEntries.reduce((sum, [_, ms]) => sum + ms, 0);
      const slowest = [...phaseEntries].sort((a, b) => b[1] - a[1])[0];
      const slowestDesc = slowest ? `${escapeHtml(PHASE_LABELS[slowest[0]] ?? slowest[0])} (${slowest[1].toFixed(1)} ms)` : 'None';
      const serverLabel = t.host === 'gateway' ? 'Game server' : escapeHtml(t.host);
      const landLabel = `${escapeHtml(t.region)}${t.cell ? ` <small>part ${t.cell.index + 1} of ${t.cell.count}</small>` : ''}`;

      const segments = phaseEntries.map(([phase, ms]) => {
        const pct = totalPhases > 0 ? (ms / totalPhases) * 100 : 0;
        const color = PHASE_COLORS[phase] ?? '#ced4da';
        const label = PHASE_LABELS[phase] ?? phase;
        return `<div class="phase-segment" style="width: ${pct.toFixed(1)}%; background: ${color};" title="${escapeHtml(label)}: ${ms.toFixed(1)} ms"></div>`;
      }).join('');

      const phaseDetails = phaseEntries.map(([phase, ms]) => {
        const label = PHASE_LABELS[phase] ?? phase;
        const color = PHASE_COLORS[phase] ?? '#ced4da';
        return `<span><span class="phase-dot" style="background: ${color}"></span>${escapeHtml(label)}: <b>${ms.toFixed(1)} ms</b></span>`;
      }).join(' &nbsp; ');

      return `
        <tr>
          <td>${since(s.now - t.at)} ago</td>
          <td>${serverLabel}</td>
          <td>${landLabel}</td>
          <td>${t.players} player${t.players === 1 ? '' : 's'}, ${t.creatures} creature${t.creatures === 1 ? '' : 's'}</td>
          <td>${t.activeStatuses} active</td>
          <td>${slowestDesc}</td>
          <td class="bad"><b>${t.totalMs.toFixed(1)} ms</b></td>
          <td class="actions">
            <button type="button" data-toggle-slow-tick="${t.id}">Breakdown</button>
          </td>
        </tr>
        <tr id="slow-tick-detail-${t.id}" class="slow-tick-detail" style="display: none;">
          <td colspan="8">
            <div class="phase-bar">${segments}</div>
            <div class="slow-tick-phases">${phaseDetails}</div>
            ${t.error ? `<p class="note warn">Caught error: ${escapeHtml(t.error)}</p>` : ''}
          </td>
        </tr>`;
    }).join('');

    return `
      <details class="slow-ticks" open>
        <summary><b>Recent slow ticks</b> <small>(${list.length})</small></summary>
        <p class="note">Ticks that ran over 50 ms budget recently.
          <button type="button" data-clear-slow-ticks="true">Clear slow ticks</button>
        </p>
        <table class="log slow-ticks-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Server</th>
              <th>Land</th>
              <th>Entities</th>
              <th>Statuses</th>
              <th>Slowest phase</th>
              <th>Total time</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
  };

  const how = s.regionServers
    ? s.hosts.length > 1
      ? 'Regions run on the region servers below. If one stops, its regions come back to the game server within a few seconds, with their players.'
      : 'No region server is running, so every region runs in the game server. Start some with <code>npm run region-server</code> (or <code>REGION_SERVERS</code> with <code>npm run dev</code>).'
    : 'Every region runs in the game server. Set <code>REDIS_URL</code> to let region servers share the work (see docs/scale.md).';

  return `
    <p>${how} The world is kept in ${escapeHtml(s.store)}.</p>
    ${s.hosts.map(card).join('')}
    ${slowTicksSection()}
    <p class="note">Restarting a region sets it up again from scratch: creatures respawn, and players inside stay where they stood. Moving a region does the same on another server.
      A region with more than 50 players splits into parts side by side, up to four, spread over the servers; players walk between parts without noticing, and it joins up again once it has been quieter for half a minute.</p>`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.clearSlowTicks) {
    t.disabled = true;
    await api('servers/slow-ticks/clear', 'POST');
    toast('Cleared slow ticks.');
    return true;
  }
  if (t.dataset.toggleSlowTick) {
    const detail = document.getElementById(`slow-tick-detail-${t.dataset.toggleSlowTick}`);
    if (detail) {
      detail.style.display = detail.style.display === 'none' ? '' : 'none';
    }
    return 'keep';
  }
  if (!t.dataset.regionRestart && !t.dataset.regionMove) return false;
  const region = (t.dataset.regionRestart ?? t.dataset.regionMove)!;
  const to = t.dataset.regionMove ? document.querySelector<HTMLSelectElement>(`select[data-move-for="${CSS.escape(region)}"]`)?.value : undefined;
  const players = Number(t.dataset.players);
  if (players && !confirm(`${players} player${players === 1 ? ' is' : 's are'} in this region. They stay where they stand but may notice a short pause. Go ahead?`)) return 'keep';
  t.disabled = true;
  const r = await api<{ message: string }>('servers/move', 'POST', { region, ...(to ? { to } : {}) });
  toast(r.message);
  return true;
}

export const serversTab: Tab = { id: 'servers', label: 'Server health', ownerOnly: true, page: servers, click, refreshMs: 3000 };
