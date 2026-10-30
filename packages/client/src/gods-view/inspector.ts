// Live Entity Inspector (Tool 4): real-time state streaming for players and creatures.
// Accessible to Stewards and Owner.

import { escapeHtml } from '../ui.ts';
import { api, toast } from './core.ts';
import type { EntityInspection } from '@co-mmo/shared';

let activeTarget: { region: string; kind: 'player' | 'creature'; id: string } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let containerEl: HTMLElement | null = null;

/** Opens the live inspector modal watching an entity. */
export function openInspector(region: string, kind: 'player' | 'creature', id: string): void {
  closeInspector();
  activeTarget = { region, kind, id };

  let modal = document.getElementById('inspector-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'inspector-modal';
    modal.className = 'inspector-modal';
    document.body.appendChild(modal);
  }
  containerEl = modal;
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="inspector-card">
      <div class="inspector-header">
        <h3>Watching entity…</h3>
        <button type="button" class="inspector-close-btn">Stop watching</button>
      </div>
      <p class="note">Connecting to live simulation…</p>
    </div>
  `;

  modal.querySelector('.inspector-close-btn')?.addEventListener('click', closeInspector);

  void refresh();
  pollTimer = setInterval(() => void refresh(), 250);
}

/** Stops watching the entity and closes the inspector pane. */
export function closeInspector(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeTarget = null;
  if (containerEl) {
    containerEl.style.display = 'none';
    containerEl.innerHTML = '';
  }
}

async function refresh(): Promise<void> {
  if (!activeTarget || !containerEl) return;
  const { region, kind, id } = activeTarget;
  try {
    const data = await api<EntityInspection>(`inspect/${encodeURIComponent(region)}/${kind}/${encodeURIComponent(id)}`);
    if (!activeTarget || activeTarget.id !== id) return;
    render(data);
  } catch (err) {
    if (containerEl && activeTarget) {
      containerEl.innerHTML = `
        <div class="inspector-card">
          <div class="inspector-header">
            <h3>Entity unreachable</h3>
            <button type="button" class="inspector-close-btn">Stop watching</button>
          </div>
          <p class="bad">Could not inspect entity (${escapeHtml((err as Error).message)}). The entity may have moved, despawned, or left.</p>
        </div>
      `;
      containerEl.querySelector('.inspector-close-btn')?.addEventListener('click', closeInspector);
    }
  }
}

function render(data: EntityInspection): void {
  if (!containerEl) return;

  const hpPercent = data.maxHp > 0 ? Math.max(0, Math.min(100, (data.hp / data.maxHp) * 100)) : 0;
  const energyPercent = data.maxEnergy > 0 ? Math.max(0, Math.min(100, (data.energy / data.maxEnergy) * 100)) : 0;

  // Statuses
  const statusesHtml = data.statuses.length
    ? `<div class="inspector-tags">${data.statuses
        .map((s) => {
          const by = s.by ? ` by ${escapeHtml(s.by)}` : '';
          const amt = s.amount !== undefined ? ` (${s.amount})` : '';
          return `<span class="inspector-tag">${escapeHtml(s.id)}: ${s.secondsLeft}s left${amt}${by}</span>`;
        })
        .join('')}</div>`
    : '<span class="muted">No active statuses</span>';

  // Threat table (for creatures)
  let threatHtml = '';
  if (data.threat) {
    const t = data.threat;
    const targetName = t.targetId ? t.entries.find((e) => e.isTarget)?.playerName ?? t.targetId : 'None';
    const tauntInfo = t.tauntedBy ? `<p class="warn"><b>Taunted</b> by ${escapeHtml(t.tauntedBy)}</p>` : '';
    const turnInfo =
      t.switchThreshold > 0
        ? `<p class="muted">Needs 10% more threat to turn: <b>${t.switchThreshold}</b> pts</p>`
        : '';

    const rows = t.entries
      .map(
        (e) => `
        <tr class="${e.isTarget ? 'threat-target-row' : ''}">
          <td><b>${escapeHtml(e.playerName)}</b></td>
          <td>${e.amount}</td>
          <td>${e.isTarget ? '<span class="badge target">Holds attention</span>' : ''}</td>
        </tr>`,
      )
      .join('');

    threatHtml = `
      <div class="inspector-section">
        <h4>Threat & Attention</h4>
        <p>Current target: <b>${escapeHtml(targetName)}</b></p>
        ${tauntInfo}
        ${turnInfo}
        ${
          t.entries.length
            ? `<table class="inspector-table">
                <thead><tr><th>Player</th><th>Threat</th><th>Status</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
            : '<p class="muted">No players on threat table.</p>'
        }
      </div>
    `;
  }

  // Gauge display
  let gaugeHtml = '';
  if (data.gauge) {
    const g = data.gauge;
    const pipsStr = '●'.repeat(g.pips) + '○'.repeat(Math.max(0, g.max - g.pips));
    let extra = '';
    if (g.threads) {
      extra = `<small>Ember: ${g.threads.ember} · Tide: ${g.threads.tide} · Gale: ${g.threads.gale}</small>`;
    }
    if (g.woven) {
      extra += ' <span class="badge woven">Woven (2x spell power)</span>';
    }
    gaugeHtml = `
      <div class="inspector-section">
        <h4>Signature Gauge: ${escapeHtml(g.calling || 'None')}</h4>
        <div class="gauge-pips">${pipsStr} (${g.pips}/${g.max})</div>
        ${extra ? `<div>${extra}</div>` : ''}
      </div>
    `;
  }

  // Creature brain
  let brainHtml = '';
  if (data.brain) {
    const b = data.brain;
    brainHtml = `
      <div class="inspector-section">
        <h4>Creature Mind</h4>
        <div class="stat-grid">
          <div><span>State:</span> <b>${escapeHtml(b.state)}</b></div>
          <div><span>Home leash:</span> (${b.leashX}, ${b.leashY})</div>
          <div><span>Pace:</span> ${Math.round(b.pace * 100)}%</div>
          <div><span>Last attack:</span> ${b.lastAttackSecondsAgo}s ago</div>
        </div>
      </div>
    `;
  }

  // Cooldowns
  const cooldownsHtml = data.cooldowns.length
    ? `<table class="inspector-table">
        <thead><tr><th>Ability</th><th>Ready</th></tr></thead>
        <tbody>
          ${data.cooldowns
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.name)}</td>
              <td>${c.secondsLeft > 0 ? `<span class="warn">${c.secondsLeft}s</span>` : '<span class="good">Ready</span>'}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
    : '<p class="muted">No abilities on cooldown.</p>';

  containerEl.innerHTML = `
    <div class="inspector-card">
      <div class="inspector-header">
        <div>
          <h3>${escapeHtml(data.name)} <small>(${data.kind})</small></h3>
          <div class="inspector-sub">ID: ${escapeHtml(data.id)} · Floor ${data.floor} · At (${data.x}, ${data.y})</div>
        </div>
        <button type="button" class="inspector-close-btn">Stop watching</button>
      </div>

      <div class="inspector-bars">
        <div class="bar-group">
          <div class="bar-label"><span>Health</span> <b>${data.hp} / ${data.maxHp}</b></div>
          <div class="progress-bar health-bar"><div class="fill" style="width: ${hpPercent}%"></div></div>
        </div>
        ${
          data.kind === 'player'
            ? `<div class="bar-group">
                <div class="bar-label"><span>Energy</span> <b>${data.energy} / ${data.maxEnergy}</b></div>
                <div class="progress-bar energy-bar"><div class="fill" style="width: ${energyPercent}%"></div></div>
              </div>`
            : ''
        }
      </div>

      <div class="inspector-section">
        <h4>Active Statuses</h4>
        ${statusesHtml}
      </div>

      ${gaugeHtml}
      ${threatHtml}
      ${brainHtml}

      <div class="inspector-section">
        <h4>Ability Cooldowns</h4>
        ${cooldownsHtml}
      </div>
    </div>
  `;

  containerEl.querySelector('.inspector-close-btn')?.addEventListener('click', closeInspector);
}
