// The Updates tab: new commits on GitHub main, and pulling them with a restart.

import { escapeHtml } from '../ui.ts';
import { reloadWhenBack } from '../api.ts';
import { api, when, type Handled, type Tab } from './core.ts';

interface UpdateStatus {
  available: boolean;
  reason?: string;
  branch?: string;
  commit?: string;
  upstream?: string;
  behind: number;
  ahead: number;
  dirty: string[];
  commits: { hash: string; subject: string; author: string; at: number }[];
  checkedAt: number | null;
  fetchError?: string;
  canRestart: boolean;
  blocked?: string;
  lastUpdate: { at: number; ok: boolean; by?: string; message: string } | null;
  releases?: { id: string; title: string; wisher: string; pr?: string }[];
}

async function updates(): Promise<string> {
  const u = await api<UpdateStatus>('update');
  if (!u.available) return `<p class="note">${escapeHtml(u.reason ?? 'Updates are not available on this server.')}</p>`;
  const last = u.lastUpdate
    ? `<p class="note ${u.lastUpdate.ok ? '' : 'bad'}">Last update ${when(u.lastUpdate.at)}${u.lastUpdate.by ? ` by ${escapeHtml(u.lastUpdate.by)}` : ''}: ${escapeHtml(u.lastUpdate.message)}</p>`
    : '';
  const list = u.commits.length
    ? `<ul class="recent">${u.commits.map((c) => `<li><code>${escapeHtml(c.hash)}</code> <b>${escapeHtml(c.subject)}</b> · ${escapeHtml(c.author)} · ${when(c.at)}</li>`).join('')}</ul>`
    : '';
  const headline = u.behind
    ? `<b>${u.behind} new commit${u.behind === 1 ? '' : 's'}</b> on GitHub main since this server's ${escapeHtml(u.commit ?? '')}.`
    : `This server runs <code>${escapeHtml(u.commit ?? '?')}</code>, the latest main.`;
  return `
    <h2>Game code</h2>
    <p>${headline}</p>
    ${list}
    ${u.releases?.length ? `<p><b>Wishes this update makes live:</b></p><ul class="recent">${u.releases.map((r) => `<li><b>${escapeHtml(r.title)}</b>, wished by ${escapeHtml(r.wisher)}${r.pr ? ` · <a href="${escapeHtml(r.pr)}" target="_blank" rel="noopener">pull request</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${u.fetchError ? `<p class="note bad">Could not reach GitHub: ${escapeHtml(u.fetchError)}</p>` : ''}
    ${u.blocked && u.behind ? `<p class="note warn">${escapeHtml(u.blocked)}</p>` : ''}
    <p class="actions">
      <button type="button" data-update-check>Check now</button>
      <button type="button" data-update-pull ${u.blocked ? 'disabled' : ''}>Pull main and restart</button>
    </p>
    <p class="note">Checked ${u.checkedAt ? when(u.checkedAt) : 'never'}${u.branch ? ` · on branch ${escapeHtml(u.branch)}` : ''}. The server checks every ten minutes. Pulling only fast-forwards: local changes are never overwritten. Everyone is disconnected for a moment and their page reloads.</p>
    ${last}`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.updateCheck !== undefined) {
    t.disabled = true;
    await api('update/check', 'POST');
    return true;
  }
  if (t.dataset.updatePull === undefined) return false;
  if (!confirm('Pull main and restart the game? Everyone is disconnected for a moment.')) return 'keep';
  const r = await api<{ from: string }>('update', 'POST');
  document.getElementById('main')!.innerHTML = '<p class="note">Pulling main and restarting. This page reloads when the game is back…</p>';
  void reloadWhenBack(r.from);
  return 'keep';
}

export const updatesTab: Tab = { id: 'updates', label: 'Updates', ownerOnly: true, page: updates, click };
