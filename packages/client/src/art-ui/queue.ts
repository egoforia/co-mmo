// The AI Art Studio's "Up Next" Queue & Live Jobs Monitor (#queue):
// - Staged "Up Next" priority queue persisted on the server (data/art/up-next-queue.json)
// - Priority reordering (▲ / ▼), inline note/prompt editing, AI Art Director harmonization
// - Run Queue (all), Run Next 1, Pause, Clear Completed
// - Live ArtJobs rate-limited execution monitor

import type { Facing } from '@co-mmo/shared';
import { openReview } from './dialogs.ts';
import { jobsHtml } from './pages.ts';
import {
  type Ask,
  type UpNextEntry,
  type UpNextState,
  artState,
  assetHref,
  budgetLine,
  esc,
  usd,
} from './state.ts';

export async function loadUpNext(): Promise<UpNextState> {
  const state = await artState.ctx.api<UpNextState>('art/queue').catch(() => ({ running: false, items: [] }));
  artState.upNext = state;
  return state;
}

/** One-click button to stage any paint/view/clip/sound/normal/sheet request into the "Up Next" queue. */
export function queueButtonHtml(
  entry: {
    kind: UpNextEntry['kind'];
    targetId: string;
    label: string;
    category: string;
    direction?: Facing;
    body?: string;
    estimateUsd: number;
  },
  text = '+ Queue',
): string {
  const staged = artState.upNext?.items.some(
    (i) => i.kind === entry.kind && i.targetId === entry.targetId && i.direction === entry.direction && i.status === 'staged',
  );
  return `<button type="button" class="quiet queue-add-btn${staged ? ' staged' : ''}" data-queue-add="${esc(JSON.stringify(entry))}">${staged ? '✓ In Queue' : esc(text)}</button>`;
}

