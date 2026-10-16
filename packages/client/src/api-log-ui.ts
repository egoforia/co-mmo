// God's View's API Log tab (Owner): every request the server sent to an
// outside service, with what was sent and what came back, keys masked.

import { escapeHtml } from './ui.ts';

interface CallSummary {
  id: string;
  at: number;
  ms: number;
  method: string;
  url: string;
  host: string;
  service: string;
  kind: string;
  model?: string;
  purpose?: string;
  status: number;
  error?: string;
  requestBytes: number;
  responseBytes?: number;
  responseType?: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface Call extends CallSummary {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

interface Page {
  calls: CallSummary[];
  matched: number;
  totals: { errors: number; ms: number; sentBytes: number; receivedBytes: number; inputTokens: number; outputTokens: number };
  choices: { services: string[]; kinds: string[]; models: string[]; purposes: string[]; methods: string[]; statuses: number[] };
  keeping: { days: number; maxBytes: number; usedBytes: number; onDisk: boolean };
}

type Api = <T>(path: string) => Promise<T>;

const PAGE = 100;
const FIELDS = ['service', 'kind', 'model', 'purpose', 'method', 'status', 'text', 'slower'] as const;

/** What the Owner filters by; kept while God's View is open. */
const filters: Record<(typeof FIELDS)[number] | 'from' | 'to', string> = {
  from: '', to: '', service: '', kind: '', model: '', purpose: '', method: '', status: '', text: '', slower: '',
};
let offset = 0;

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 120_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);
const stamp = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const failed = (status: number) => status === 0 || status >= 400;

/** A date-time box's value for a moment, in this browser's time zone. */
function local(at: number): string {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function query(): string {
  const q = new URLSearchParams();
  if (filters.from) q.set('from', String(new Date(filters.from).getTime()));
  // The "to" box names a minute; everything within that minute counts.
  if (filters.to) q.set('to', String(new Date(filters.to).getTime() + 59_999));
  for (const f of FIELDS) {
    if (!filters[f]) continue;
    if (f === 'slower') q.set('slowerThanMs', String(Number(filters.slower) * 1000));
    else q.set(f, filters[f]);
  }
  q.set('offset', String(offset));
  q.set('limit', String(PAGE));
  return q.toString();
}

/** The tab's whole panel. */
export async function apiLogPage(api: Api): Promise<string> {
  const page = await api<Page>(`api-log?${query()}`);
  const select = (name: string, label: string, values: (string | number)[], words: (v: string) => string = (v) => v, first = 'All') => {
    const current = filters[name as keyof typeof filters];
    // A chosen value stays listed even when nothing in this time range has it.
    const all = [...new Set([...values.map(String), ...(current && !['ok', 'error'].includes(current) ? [current] : [])])];
    return `<label>${label}<select name="${name}">
      <option value="">${first}</option>
      ${name === 'status' ? `<option value="ok"${current === 'ok' ? ' selected' : ''}>Worked</option><option value="error"${current === 'error' ? ' selected' : ''}>Went wrong</option>` : ''}
      ${all.map((v) => `<option value="${escapeHtml(v)}"${v === current ? ' selected' : ''}>${escapeHtml(words(v))}</option>`).join('')}
    </select></label>`;
  };
  const t = page.totals;
  const rows = page.calls.map((c) => `
    <tr class="call${failed(c.status) ? ' failed' : ''}" data-call="${c.id}" tabindex="0">
      <td>${stamp(c.at)}</td>
      <td><b>${escapeHtml(c.service)}</b><br><small>${escapeHtml(c.kind)} · ${escapeHtml(c.method)}</small></td>
      <td>${c.model ? `<code>${escapeHtml(c.model)}</code>` : '<small>none</small>'}</td>
      <td>${c.purpose ? escapeHtml(c.purpose) : '<small>not said</small>'}</td>
      <td><span class="status ${failed(c.status) ? 'bad' : 'ok'}">${c.status || 'No answer'}</span>${c.error ? `<br><small class="bad">${escapeHtml(c.error.slice(0, 120))}</small>` : ''}</td>
      <td>${took(c.ms)}</td>
      <td><small>${bytes(c.requestBytes)} sent<br>${c.responseBytes !== undefined ? `${bytes(c.responseBytes)} back` : ''}</small></td>
    </tr>`).join('');
  const shown = page.calls.length ? `${offset + 1} to ${offset + page.calls.length} of ${page.matched}` : '0';
  const keeping = page.keeping.onDisk
    ? `The last ${page.keeping.days} days are kept, up to ${bytes(page.keeping.maxBytes)} (${bytes(page.keeping.usedBytes)} now). Keys and tokens are masked, and pictures, clips and sounds are kept as their size only.`
    : 'This server keeps the log in memory only, so it starts again after a restart.';
  return `<div id="api-log">
    <p class="note">Every request the game sent to a service outside this computer: the AI models, GitHub, sign-in and email. ${keeping}</p>
    <form class="form filters" id="api-log-filters">
      <div class="ranges">
        <button type="button" class="quiet" data-range="1">Last hour</button>
        <button type="button" class="quiet" data-range="24">Last day</button>
        <button type="button" class="quiet" data-range="168">Last week</button>
        <button type="button" class="quiet" data-range="0">All</button>
      </div>
      <div class="filter-row">
        <label>From<input type="datetime-local" name="from" value="${escapeHtml(filters.from)}"></label>
        <label>To<input type="datetime-local" name="to" value="${escapeHtml(filters.to)}"></label>
        ${select('model', 'AI model', page.choices.models)}
        ${select('service', 'Service', page.choices.services)}
        ${select('kind', 'Type', page.choices.kinds)}
        ${select('purpose', 'Why', page.choices.purposes)}
        ${select('status', 'Answer', page.choices.statuses, (v) => (v === '0' ? 'No answer' : v))}
        ${select('method', 'Method', page.choices.methods)}
        <label>Slower than (seconds)<input type="number" name="slower" min="0" step="0.5" value="${escapeHtml(filters.slower)}"></label>
        <label class="wide">Search the address, model, why and errors<input type="search" name="text" value="${escapeHtml(filters.text)}"></label>
      </div>
      <div class="actions"><button type="submit">Show</button><button type="button" class="quiet" data-clear>Clear filters</button><button type="button" class="quiet" data-refresh>Refresh</button></div>
    </form>
    <div class="stats">
      <div class="stat"><b>${page.matched}</b><span>request${page.matched === 1 ? '' : 's'}</span></div>
      <div class="stat ${t.errors ? 'bad' : ''}"><b>${t.errors}</b><span>went wrong</span></div>
      <div class="stat"><b>${page.matched ? took(Math.round(t.ms / page.matched)) : '0 ms'}</b><span>on average</span></div>
      <div class="stat"><b>${bytes(t.sentBytes)}</b><span>sent, ${bytes(t.receivedBytes)} back</span></div>
      ${t.inputTokens || t.outputTokens ? `<div class="stat"><b>${(t.inputTokens + t.outputTokens).toLocaleString()}</b><span>tokens (${t.inputTokens.toLocaleString()} in, ${t.outputTokens.toLocaleString()} out)</span></div>` : ''}
    </div>
    ${rows ? `<table class="log calls">
      <thead><tr><th>When</th><th>Service</th><th>Model</th><th>Why</th><th>Answer</th><th>Took</th><th>Size</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : '<p class="note">No requests match these filters.</p>'}
    <p class="pages"><small>Showing ${shown}.</small>
      ${offset > 0 ? '<button type="button" class="quiet" data-page="-1">Newer</button>' : ''}
      ${offset + page.calls.length < page.matched ? '<button type="button" class="quiet" data-page="1">Older</button>' : ''}
    </p>
  </div>`;
}

function headersHtml(headers: Record<string, string>): string {
  const rows = Object.entries(headers).map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td><code>${escapeHtml(v)}</code></td></tr>`).join('');
  return rows ? `<table class="headers">${rows}</table>` : '<p class="note">None.</p>';
}

