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
  /** Set on a second or later character: the name of the account's first one. */
  characterOf: string | null;
  suspended: { by: string; at: number; reason: string } | null;
}

async function players(): Promise<string> {
  const { players, yours, maxCharacters } = await api<{ players: Player[]; you: string; yours: string[]; maxCharacters: number }>('players');
  const canSuspend = (p: Player) => !yours.includes(p.id) && p.role !== 'owner' && (view.owner || p.role === 'player');
  const rows = players.map((p) => `
    <tr>
      <td><b>${escapeHtml(p.name)}</b>${p.characterOf ? `<br><small>a character of ${escapeHtml(p.characterOf)}</small>` : p.invitedBy ? `<br><small>invited by ${escapeHtml(p.invitedBy)}</small>` : ''}</td>
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
    ${view.owner ? `<form class="row" id="characters-limit">
      <label for="max-characters">Characters one account may have</label>
      <input id="max-characters" type="number" min="1" max="20" value="${maxCharacters}" />
      <button type="submit" class="quiet">Save</button>
    </form>
    <p><small>A suspension or a Steward appointment counts for every character on that account.</small></p>` : ''}
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

/** Saves how many characters one account may have. */
async function submit(form: HTMLFormElement): Promise<Handled> {
  if (form.id !== 'characters-limit') return false;
  const value = form.querySelector<HTMLInputElement>('#max-characters')!.value;
  await api('players/limit', 'POST', { maxCharacters: Number(value) });
  toast(`Each account may now have ${value} character${value === '1' ? '' : 's'}.`);
  return true;
}

export const playersTab: Tab = { id: 'players', label: 'Players', page: players, click, submit };
