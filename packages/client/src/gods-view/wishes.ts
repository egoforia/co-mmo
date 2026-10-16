// The Wishes tab: the review queue, Engine wish approval and builds, and the content log with rollback.

import { escapeHtml } from '../ui.ts';
import { api, rerender, toast, usd, view, when, type Entry, type Handled, type Tab } from './core.ts';

async function wishes(): Promise<string> {
  const { content } = await api<{ content: Entry[] }>('content');
  const pending = content.filter((e) => e.status === 'pending');
  if (pending.some((e) => e.draft?.state === 'drafting')) setTimeout(pollDrafting);
  const queue = pending.length
    ? pending.map((e) => `
      <article class="wish pending">
        <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b>${progress(e)}<small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        <p>${escapeHtml(e.summary)}</p>
        ${brief(e)}
        ${conversation(e)}
        ${e.tier === 'major' ? draft(e) : ''}
        ${e.build?.state === 'closed' ? `<p class="note warn">You closed its pull request${e.build.message ? `: ${escapeHtml(e.build.message)}` : '.'} Approve to build it again.</p>` : ''}
        ${e.tier === 'engine' ? engineApproval(e) : `<div class="actions">
          <button type="button" data-review="${e.id}" data-approve="yes"${e.definition?.kind === 'rule' && !e.test?.passed ? ' disabled title="The rule has not passed its test run"' : ''}>${e.definition?.kind === 'rule' ? 'Approve and go live' : 'Approve'}</button>
          ${view.owner && e.tier === 'major' && e.definition?.kind !== 'rule' ? `<button type="button" class="quiet" data-build="${e.id}" title="A coding agent writes it as a change to the game">Send to be built as code</button>` : ''}
          <button type="button" class="quiet" data-review="${e.id}" data-approve="no">Reject</button>
        </div>`}
      </article>`).join('')
    : '<p class="note">Nothing is waiting. Major and engine wishes appear here for review.</p>';
  const rows = content.map((e) => `
    <tr class="${e.status}">
      <td>${e.art ? `<img src="${escapeHtml(e.art)}" alt="">` : e.definition ? '<span class="ph" title="Placeholder art">✦</span>' : ''}</td>
      <td><b>${escapeHtml(e.title)}</b><br><small>${escapeHtml(e.summary)}</small>${conversation(e)}${artPrompts(e)}</td>
      <td><span class="tier ${e.tier}">${e.tier}</span></td>
      <td>${progress(e)}${e.progress?.detail ? `<br><small>${escapeHtml(e.progress.detail)}</small>` : ''}</td>
      <td>${escapeHtml(e.wisher.name)}<br><small>${when(e.at)}</small></td>
      ${view.owner ? `<td>${e.usd !== undefined ? usd(e.usd) : ''}</td>` : ''}
      <td><div class="actions">
        ${e.status === 'granted' && !e.build ? `<button type="button" class="quiet" data-rollback="${e.id}">Roll back</button>` : ''}
        ${view.owner && e.build?.state === 'failed' ? `<button type="button" class="quiet" data-build="${e.id}">Try again</button>` : ''}
        ${view.owner && e.status === 'approved' && !e.build ? `<button type="button" class="quiet" data-build="${e.id}">Build it</button>` : ''}
        ${view.owner && e.status === 'granted' && e.definition ? `<button type="button" class="quiet" data-paint="${e.id}">${e.art || e.kitArt || e.itemArt ? 'Repaint' : 'Paint'}</button>` : ''}
      </div></td>
    </tr>`).join('');
  const active = content.filter((e) => e.build && ['queued', 'building', 'fixing', 'review', 'merged', 'failed'].includes(e.build.state));
  const building = active.length
    ? active.map((e) => `
      <article class="wish">
        <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b>${progress(e)}<small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        ${e.progress?.detail ? `<p>${escapeHtml(e.progress.detail)}</p>` : ''}
        <p class="links">${e.build!.issue ? `<a href="${escapeHtml(e.build!.issue.url)}" target="_blank" rel="noopener">Issue #${e.build!.issue.number}</a>` : ''}${e.build!.pr ? ` · <a href="${escapeHtml(e.build!.pr.url)}" target="_blank" rel="noopener">Pull request #${e.build!.pr.number}</a>` : ''}${e.build!.tries && e.build!.tries > 1 ? ` · try ${e.build!.tries}` : ''}</p>
        ${view.owner && e.build!.state === 'failed' ? `<div class="actions"><button type="button" data-build="${e.id}">Try again</button><button type="button" class="quiet" data-reject-built="${e.id}">Give up</button></div>` : ''}
        ${e.build!.state === 'merged' ? '<p class="actions"><a class="button" href="#updates">Open Updates to release it</a></p>' : ''}
      </article>`).join('')
    : '';
  return `
    <h2>Waiting for review</h2>
    ${queue}
    ${building ? `<h2>Being built</h2><p class="note">Approved Engine wishes become GitHub issues. A coding agent writes the change with tests and opens a pull request; you merge it, then release it from Updates.</p>${building}` : ''}
    <h2>Content log</h2>
    <p class="note legend">${progressLegend()}</p>
    ${content.length ? `<table class="log"><thead><tr><th></th><th>Wish</th><th>Tier</th><th>Status</th><th>Wished by</th>${view.owner ? '<th>Cost</th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">No wishes yet.</p>'}`;
}

const PROGRESS_ICON = { 'in-progress': '⏳', 'needs-input': '✋', error: '✗', done: '✓', closed: '–' } as const;

/** Where a wish stands: in progress, needs a person, error, done (or closed). */
function progress(e: Entry): string {
  const p = e.progress;
  if (!p) return `<span class="progress">${escapeHtml(e.status)}</span>`;
  const badge = `<span class="progress ${p.state}" title="${escapeHtml(p.detail ?? '')}">${PROGRESS_ICON[p.state]} ${escapeHtml(p.label)}</span>`;
  return p.link ? `<a href="${escapeHtml(p.link)}" target="_blank" rel="noopener">${badge}</a>` : badge;
}

/** Approving an Engine wish hands it to the coding agent, with the Owner's note. */
function engineApproval(e: Entry): string {
  if (!view.owner) return '<p class="note">Engine wishes change the game\'s code. Only the Owner can approve them.</p>';
  return `
    <form class="form approve-engine" data-approve-engine="${e.id}">
      <label>Note for the coding agent<span><input name="note" maxlength="1000" placeholder="optional, e.g. keep it to the Shore region" value="${escapeHtml(e.build?.note ?? '')}"></span></label>
      <label class="check"><input type="checkbox" name="allowCore"${e.build?.allowCore ? ' checked' : ''}> Allow changes to sign-in, roles, the budget, keys and the script sandbox</label>
      <div class="actions">
        <button type="submit">Approve and build</button>
        <button type="button" class="quiet" data-review="${e.id}" data-approve="no">Reject</button>
      </div>
    </form>`;
}

/** The God's drafted rule for a Major wish: script, items, test run, and a way to ask for changes. */
function draft(e: Entry): string {
  const d = e.draft;
  const def = e.definition?.kind === 'rule' ? e.definition : undefined;
  const state = !d
    ? '<p class="note">No rule drafted yet.</p>'
    : d.state === 'drafting'
      ? '<p class="note">The God is drafting a rule and testing it…</p>'
      : d.state === 'impossible'
        ? `<p class="note">The God says this cannot be a scripted rule: ${escapeHtml(d.message ?? '')} Approving records it for people to build.</p>`
        : d.state === 'failed'
          ? `<p class="note bad">Drafting failed: ${escapeHtml(d.message ?? '')}</p>`
          : '';
  const items = def?.items && Object.keys(def.items).length
    ? `<ul class="items">${Object.entries(def.items).map(([k, i]) => `<li><b>${escapeHtml(i.name)}</b> <code>${escapeHtml(k)}</code> · ${escapeHtml(i.itemKind)}${i.heal ? `, heals ${i.heal}` : ''}<br><small>${escapeHtml(i.description)}</small></li>`).join('')}</ul>`
    : '';
  const test = e.test
    ? `<div class="test ${e.test.passed ? 'ok' : 'bad'}"><b>${e.test.passed ? '✓ Test run passed' : '✗ Test run failed'}</b>
        <ul>${e.test.summary.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}${e.test.errors.map((l) => `<li class="err">${escapeHtml(l)}</li>`).join('')}</ul>
        ${e.test.sample.length ? `<details><summary>What players would see</summary><ul>${e.test.sample.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul></details>` : ''}</div>`
    : '';
  const rule = def
    ? `<div class="rule"><p><b>${escapeHtml(def.name)}</b>: ${escapeHtml(def.description)}<br><small>How to play: ${escapeHtml(def.howTo ?? '')}</small></p>${items}
        <details><summary>Script${d?.model ? ` · drafted by ${escapeHtml(d.model)}` : ''}</summary><pre class="script">${escapeHtml(def.script ?? '')}</pre></details>${test}</div>`
    : '';
  const busy = d?.state === 'drafting';
  return `${state}${rule}
    <form class="form revise" data-revise="${e.id}">
      <label>${def ? 'Ask the God to change it' : 'Ask the God to draft a rule'}<span><input name="note" placeholder="${def ? 'e.g. make the Golden Carp rarer' : 'optional notes'}"${busy ? ' disabled' : ''}><button type="submit"${busy ? ' disabled' : ''}>${def ? 'Revise' : 'Draft'}</button></span></label>
    </form>`;
}

function progressLegend(): string {
  return [
    ['in-progress', 'In progress: the God is working on it'],
    ['needs-input', 'On hold: waiting for a Steward or the Owner'],
    ['error', 'Error: something failed, see why'],
    ['done', 'Done: in the world'],
  ].map(([state, text]) => `<span class="progress ${state}">${PROGRESS_ICON[state as keyof typeof PROGRESS_ICON]} ${text}</span>`).join(' ');
}

/** A Workshop wish's brief, read before the conversation. */
function brief(e: Entry): string {
  if (!e.shaped) return '';
  const lines = e.shaped.brief?.length ? `<ul class="brief">${e.shaped.brief.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '';
  return `<p class="note">Shaped in the Wish Workshop · ${escapeHtml(e.shaped.category)}</p>${lines}`;
}

function conversation(e: Entry): string {
  if (!e.conversation?.length) return '';
  const lines = e.conversation.map((t) => `<li class="${t.role}"><b>${t.role === 'user' ? escapeHtml(e.wisher.name) : 'God'}:</b> ${escapeHtml(t.content)}</li>`).join('');
  return `<details><summary>Conversation</summary><ol class="talk">${lines}</ol></details>`;
}

/** Exactly what each picture asked of the image model: references, the provider's note, then the prompt. */
function artPrompts(e: Entry): string {
  const prompts = Object.entries(e.artPrompts ?? {});
  if (!prompts.length) return '';
  const several = prompts.length > 1;
  const body = prompts.map(([id, p]) => `
    ${several ? `<p><b>${escapeHtml(id)}</b></p>` : ''}
    <p><small>${escapeHtml(p.model)} (${escapeHtml(p.provider)}) · ${when(p.at)}${p.usd !== undefined ? ` · ${usd(p.usd)}` : ''} · references: ${p.references.length ? p.references.map(escapeHtml).join(', ') : 'none'}</small></p>
    <pre>${p.note ? `${escapeHtml(p.note)}\n` : ''}${escapeHtml(p.prompt)}</pre>
    ${e.status === 'granted' && e.definition?.kind !== 'region' ? `
    <form class="form repaint" data-repaint="${e.id}" data-picture="${escapeHtml(id)}">
      <label>Reword it, then paint again<span><textarea name="prompt" rows="6" maxlength="4000">${escapeHtml(p.prompt)}</textarea></span></label>
      <button type="submit" class="quiet">Repaint with these words</button>
    </form>` : ''}`).join('');
  return `<details><summary>${several ? `Image prompts (${prompts.length})` : 'Image prompt'}</summary>${body}</details>`;
}

/** While a rule is being drafted, refresh the Wishes tab until it is done. */
let polling = 0;
function pollDrafting(): void {
  clearInterval(polling);
  polling = window.setInterval(async () => {
    if (view.tab !== 'wishes') return clearInterval(polling);
    const { content } = await api<{ content: Entry[] }>('content').catch(() => ({ content: [] as Entry[] }));
    if (!content.some((e) => e.draft?.state === 'drafting')) {
      clearInterval(polling);
      rerender();
    }
  }, 2000);
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.review) {
    const r = await api<{ status: string }>(`content/${t.dataset.review}/review`, 'POST', { approve: t.dataset.approve === 'yes' });
    toast(r.status === 'granted' ? 'Approved. The rule is live and everyone was told.' : t.dataset.approve === 'yes' ? 'Approved. The wisher has been told.' : 'Rejected. The wisher has been told.');
  } else if (t.dataset.build) {
    const r = await api<{ build?: string }>(`content/${t.dataset.build}/build`, 'POST', {});
    toast(r.build === 'building' ? 'Sent. A coding agent is building it on GitHub.' : 'Queued to be built.');
  } else if (t.dataset.rejectBuilt) {
    if (!confirm('Give up on this wish? The wisher is told it was not approved.')) return 'keep';
    await api(`content/${t.dataset.rejectBuilt}/review`, 'POST', { approve: false });
    toast('Rejected. The wisher has been told.');
  } else if (t.dataset.rollback) {
    if (!confirm('Roll this wish back for everyone? It disappears from the world and from bags.')) return 'keep';
    await api(`content/${t.dataset.rollback}/rollback`, 'POST');
    toast('Rolled back.');
  } else if (t.dataset.paint) {
    await api(`content/${t.dataset.paint}/paint`, 'POST');
    toast('Painting. The new art appears in a few seconds.');
  } else return false;
  return true;
}

async function submit(form: HTMLFormElement, f: Record<string, string>): Promise<Handled> {
  if (form.dataset.approveEngine) {
    const r = await api<{ build?: string }>(`content/${form.dataset.approveEngine}/review`, 'POST', { approve: true, note: f.note ?? '', allowCore: f.allowCore === 'on' });
    toast(r.build === 'building' ? 'Approved. A coding agent is building it on GitHub.' : 'Approved and queued to be built.');
  } else if (form.dataset.revise) {
    await api(`content/${form.dataset.revise}/revise`, 'POST', { note: f.note ?? '' });
    toast('The God is drafting. The new version appears here when its test run is done.');
    pollDrafting();
  } else if (form.dataset.repaint) {
    await api(`content/${form.dataset.repaint}/paint`, 'POST', { picture: form.dataset.picture, prompt: f.prompt ?? '' });
    toast('Painting with your words. The new art appears in a few seconds.');
  } else return false;
  return true;
}

export const wishesTab: Tab = { id: 'wishes', label: 'Wishes', page: wishes, click, submit };