export function queuePage(): string {
  const data = artState.data!;
  const q = artState.upNext ?? { running: false, items: [] };
  const staged = q.items.filter((i) => i.status === 'staged');
  const totalUsd = staged.reduce((sum, i) => sum + i.estimateUsd, 0);
  const doneCount = q.items.filter((i) => i.status === 'done' || i.status === 'failed').length;

  const row = (item: UpNextEntry, idx: number) => {
    const href = assetHref(item.targetId, item.kind === 'clip' ? 'clip' : item.kind === 'sound' ? 'sound' : 'picture');
    const statusBadge =
      item.status === 'running'
        ? '<span class="job painting">Running…</span>'
        : item.status === 'done'
          ? '<span class="job done">Sent to Jobs</span>'
          : item.status === 'failed'
            ? `<span class="job failed" title="${esc(item.reason ?? '')}">Failed</span>`
            : '<span class="job queued">Staged</span>';
    const refs = item.references?.length
      ? `<div class="queue-refs"><small>Golden Anchors: ${item.references.map((r) => `<code>${esc(r)}</code>`).join(' · ')}</small></div>`
      : '';
    return `
      <tr class="queue-row ${item.status}" data-queue-id="${esc(item.id)}">
        <td class="queue-order">
          <b>#${idx + 1}</b>
          <div class="queue-arrows">
            <button type="button" class="quiet" data-queue-move="${esc(item.id)}" data-dir="-1" title="Move up"${idx === 0 ? ' disabled' : ''}>▲</button>
            <button type="button" class="quiet" data-queue-move="${esc(item.id)}" data-dir="1" title="Move down"${idx === staged.length - 1 ? ' disabled' : ''}>▼</button>
          </div>
        </td>
        <td>
          <b>${href ? `<a href="${esc(href)}" data-art-go>${esc(item.label)}</a>` : esc(item.label)}</b> <small class="tag-pill">${esc(item.category)}</small> <small>(${esc(item.kind)}${item.direction ? ` · ${esc(item.direction)}` : ''})</small>
          ${refs}
          <form class="queue-note-form" data-queue-id="${esc(item.id)}">
            <input name="note" value="${esc(item.note ?? '')}" placeholder="Optional note or custom brief (e.g. warmer rim light, heavier frost)…" />
            <button type="submit" class="quiet">Save note</button>
            <button type="button" class="quiet director-btn" data-queue-harmonize="${esc(item.id)}">✦ Harmonize with Art Director</button>
          </form>
          ${item.harmonizedPrompt ? `<details class="harmonized-preview"><summary>✦ Harmonized Art Director brief</summary><pre class="prompt">${esc(item.harmonizedPrompt)}</pre></details>` : ''}
        </td>
        <td>${statusBadge}${item.reason ? `<br><small class="bad">${esc(item.reason)}</small>` : ''}</td>
        <td>about ${usd(item.estimateUsd)}</td>
        <td class="card-actions">
          ${href ? `<a class="button quiet" href="${esc(href)}" data-art-go>Go to art →</a>` : ''}
          <button type="button" class="quiet" data-queue-review="${esc(item.id)}">Review &amp; Paint</button>
          <button type="button" class="quiet" data-queue-remove="${esc(item.id)}" title="Remove from queue">✕</button>
        </td>
      </tr>`;
  };

  return `
    <div class="studio-split-header">
      <div>
        <h2>"Up Next" Staged Art Queue</h2>
        <p class="note">Stage missing or stand-in art, character turnarounds, walk clips, or repaints here, reorder priority, harmonize prompts with the AI Art Director, and run them sequentially within your monthly budget.</p>
      </div>
      <div class="queue-controls">
        <span class="queue-summary"><b>${staged.length}</b> staged · Est. <b>${usd(totalUsd)}</b> · ${budgetLine(data.budget)}</span>
        <div class="card-actions">
          <button type="button" data-queue-act="run-next"${staged.length && !q.running ? '' : ' disabled'}>▶ Run Next 1</button>
          <button type="button" data-queue-act="run-all"${staged.length && !q.running ? '' : ' disabled'}>⏩ Run Queue (${staged.length})</button>
          <button type="button" class="quiet" data-queue-act="pause"${q.running ? '' : ' disabled'}>⏸ Pause</button>
          ${doneCount ? `<button type="button" class="quiet" data-queue-act="clear-done">Clear Completed (${doneCount})</button>` : ''}
        </div>
      </div>
    </div>
    ${
      q.items.length
        ? `<table class="log queue-table">
            <thead><tr><th>#</th><th>Asset &amp; Brief</th><th>State</th><th>Est. Cost</th><th>Actions</th></tr></thead>
            <tbody>${q.items.map(row).join('')}</tbody>
          </table>`
        : `<p class="note">The "Up Next" queue is empty. Add items from <a href="#missing" data-art-go><b>Missing &amp; Stand-In</b></a> or any studio tab.</p>`
    }
    <h2>Live Painting &amp; Video Jobs Monitor</h2>
    <div id="art-jobs">${jobsHtml(data.jobs, data.budget)}</div>`;
}

export function queueEntryToAsk(e: UpNextEntry): Ask {
  switch (e.kind) {
    case 'paint':
      return { what: 'paint', asset: e.targetId };
    case 'paint-group':
      return { what: 'paint-group', group: e.targetId };
    case 'view':
      return { what: 'view', walker: e.targetId, direction: e.direction ?? 'front-left', ...(e.prompt ? { prompt: e.prompt } : {}) };
    case 'ways':
      return { what: 'ways', walker: e.targetId };
    case 'clip':
      return {
        what: 'clip',
        walker: e.targetId,
        body: e.body ?? 'two-legged',
        direction: e.direction ?? 'front-left',
        ...(e.prompt ? { prompt: e.prompt } : {}),
      };
    case 'sound':
      return { what: 'sound', sound: e.targetId };
    case 'normal':
      return { what: 'normal', asset: e.targetId, ...(e.prompt ? { prompt: e.prompt } : {}) };
    case 'sheet':
      return { what: 'sheet', look: e.targetId };
  }
}

