// The Players tab: everyone, where they are, Steward appointments and suspensions.

import { escapeHtml } from '../ui.ts';
import { api, toast, view, type Handled, type Tab } from './core.ts';

interface Player {
  id: string;
  name: string;
  role: string;
  online: boolean;
  region: string | null;
  level: number;
  favor: number | null;
  createdAt: number;
  invitedBy: string | null;
  suspended: { by: string; at: number; reason: string } | null;
}

async function players(): Promise<string> {
  const { players, you } = await api<{ players: Player[]; you: string }>('players');
  const canSuspend = (p: Player) => p.id !== you && p.role !== 'owner' && (view.owner || p.role === 'player');
  const rows = players.map((p) => `
    <tr>
      <td><b>${escapeHtml(p.name)}</b>${p.invitedBy ? `<br><small>invited by ${escapeHtml(p.invitedBy)}</small>` : ''}</td>
      <td>${p.role === 'owner' ? 'Owner' : p.role === 'steward' ? 'Steward' : 'Player'}</td>
      <td>${p.suspended ? `<span class="bad">suspended</span><br><small>by ${escapeHtml(p.suspended.by)}${p.suspended.reason ? `: ${escapeHtml(p.suspended.reason)}` : ''}</small>` : p.online ? `<span class="online">online</span> · ${escapeHtml(p.region ?? '')}` : '<small>offline</small>'}</td>
      <td>${p.level}</td>
      <td>${p.favor ?? ''}</td>
      ${view.owner ? `<td>${p.role === 'owner' ? '' : p.role === 'steward'
        ? `<button type="button" class="quiet" data-role="${p.id}" data-to="player">Remove Steward</button>`
        : `<button type="button" class="quiet" data-role="${p.id}" data-to="steward">Make Steward</button>`}</td>` : ''}
      <td>${canSuspend(p) ? `<button type="button" class="quiet" data-suspend="${p.id}" data-to="${p.suspended ? 'lift' : 'suspend'}">${p.suspended ? 'Lift suspension' : 'Suspend'}</button>` : ''}</td>
    </tr>`).join('');
  return `
    <h2>Players</h2>
    <table class="log"><thead><tr><th>Name</th><th>Role</th><th>Where</th><th>Level</th><th>Favor</th>${view.owner ? '<th></th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.suspend) {
    if (t.dataset.to === 'suspend') {
      const reason = prompt('Why? The player sees this.');
      if (reason === null) return 'keep';
      await api(`players/${t.dataset.suspend}/suspend`, 'POST', { suspend: true, reason });
      toast('Suspended. They were disconnected.');
    } else {
      await api(`players/${t.dataset.suspend}/suspend`, 'POST', { suspend: false });
      toast('Suspension lifted.');
    }
  } else if (t.dataset.role) {
    await api(`players/${t.dataset.role}/role`, 'POST', { role: t.dataset.to });
    toast(t.dataset.to === 'steward' ? 'Appointed. The God has told them.' : 'Steward role removed.');
  } else return false;
  return true;
}

export const playersTab: Tab = { id: 'players', label: 'Players', page: players, click };