function bodyHtml(body: string | undefined, label: string): string {
  if (body === undefined || body === '') return '<p class="note">Empty.</p>';
  return `<div class="body"><button type="button" class="quiet copy" data-copy>Copy ${label}</button><pre>${escapeHtml(body)}</pre></div>`;
}

function detailHtml(c: Call): string {
  const facts = [
    ['Sent', new Date(c.at).toLocaleString()],
    ['Took', took(c.ms)],
    ['Answer', c.status ? String(c.status) : 'No answer'],
    ...(c.error ? [['What went wrong', c.error]] : []),
    ...(c.model ? [['Model', c.model]] : []),
    ...(c.purpose ? [['Why', c.purpose]] : []),
    ['Size sent', bytes(c.requestBytes)],
    ...(c.responseBytes !== undefined ? [['Came back', `${bytes(c.responseBytes)}${c.responseType ? ` (${c.responseType})` : ''}`]] : []),
    ...(c.inputTokens !== undefined ? [['Tokens', `${c.inputTokens.toLocaleString()} in, ${(c.outputTokens ?? 0).toLocaleString()} out`]] : []),
  ];
  return `<div class="call-detail">
    <p><b>${escapeHtml(c.method)}</b> <code class="url">${escapeHtml(c.url)}</code></p>
    <dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k!)}</dt><dd>${escapeHtml(v!)}</dd>`).join('')}</dl>
    <div class="cols">
      <div><h3>Request headers</h3>${headersHtml(c.requestHeaders)}</div>
      <div><h3>Response headers</h3>${headersHtml(c.responseHeaders)}</div>
    </div>
    <h3>Request body</h3>${bodyHtml(c.requestBody, 'request')}
    <h3>Response body</h3>${bodyHtml(c.responseBody, 'response')}
  </div>`;
}

/**
 * Wires the tab's filters, pages and rows inside `root`; `active` says
 * whether the API Log is the tab showing.
 */
export function wireApiLog(root: HTMLElement, api: Api, active: () => boolean, onError: (err: Error) => void): void {
  const redraw = async () => {
    const panel = document.getElementById('panel');
    if (!panel || !active()) return;
    try {
      panel.innerHTML = await apiLogPage(api);
    } catch (err) {
      onError(err as Error);
    }
  };
  const readForm = (form: HTMLFormElement) => {
    const data = new FormData(form);
    for (const key of Object.keys(filters) as (keyof typeof filters)[]) filters[key] = String(data.get(key) ?? '').trim();
    offset = 0;
  };
  root.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement).closest<HTMLFormElement>('#api-log-filters');
    if (!form) return;
    e.preventDefault();
    readForm(form);
    void redraw();
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    // Lists and dates apply at once; words and numbers wait for Show or Enter.
    if (!el.closest('#api-log-filters') || !(el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'datetime-local'))) return;
    readForm(el.closest('form')!);
    void redraw();
  });
  root.addEventListener('click', async (e) => {
    const el = e.target as HTMLElement;
    if (!el.closest('#api-log')) return;
    const range = el.closest<HTMLElement>('[data-range]')?.dataset.range;
    if (range !== undefined) {
      const hours = Number(range);
      filters.from = hours ? local(Date.now() - hours * 3_600_000) : '';
      filters.to = '';
      offset = 0;
      return void redraw();
    }
    if (el.closest('[data-clear]')) {
      for (const key of Object.keys(filters) as (keyof typeof filters)[]) filters[key] = '';
      offset = 0;
      return void redraw();
    }
    if (el.closest('[data-refresh]')) return void redraw();
    const step = el.closest<HTMLElement>('[data-page]')?.dataset.page;
    if (step) {
      offset = Math.max(0, offset + Number(step) * PAGE);
      return void redraw();
    }
    const copy = el.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const text = copy.parentElement?.querySelector('pre')?.textContent ?? '';
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      copy.textContent = 'Copied';
      return;
    }
    const row = el.closest<HTMLTableRowElement>('tr[data-call]');
    if (row) await toggle(row, api);
  });
  root.addEventListener('keydown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-call]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      void toggle(row, api);
    }
  });
}

/** Opens a row's headers and bodies under it, or closes them. */
async function toggle(row: HTMLTableRowElement, api: Api): Promise<void> {
  const next = row.nextElementSibling;
  if (next?.classList.contains('detail')) {
    next.remove();
    row.removeAttribute('aria-expanded');
    return;
  }
  const detail = document.createElement('tr');
  detail.className = 'detail';
  detail.innerHTML = `<td colspan="7"><p class="note">Loading…</p></td>`;
  row.after(detail);
  row.setAttribute('aria-expanded', 'true');
  try {
    const call = await api<Call>(`api-log/${row.dataset.call}`);
    detail.firstElementChild!.innerHTML = detailHtml(call);
  } catch (err) {
    detail.firstElementChild!.innerHTML = `<p class="note bad">${escapeHtml((err as Error).message)}</p>`;
  }
}
