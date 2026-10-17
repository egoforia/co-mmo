// The Mods tab: every granted wish as a mod a Steward can switch off and on
// again, or undo for good (design doc, Wishes as mods).

import { escapeHtml } from '../ui.ts';
import { api, toast, view, when, type Entry, type Handled, type Tab } from './core.ts';
import { progress } from './wishes.ts';

const KIND_WORDS: Record<string, string> = {
  item: 'A thing for the bag',
  ability: 'An ability (a scroll)',
  creature: 'Creatures',
  npc: 'A person',
  player: "A player's look",
  recipe: 'A crafting recipe',
  loot: "A creature's loot",
  region: 'A new region',
  rule: 'A scripted rule',
};

async function mods(): Promise<string> {
  const { content } = await api<{ content: Entry[] }>('content');
  const granted = content.filter((e) => e.status === 'granted' && !e.undoes);
  const undoing = new Map(content.filter((e) => e.undoes && (e.status === 'pending' || e.status === 'approved')).map((e) => [e.undoes!, e]));
  const on = granted.filter((e) => !e.off);
  const off = granted.filter((e) => e.off);
  const list = (entries: Entry[]) => entries.map((e) => card(e, undoing.get(e.id))).join('');
  return `
    <h2>Mods</h2>
    <p class="note">Every granted wish is a mod. <b>Switch off</b> takes it out of the world for now: what players hold sleeps in their bags and wakes when it is switched on again. <b>Undo</b> takes it out for good.</p>
    <h3>On (${on.length})</h3>
    ${on.length ? list(on) : '<p class="note">No wishes are on.</p>'}
    <h3>Switched off (${off.length})</h3>
    ${off.length ? list(off) : '<p class="note">Nothing is switched off.</p>'}`;
}

/** One mod: what it is, who wished it, its switch and its undo. */
function card(e: Entry, undo: Entry | undefined): string {
  const code = Boolean(e.build);
  const what = code ? 'A change to the game\'s code' : KIND_WORDS[e.definition?.kind ?? ''] ?? 'A wish';
  const link = e.build?.pr ? ` · <a href="${escapeHtml(e.build.pr.url)}" target="_blank" rel="noopener">Pull request #${e.build.pr.number}</a>` : '';
  const switchable = !code || Boolean(e.mod);
  const offLine = e.off ? `<p><b class="bad">Switched off</b> by ${escapeHtml(e.off.by)}, ${when(e.off.at)}.</p>` : '';
  const undoLine = undo ? `<p>Being undone: ${progress(undo)}</p>` : '';
  const noSwitch = code && !e.mod ? '<p class="note">Built before wishes became mods, so it has no switch. It can only be undone.</p>' : '';
  return `
    <article class="wish mod${e.off ? ' paused' : ''}">
      <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
      <p>${escapeHtml(e.summary)}</p>
      <p><small>${escapeHtml(what)}${link}</small></p>
      ${offLine}${undoLine}${noSwitch}
      <div class="actions">
        ${switchable ? `<button type="button" data-mod-switch="${e.id}" data-to="${e.off ? 'on' : 'off'}">${e.off ? 'Switch on' : 'Switch off'}</button>` : ''}
        ${undo ? '' : `<button type="button" class="quiet" data-mod-undo="${e.id}" data-code="${code ? 'yes' : 'no'}">Undo</button>`}
      </div>
    </article>`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.modSwitch) {
    const off = t.dataset.to === 'off';
    await api(`content/${t.dataset.modSwitch}/${off ? 'off' : 'on'}`, 'POST');
    toast(off ? 'Switched off. It is out of the world until you switch it on again.' : 'Switched on. It is back in the world.');
    return true;
  }
  if (t.dataset.modUndo) {
    const code = t.dataset.code === 'yes';
    const ask = !code
      ? 'Undo this wish for good? It leaves the world, and what it made leaves every bag.'
      : view.owner
        ? 'Undo this change to the code? The coding agent writes a change that takes it out, and you merge it like any wish.'
        : 'Ask the Owner to undo this change to the code? It waits on the Wishes tab for them.';
    if (!confirm(ask)) return 'keep';
    const done = await api<{ queued?: boolean }>(`content/${t.dataset.modUndo}/undo`, 'POST');
    toast(!code ? 'Undone.' : done.queued ? 'Sent to the coding agent. You will review its change like any wish.' : 'Asked. The Owner decides on the Wishes tab.');
    return true;
  }
  return false;
}

/** The Mods tab. */
export const modsTab: Tab = { id: 'mods', label: 'Mods', page: mods, click };
