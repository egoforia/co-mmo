// The Rules tab: live scripted rules, their effects and errors, with pause and resume.

import { escapeHtml } from '../ui.ts';
import { api, toast, when, type Entry, type Handled, type Tab } from './core.ts';

async function rules(): Promise<string> {
  const { content } = await api<{ content: Entry[] }>('content');
  const live = content.filter((e) => e.status === 'granted' && e.definition?.kind === 'rule');
  if (!live.length) return '<h2>Scripted rules</h2><p class="note">No rules are live yet. Approve a Major wish with a tested rule to add one.</p>';
  const cards = live.map((e) => {
    const s = e.live;
    const paused = s?.paused ?? e.rule?.paused ?? false;
    const effects = s ? Object.entries(s.effects).map(([k, n]) => `${k} ${n}`).join(', ') || 'none yet' : '';
    const errors = s?.errors.length ? `<details><summary>${s.errors.length} recent errors</summary><ul>${s.errors.map((x) => `<li class="err">${when(x.at)} · ${escapeHtml(x.message)}</li>`).join('')}</ul></details>` : '';
    return `
      <article class="wish ${paused ? 'paused' : ''}">
        <header><span class="tier major">rule</span><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        <p>${paused ? `<b class="bad">Paused:</b> ${escapeHtml(s?.reason ?? e.rule?.reason ?? '')}` : '<b class="ok">Running.</b>'} ${s ? `${s.runs} events handled · listens to ${escapeHtml(s.events.join(', '))} · ${s.timers} timers waiting` : 'Not loaded.'}</p>
        ${s ? `<p><small>Effects so far: ${escapeHtml(effects)}</small></p>` : ''}
        ${errors}
        <details><summary>Script</summary><pre class="script">${escapeHtml(e.definition?.script ?? '')}</pre></details>
        <div class="actions">
          <button type="button" class="quiet" data-pause="${e.id}" data-to="${paused ? 'resume' : 'pause'}">${paused ? 'Resume' : 'Pause'}</button>
          <button type="button" class="quiet" data-rollback="${e.id}">Roll back</button>
        </div>
      </article>`;
  }).join('');
  return `<h2>Scripted rules</h2><p class="note">Each rule runs in its own sandbox. A rule that throws errors or hits its limits pauses itself, and Stewards are told.</p>${cards}`;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (!t.dataset.pause) return false;
  await api(`content/${t.dataset.pause}/rule`, 'POST', { paused: t.dataset.to === 'pause' });
  toast(t.dataset.to === 'pause' ? 'Paused. Nothing it does happens until you resume it.' : 'Resumed.');
  return true;
}

// Its Roll back buttons are the Wishes tab's (data-rollback), handled there.
export const rulesTab: Tab = { id: 'rules', label: 'Rules', page: rules, click };