export function handleQueueClick(t: HTMLButtonElement): boolean {
  if (t.dataset.queueAdd !== undefined) {
    const entry = JSON.parse(t.dataset.queueAdd) as {
      kind: UpNextEntry['kind'];
      targetId: string;
      label: string;
      category: string;
      direction?: Facing;
      body?: string;
      estimateUsd: number;
    };
    t.disabled = true;
    void artState.ctx.api<UpNextState>('art/queue', 'POST', { action: 'add', items: [entry] }).then(
      (state) => {
        artState.upNext = state;
        t.textContent = '✓ In Queue';
        t.classList.add('staged');
        artState.ctx.toast(`Added "${entry.label}" to Up Next queue.`);
      },
      (err: Error) => {
        t.disabled = false;
        artState.ctx.toast(err.message);
      },
    );
    return true;
  }

  if (t.dataset.queueMove !== undefined) {
    const id = t.dataset.queueMove;
    const dir = Number(t.dataset.dir || 0);
    const items = artState.upNext?.items ?? [];
    const idx = items.findIndex((i) => i.id === id);
    if (idx >= 0) {
      void artState.ctx.api<UpNextState>('art/queue', 'POST', { action: 'reorder', id, toIndex: Math.max(0, idx + dir) }).then(
        (state) => {
          artState.upNext = state;
          artState.ctx.rerender();
        },
        (err: Error) => artState.ctx.toast(err.message),
      );
    }
    return true;
  }

  if (t.dataset.queueRemove !== undefined) {
    const id = t.dataset.queueRemove;
    void artState.ctx.api<UpNextState>('art/queue', 'POST', { action: 'remove', id }).then(
      (state) => {
        artState.upNext = state;
        artState.ctx.rerender();
      },
      (err: Error) => artState.ctx.toast(err.message),
    );
    return true;
  }

  if (t.dataset.queueReview !== undefined) {
    const entry = artState.upNext?.items.find((i) => i.id === t.dataset.queueReview);
    if (entry) {
      void openReview(queueEntryToAsk(entry), true, entry.note ?? '');
    }
    return true;
  }

  if (t.dataset.queueHarmonize !== undefined) {
    const id = t.dataset.queueHarmonize;
    const entry = artState.upNext?.items.find((i) => i.id === id);
    if (!entry) return true;
    t.disabled = true;
    t.textContent = '✦ Harmonizing…';
    void artState.ctx
      .api<{ harmonizedNote: string; harmonizedPrompt: string; references: string[] }>('art/director', 'POST', {
        action: 'harmonize',
        asset: entry.targetId,
        note: entry.note,
        prompt: entry.prompt,
      })
      .then((res) =>
        artState.ctx.api<UpNextState>('art/queue', 'POST', {
          action: 'update',
          id,
          note: res.harmonizedNote,
          harmonizedPrompt: res.harmonizedPrompt,
          references: res.references,
        }),
      )
      .then(
        (state) => {
          artState.upNext = state;
          artState.ctx.toast('Harmonized with the AI Art Director.');
          artState.ctx.rerender();
        },
        (err: Error) => {
          t.disabled = false;
          t.textContent = '✦ Harmonize with Art Director';
          artState.ctx.toast(err.message);
        },
      );
    return true;
  }

  if (t.dataset.queueAct !== undefined) {
    const action = t.dataset.queueAct;
    t.disabled = true;
    void artState.ctx.api<UpNextState>('art/queue', 'POST', { action }).then(
      (state) => {
        artState.upNext = state;
        artState.ctx.toast(
          action === 'run-next'
            ? 'Started the next staged item.'
            : action === 'run-all'
              ? 'Running the Up Next queue.'
              : action === 'pause'
                ? 'Paused the queue.'
                : 'Cleared completed items.',
        );
        artState.ctx.rerender();
      },
      (err: Error) => {
        t.disabled = false;
        artState.ctx.toast(err.message);
      },
    );
    return true;
  }

  return false;
}

export function handleQueueSubmit(form: HTMLFormElement): boolean {
  if (!form.classList.contains('queue-note-form')) return false;
  const id = form.dataset.queueId!;
  const note = String(new FormData(form).get('note') ?? '').trim();
  void artState.ctx.api<UpNextState>('art/queue', 'POST', { action: 'update', id, note }).then(
    (state) => {
      artState.upNext = state;
      artState.ctx.toast('Saved queue note.');
    },
    (err: Error) => artState.ctx.toast(err.message),
  );
  return true;
}
