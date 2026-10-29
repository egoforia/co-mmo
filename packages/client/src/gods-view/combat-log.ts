// Combat Log (Tool 5): structured receipts of every hit, ability strike, and roll.
// Accessible to Stewards and Owner.

import { escapeHtml } from '../ui.ts';
import { api, toast, type Tab } from './core.ts';
import type { CombatHitTrace } from '@co-mmo/shared';

interface CombatLogResponse {
  events: CombatHitTrace[];
  status: {
    active: boolean;
    count: number;
    capacity: number;
    region?: string;
    entity?: string;
    secondsLeft?: number;
  };
}

let filterName = '';
let filterRegion = '';
let cachedResponse: CombatLogResponse | null = null;

async function combatLogPage(): Promise<string> {
  try {
    const params = new URLSearchParams();
    if (filterRegion) params.set('region', filterRegion);
    const query = params.toString() ? `?${params.toString()}` : '';
    cachedResponse = await api<CombatLogResponse>(`combat-log${query}`);
  } catch (err) {
    return `<div class="combat-log-pane"><p class="bad">Could not load combat log: ${escapeHtml((err as Error).message)}</p></div>`;
  }

  const { events, status } = cachedResponse;
  const filtered = filterName
    ? events.filter(
        (e) =>
          e.attacker.name.toLowerCase().includes(filterName.toLowerCase()) ||
          e.target.name.toLowerCase().includes(filterName.toLowerCase()) ||
          e.action.name.toLowerCase().includes(filterName.toLowerCase()),
      )
    : events;

  const statusBadge = status.active
    ? `<span class="badge good">Recording (${status.count}/${status.capacity} events${status.secondsLeft !== undefined ? ` · ${status.secondsLeft}s left` : ''})</span>`
    : '<span class="badge muted">Recording disabled</span>';

  const rows = filtered
    .slice()
    .reverse()
    .map((e) => {
      const timeStr = new Date(e.at).toLocaleTimeString();
      const isCrit = e.rolls.crit?.crit;
      const isDodged = e.rolls.dodge?.dodged;
      const isBlocked = e.rolls.block?.blocked;

      let resultHtml = '';
      if (isDodged) {
        resultHtml = '<span class="tag dodged">Dodged</span>';
      } else {
        const typeClass = e.damageType === 'arcane' ? 'damage-arcane' : 'damage-physical';
        resultHtml = `<b class="${typeClass}">${e.finalAmount}</b> <small>${e.damageType}</small>`;
        if (isCrit) resultHtml += ' <span class="tag crit">Crit!</span>';
        if (isBlocked) resultHtml += ` <span class="tag blocked">Blocked ${e.rolls.block?.amount}</span>`;
      }

      if (e.defeated) {
        resultHtml += ' <span class="tag defeat">Defeated!</span>';
      }

      // Breakdown factors
      const factors: string[] = [];
      if (e.factors.base !== undefined) factors.push(`Base: ${Math.round(e.factors.base * 10) / 10}`);
      if (e.rolls.variance) factors.push(`Var: ${Math.round(e.rolls.variance * 100) / 100}x`);
      if (e.mitigation.defenseStat) factors.push(`Def: -${e.mitigation.defenseStat}`);
      if (e.mitigation.shieldAbsorb) factors.push(`Shield: -${e.mitigation.shieldAbsorb}`);
      if (e.threat?.added) factors.push(`+${Math.round(e.threat.added)} threat`);
      const breakdown = factors.length ? `<div class="log-breakdown">${factors.join(' · ')}</div>` : '';

      const attackerCalling = e.attacker.calling ? ` <small class="calling-tag">${escapeHtml(e.attacker.calling)}</small>` : '';

      return `
        <tr class="log-row ${isCrit ? 'crit-row' : ''} ${isDodged ? 'dodged-row' : ''}">
          <td class="log-time">${timeStr}</td>
          <td><b>${escapeHtml(e.attacker.name)}</b>${attackerCalling}</td>
          <td>${escapeHtml(e.action.name)}</td>
          <td><b>${escapeHtml(e.target.name)}</b></td>
          <td>${resultHtml}</td>
          <td>${breakdown}</td>
        </tr>`;
    })
    .join('');

  return `
    <div class="combat-log-pane">
      <div class="combat-log-header">
        <div>
          <h2>Combat Log</h2>
          <div class="combat-log-status">${statusBadge}</div>
        </div>
        <div class="combat-log-actions">
          <button type="button" class="btn ${status.active ? 'btn-warn' : 'btn-primary'}" data-action="toggle-combat-log">
            ${status.active ? 'Stop recording' : 'Record combat log (5 min / 500 events)'}
          </button>
          <a class="btn" href="/api/admin/combat-log/export" download="combat-log.json">Download JSON</a>
          <button type="button" class="btn" data-action="clear-combat-log">Clear</button>
        </div>
      </div>

      <div class="combat-log-filters">
        <label>
          Filter by character or ability:
          <input type="text" id="combat-filter-name" placeholder="Search name or ability…" value="${escapeHtml(filterName)}" />
        </label>
      </div>

      ${
        filtered.length
          ? `<table class="combat-log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Attacker</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Result</th>
                  <th>Breakdown</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : '<p class="note">No combat events recorded yet. Turn on recording above to capture hit receipts.</p>'
      }
    </div>
  `;
}

function wireCombatLog(): void {
  const input = document.getElementById('combat-filter-name') as HTMLInputElement | null;
  if (input) {
    input.addEventListener('input', () => {
      filterName = input.value;
      // Re-render table rows without refetching from server
      const rowsEl = document.querySelector('.combat-log-table tbody');
      if (rowsEl && cachedResponse) {
        const events = cachedResponse.events;
        const filtered = filterName
          ? events.filter(
              (e) =>
                e.attacker.name.toLowerCase().includes(filterName.toLowerCase()) ||
                e.target.name.toLowerCase().includes(filterName.toLowerCase()) ||
                e.action.name.toLowerCase().includes(filterName.toLowerCase()),
            )
          : events;
        rowsEl.innerHTML = filtered
          .slice()
          .reverse()
          .map((e) => {
            const timeStr = new Date(e.at).toLocaleTimeString();
            const isCrit = e.rolls.crit?.crit;
            const isDodged = e.rolls.dodge?.dodged;
            const isBlocked = e.rolls.block?.blocked;

            let resultHtml = '';
            if (isDodged) {
              resultHtml = '<span class="tag dodged">Dodged</span>';
            } else {
              const typeClass = e.damageType === 'arcane' ? 'damage-arcane' : 'damage-physical';
              resultHtml = `<b class="${typeClass}">${e.finalAmount}</b> <small>${e.damageType}</small>`;
              if (isCrit) resultHtml += ' <span class="tag crit">Crit!</span>';
              if (isBlocked) resultHtml += ` <span class="tag blocked">Blocked ${e.rolls.block?.amount}</span>`;
            }

            if (e.defeated) resultHtml += ' <span class="tag defeat">Defeated!</span>';

            const factors: string[] = [];
            if (e.factors.base !== undefined) factors.push(`Base: ${Math.round(e.factors.base * 10) / 10}`);
            if (e.rolls.variance) factors.push(`Var: ${Math.round(e.rolls.variance * 100) / 100}x`);
            if (e.mitigation.defenseStat) factors.push(`Def: -${e.mitigation.defenseStat}`);
            if (e.mitigation.shieldAbsorb) factors.push(`Shield: -${e.mitigation.shieldAbsorb}`);
            if (e.threat?.added) factors.push(`+${Math.round(e.threat.added)} threat`);
            const breakdown = factors.length ? `<div class="log-breakdown">${factors.join(' · ')}</div>` : '';
            const attackerCalling = e.attacker.calling ? ` <small class="calling-tag">${escapeHtml(e.attacker.calling)}</small>` : '';

            return `
              <tr class="log-row ${isCrit ? 'crit-row' : ''} ${isDodged ? 'dodged-row' : ''}">
                <td class="log-time">${timeStr}</td>
                <td><b>${escapeHtml(e.attacker.name)}</b>${attackerCalling}</td>
                <td>${escapeHtml(e.action.name)}</td>
                <td><b>${escapeHtml(e.target.name)}</b></td>
                <td>${resultHtml}</td>
                <td>${breakdown}</td>
              </tr>`;
          })
          .join('');
      }
    });
  }

  const toggleBtn = document.querySelector('[data-action="toggle-combat-log"]');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      try {
        const nextActive = !cachedResponse?.status.active;
        await api('combat-log/toggle', 'POST', { enabled: nextActive });
        toast(nextActive ? 'Combat logging enabled for 5 minutes (max 500 events).' : 'Combat logging disabled.');
        // Trigger page re-render
        const currentHash = location.hash.slice(1);
        if (currentHash === 'combat-log') {
          const panel = document.getElementById('panel');
          if (panel) {
            panel.innerHTML = await combatLogPage();
            wireCombatLog();
          }
        }
      } catch (err) {
        toast((err as Error).message);
      }
    });
  }

  const clearBtn = document.querySelector('[data-action="clear-combat-log"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      try {
        await api('combat-log/clear', 'POST', {});
        toast('Combat log cleared.');
        const panel = document.getElementById('panel');
        if (panel) {
          panel.innerHTML = await combatLogPage();
          wireCombatLog();
        }
      } catch (err) {
        toast((err as Error).message);
      }
    });
  }
}

export const combatLogTab: Tab = {
  id: 'combat-log',
  label: 'Combat Log',
  page: combatLogPage,
  after: wireCombatLog,
  refreshMs: 2000,
};
