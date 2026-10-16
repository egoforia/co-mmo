// The Reports tab: what players reported, and closing each report.

import { escapeHtml } from '../ui.ts';
import { api, toast, when, type Handled, type Tab } from './core.ts';

interface Report {
  id: string;
  at: number;
  reporter: { id: string; name: string };
  kind: 'content' | 'player';
  target: { id: string; name: string };
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  closed?: { by: string; at: number; action: string };
}

async function reports(): Promise<string> {
  const { reports } = await api<{ reports: Report[] }>('reports');
  if (!reports.length) return '<h2>Reports</h2><p class="note">No reports. Players report from the Bible\'s Chronicle, or with /report in chat.</p>';
  const rows = reports.map((r) => `
    <tr class="${r.status}">
      <td>${when(r.at)}</td>
      <td>${escapeHtml(r.reporter.name)}</td>
      <td>${r.kind === 'player' ? 'Player' : 'Creation'}: <b>${escapeHtml(r.target.name)}</b></td>
      <td>${escapeHtml(r.reason)}</td>
      <td>${r.status === 'open'
        ? `<div class="actions">
            ${r.kind === 'content' ? `<button type="button" class="quiet" data-report-rollback="${r.id}" data-target="${r.target.id}">Roll back</button>` : `<button type="button" class="quiet" data-report-suspend="${r.id}" data-target="${r.target.id}">Suspend</button>`}
            <button type="button" class="quiet" data-report-close="${r.id}" data-status="resolved">Handled</button>
            <button type="button" class="quiet" data-report-close="${r.id}" data-status="dismissed">Dismiss</button>
          </div>`
        : `<small>${r.status} by ${escapeHtml(r.closed?.by ?? '')}: ${escapeHtml(r.closed?.action ?? '')}</small>`}</td>
    </tr>`).join('');
  return `<h2>Reports</h2>
    <table class="log"><thead><tr><th>When</th><th>From</th><th>About</th><th>Why</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.reportRollback) {
    if (!confirm('Roll this wish back for everyone and close the report?')) return 'keep';
    await api(`content/${t.dataset.target}/rollback`, 'POST').catch((err: Error) => toast(err.message));
    await api(`reports/${t.dataset.reportRollback}/close`, 'POST', { status: 'resolved', action: 'rolled the wish back' });
    toast('Rolled back. The reporter has been told.');
  } else if (t.dataset.reportSuspend) {
    const reason = prompt('Why? The player sees this.');
    if (reason === null) return 'keep';
    await api(`players/${t.dataset.target}/suspend`, 'POST', { suspend: true, reason });
    await api(`reports/${t.dataset.reportSuspend}/close`, 'POST', { status: 'resolved', action: 'suspended the player' });
    toast('Suspended. The reporter has been told.');
  } else if (t.dataset.reportClose) {
    await api(`reports/${t.dataset.reportClose}/close`, 'POST', { status: t.dataset.status });
    toast(t.dataset.status === 'resolved' ? 'Marked handled.' : 'Dismissed.');
  } else return false;
  return true;
}

export const reportsTab: Tab = { id: 'reports', label: 'Reports', page: reports, click };
