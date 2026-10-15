// God's View: the Owner's and Stewards' dashboard (design doc, God's View).
// Plain DOM over the /api/admin endpoints; the session token is the one the
// game saved in this browser.

import { loadToken, reloadWhenBack } from './api.ts';
import { escapeHtml } from './ui.ts';

const token = loadToken();
const main = document.getElementById('main')!;

interface Region {
  id: string;
  name: string;
  biome: string;
  /** Its square on the world grid. */
  at: { x: number; y: number };
  /** Wished regions: who wished it, and how dangerous it is. */
  wisher?: string;
  danger?: number;
  width: number;
  height: number;
  players: { id: string; name: string; x: number; y: number; level?: number }[];
  creatures: { kind: string; x: number; y: number; alive: boolean }[];
  npcs: { name: string; x: number; y: number }[];
  landmarks: { asset: string; x: number; y: number }[];
}

interface Budget {
  spentUsd: number;
  monthlyUsd: number;
  warnUsd: number;
  over: boolean;
  warn: boolean;
  byKind?: Record<string, number>;
  byPlayer?: Record<string, number>;
  byProvider?: Record<string, number>;
  /** The part of the spending that is still a guess (builds whose run has not reported its cost). */
  estimatedUsd?: number;
  calls?: number;
}

interface Entry {
  id: string;
  wisher: { id: string; name: string };
  regionId: string;
  at: number;
  tier: string;
  title: string;
  summary: string;
  status: string;
  favor: number;
  definition?: {
    kind: string;
    name: string;
    description: string;
    howTo?: string;
    items?: Record<string, { name: string; description: string; itemKind: string; heal?: number }>;
    script?: string;
  };
  art?: string;
  kitArt?: Record<string, string>;
  itemArt?: Record<string, string>;
  conversation?: { role: string; content: string }[];
  usd?: number;
  draft?: { state: 'drafting' | 'ready' | 'failed' | 'impossible'; at: number; message?: string; model?: string; note?: string };
  test?: { passed: boolean; at: number; summary: string[]; errors: string[]; sample: string[] };
  rule?: { paused: boolean; reason?: string };
  build?: Build;
  progress?: { state: 'in-progress' | 'needs-input' | 'error' | 'done' | 'closed'; label: string; detail?: string; link?: string };
  live?: { paused: boolean; reason?: string; runs: number; errors: { at: number; message: string }[]; effects: Record<string, number>; events: string[]; timers: number } | null;
}

interface Build {
  state: 'queued' | 'building' | 'review' | 'merged' | 'live' | 'failed' | 'closed' | 'split';
  at: number;
  note?: string;
  allowCore?: boolean;
  issue?: { number: number; url: string };
  pr?: { number: number; url: string };
  message?: string;
  tries?: number;
}

interface BuildsInfo {
  settings: { agent: 'claude' | 'manual'; dailyLimit: number; usdPerBuild: number };
  connection: { connected: boolean; repo: string | null; reason?: string; lastError?: string; lastSync: number | null };
  today: number;
}

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

interface AiSettings {
  ai: {
    god: { provider: string; model: string };
    fallback: { provider: string; model: string } | null;
    compiler?: { provider: string; model: string } | null;
    image: { provider: string; model: string };
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  imageKeySet: boolean;
}

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

let owner = false;
let tab = 'world';

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Request failed (${res.status})`);
  return data as T;
}

function toast(text: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4000);
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function boot(): Promise<void> {
  if (!token) {
    main.innerHTML = '<p class="note">Sign in to the game in this browser first, then come back.</p>';
    return;
  }
  try {
    const overview = await api<{ you: { name: string; role: string } }>('overview');
    owner = overview.you.role === 'owner';
    document.getElementById('you')!.textContent = `${overview.you.name} · ${overview.you.role === 'owner' ? 'Owner' : 'Steward'}`;
  } catch (err) {
    main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
    return;
  }
  const tabs = [
    ['world', 'World'],
    ['wishes', 'Wishes'],
    ['rules', 'Rules'],
    ['reports', 'Reports'],
    ['players', 'Players'],
    ...(owner ? [['ai', 'AI models'], ['budget', 'Budget'], ['updates', 'Updates']] : []),
  ];
  main.innerHTML = `
    <nav>${tabs.map(([id, label]) => `<button type="button" data-tab="${id}">${label}</button>`).join('')}</nav>
    <section id="panel"></section>`;
  main.querySelector('nav')!.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (id) show(id);
  });
  show(location.hash.slice(1) || 'world');
  addEventListener('hashchange', () => show(location.hash.slice(1) || 'world'));
  // The world moves; keep the map fresh while it is open.
  setInterval(() => tab === 'world' && document.visibilityState === 'visible' && void render(), 3000);
}

function show(id: string): void {
  tab = id;
  history.replaceState(null, '', `#${id}`);
  for (const b of main.querySelectorAll<HTMLElement>('[data-tab]')) b.toggleAttribute('aria-current', b.dataset.tab === id);
  void render();
}

async function render(): Promise<void> {
  const panel = document.getElementById('panel')!;
  const current = tab;
  try {
    const pages: Record<string, () => Promise<string>> = { world, wishes, rules, reports, players, ai, budget, updates };
    const html = await (pages[current] ?? world)();
    if (tab !== current) return;
    // Keep what the Owner is typing when the panel refreshes.
    if (panel.contains(document.activeElement) && current !== 'world') return;
    panel.innerHTML = html;
    if (current === 'world') drawMaps();
  } catch (err) {
    panel.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
  }
}

// --- World ---------------------------------------------------------------------

let regions: Region[] = [];

async function world(): Promise<string> {
  const o = await api<{ regions: Region[]; online: number; recent: Entry[]; queue: number; reports: number; rules: number; budget: Budget | null; update: { behind: number; blocked?: string } | null; building: number }>('overview');
  regions = o.regions;
  // The world grid, one square per region; it grows as regions are wished.
  const xs = regions.map((r) => r.at.x);
  const ys = regions.map((r) => r.at.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const columns = Math.max(...xs) + 1 - left;
  const rows = Math.max(...ys) + 1 - top;
  const byCell = new Map(regions.map((r) => [`${r.at.x},${r.at.y}`, r]));
  const cell = (x: number, y: number) => {
    const r = byCell.get(`${x},${y}`);
    if (!r) return '<div></div>';
    const alive = r.creatures.filter((c) => c.alive).length;
    const credit = r.wisher ? `<br><small>wished by ${escapeHtml(r.wisher)} · danger ${r.danger}</small>` : '';
    return `<figure class="region ${r.id} ${escapeHtml(r.biome)}"><canvas data-region="${r.id}" width="${r.width * 4}" height="${r.height * 4}"></canvas>
      <figcaption><b>${escapeHtml(r.name)}</b> · ${r.players.length} here · ${alive} creatures${credit}</figcaption></figure>`;
  };
  const grid: string[] = [];
  for (let y = top; y < top + rows; y++) for (let x = left; x < left + columns; x++) grid.push(cell(x, y));
  const b = o.budget;
  const budgetCard = b
    ? `<div class="stat ${b.over ? 'bad' : b.warn ? 'warn' : ''}"><b>${usd(b.spentUsd)}</b><span>spent of ${usd(b.monthlyUsd)} this month</span></div>`
    : '';
  return `
    <div class="stats">
      <div class="stat"><b>${o.online}</b><span>online now</span></div>
      <div class="stat ${o.queue ? 'warn' : ''}"><b>${o.queue}</b><span>wishes waiting for review</span></div>
      <div class="stat ${o.reports ? 'warn' : ''}"><b>${o.reports}</b><span>open reports</span></div>
      <div class="stat"><b>${o.rules}</b><span>scripted rules live</span></div>
      ${o.building ? `<a class="stat" href="#wishes"><b>${o.building}</b><span>wish${o.building === 1 ? '' : 'es'} being built</span></a>` : ''}
      ${budgetCard}
      ${o.update?.behind ? `<a class="stat warn" href="#updates"><b>${o.update.behind}</b><span>new commit${o.update.behind === 1 ? '' : 's'} on main</span></a>` : ''}
    </div>
    <div class="map" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr)); max-width: ${columns * 300}px">${grid.join('')}</div>
    <p class="legend"><i class="p"></i> players <i class="c"></i> creatures <i class="n"></i> people <i class="l"></i> landmarks</p>
    <h2>Latest wishes</h2>
    ${o.recent.length ? `<ul class="recent">${o.recent.map((e) => `<li><b>${escapeHtml(e.title)}</b> by ${escapeHtml(e.wisher.name)} · ${when(e.at)}</li>`).join('')}</ul>` : '<p class="note">No wishes granted yet.</p>'}`;
}

function drawMaps(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>('canvas[data-region]')) {
    const r = regions.find((x) => x.id === canvas.dataset.region);
    if (!r) continue;
    const ctx = canvas.getContext('2d')!;
    const s = canvas.width / r.width;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dot = (x: number, y: number, size: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x * s, y * s, size, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const l of r.landmarks) dot(l.x, l.y, 5, 'rgba(255,255,255,0.35)');
    for (const n of r.npcs) dot(n.x, n.y, 4, '#6fc3df');
    for (const c of r.creatures) if (c.alive) dot(c.x, c.y, 3, '#f6757a');
    for (const p of r.players) {
      dot(p.x, p.y, 5, '#feae34');
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.fillText(p.name, p.x * s + 7, p.y * s + 4);
    }
  }
}

// --- Wishes --------------------------------------------------------------------

async function wishes(): Promise<string> {
  const { content } = await api<{ content: Entry[] }>('content');
  const pending = content.filter((e) => e.status === 'pending');
  if (pending.some((e) => e.draft?.state === 'drafting')) setTimeout(pollDrafting);
  const queue = pending.length
    ? pending.map((e) => `
      <article class="wish pending">
        <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b>${progress(e)}<small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        <p>${escapeHtml(e.summary)}</p>
        ${conversation(e)}
        ${e.tier === 'major' ? draft(e) : ''}
        ${e.build?.state === 'closed' ? `<p class="note warn">You closed its pull request${e.build.message ? `: ${escapeHtml(e.build.message)}` : '.'} Approve to build it again.</p>` : ''}
        ${e.tier === 'engine' ? engineApproval(e) : `<div class="actions">
          <button type="button" data-review="${e.id}" data-approve="yes"${e.definition?.kind === 'rule' && !e.test?.passed ? ' disabled title="The rule has not passed its test run"' : ''}>${e.definition?.kind === 'rule' ? 'Approve and go live' : 'Approve'}</button>
          ${owner && e.tier === 'major' && e.definition?.kind !== 'rule' ? `<button type="button" class="quiet" data-build="${e.id}" title="A coding agent writes it as a change to the game">Send to be built as code</button>` : ''}
          <button type="button" class="quiet" data-review="${e.id}" data-approve="no">Reject</button>
        </div>`}
      </article>`).join('')
    : '<p class="note">Nothing is waiting. Major and engine wishes appear here for review.</p>';
  const rows = content.map((e) => `
    <tr class="${e.status}">
      <td>${e.art ? `<img src="${escapeHtml(e.art)}" alt="">` : e.definition ? '<span class="ph" title="Placeholder art">✦</span>' : ''}</td>
      <td><b>${escapeHtml(e.title)}</b><br><small>${escapeHtml(e.summary)}</small>${conversation(e)}</td>
      <td><span class="tier ${e.tier}">${e.tier}</span></td>
      <td>${progress(e)}${e.progress?.detail ? `<br><small>${escapeHtml(e.progress.detail)}</small>` : ''}</td>
      <td>${escapeHtml(e.wisher.name)}<br><small>${when(e.at)}</small></td>
      ${owner ? `<td>${e.usd !== undefined ? usd(e.usd) : ''}</td>` : ''}
      <td><div class="actions">
        ${e.status === 'granted' && !e.build ? `<button type="button" class="quiet" data-rollback="${e.id}">Roll back</button>` : ''}
        ${owner && e.build?.state === 'failed' ? `<button type="button" class="quiet" data-build="${e.id}">Try again</button>` : ''}
        ${owner && e.status === 'approved' && !e.build ? `<button type="button" class="quiet" data-build="${e.id}">Build it</button>` : ''}
        ${owner && e.status === 'granted' && e.definition ? `<button type="button" class="quiet" data-paint="${e.id}">${e.art || e.kitArt || e.itemArt ? 'Repaint' : 'Paint'}</button>` : ''}
      </div></td>
    </tr>`).join('');
  const active = content.filter((e) => e.build && ['queued', 'building', 'review', 'merged', 'failed'].includes(e.build.state));
  const building = active.length
    ? active.map((e) => `
      <article class="wish">
        <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b>${progress(e)}<small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        ${e.progress?.detail ? `<p>${escapeHtml(e.progress.detail)}</p>` : ''}
        <p class="links">${e.build!.issue ? `<a href="${escapeHtml(e.build!.issue.url)}" target="_blank" rel="noopener">Issue #${e.build!.issue.number}</a>` : ''}${e.build!.pr ? ` · <a href="${escapeHtml(e.build!.pr.url)}" target="_blank" rel="noopener">Pull request #${e.build!.pr.number}</a>` : ''}${e.build!.tries && e.build!.tries > 1 ? ` · try ${e.build!.tries}` : ''}</p>
        ${owner && e.build!.state === 'failed' ? `<div class="actions"><button type="button" data-build="${e.id}">Try again</button><button type="button" class="quiet" data-reject-built="${e.id}">Give up</button></div>` : ''}
        ${e.build!.state === 'merged' ? '<p class="actions"><a class="button" href="#updates">Open Updates to release it</a></p>' : ''}
      </article>`).join('')
    : '';
  return `
    <h2>Waiting for review</h2>
    ${queue}
    ${building ? `<h2>Being built</h2><p class="note">Approved Engine wishes become GitHub issues. A coding agent writes the change with tests and opens a pull request; you merge it, then release it from Updates.</p>${building}` : ''}
    <h2>Content log</h2>
    <p class="note legend">${progressLegend()}</p>
    ${content.length ? `<table class="log"><thead><tr><th></th><th>Wish</th><th>Tier</th><th>Status</th><th>Wished by</th>${owner ? '<th>Cost</th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">No wishes yet.</p>'}`;
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
  if (!owner) return '<p class="note">Engine wishes change the game\'s code. Only the Owner can approve them.</p>';
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

function conversation(e: Entry): string {
  if (!e.conversation?.length) return '';
  const lines = e.conversation.map((t) => `<li class="${t.role}"><b>${t.role === 'user' ? escapeHtml(e.wisher.name) : 'God'}:</b> ${escapeHtml(t.content)}</li>`).join('');
  return `<details><summary>Conversation</summary><ol class="talk">${lines}</ol></details>`;
}

// --- Rules ---------------------------------------------------------------------

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

// --- Reports -------------------------------------------------------------------

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

// --- Players -------------------------------------------------------------------

async function players(): Promise<string> {
  const { players, you } = await api<{ players: Player[]; you: string }>('players');
  const canSuspend = (p: Player) => p.id !== you && p.role !== 'owner' && (owner || p.role === 'player');
  const rows = players.map((p) => `
    <tr>
      <td><b>${escapeHtml(p.name)}</b>${p.invitedBy ? `<br><small>invited by ${escapeHtml(p.invitedBy)}</small>` : ''}</td>
      <td>${p.role === 'owner' ? 'Owner' : p.role === 'steward' ? 'Steward' : 'Player'}</td>
      <td>${p.suspended ? `<span class="bad">suspended</span><br><small>by ${escapeHtml(p.suspended.by)}${p.suspended.reason ? `: ${escapeHtml(p.suspended.reason)}` : ''}</small>` : p.online ? `<span class="online">online</span> · ${escapeHtml(p.region ?? '')}` : '<small>offline</small>'}</td>
      <td>${p.level}</td>
      <td>${p.favor ?? ''}</td>
      ${owner ? `<td>${p.role === 'owner' ? '' : p.role === 'steward'
        ? `<button type="button" class="quiet" data-role="${p.id}" data-to="player">Remove Steward</button>`
        : `<button type="button" class="quiet" data-role="${p.id}" data-to="steward">Make Steward</button>`}</td>` : ''}
      <td>${canSuspend(p) ? `<button type="button" class="quiet" data-suspend="${p.id}" data-to="${p.suspended ? 'lift' : 'suspend'}">${p.suspended ? 'Lift suspension' : 'Suspend'}</button>` : ''}</td>
    </tr>`).join('');
  return `
    <h2>Players</h2>
    <table class="log"><thead><tr><th>Name</th><th>Role</th><th>Where</th><th>Level</th><th>Favor</th>${owner ? '<th></th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

// --- AI models -----------------------------------------------------------------

let aiState: AiSettings | null = null;

async function ai(): Promise<string> {
  const [settings, b] = await Promise.all([api<AiSettings>('ai'), api<BuildsInfo>('builds')]);
  aiState = settings;
  const s = aiState;
  const options = (selected: string, none = false) =>
    (none ? ['<option value="">None</option>'] : [])
      .concat(s.providers.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${label(p.id)}${p.keySet ? '' : ' (no key)'}</option>`))
      .join('');
  const keys = s.providers.filter((p) => p.keyName).map((p) => `<li><span class="${p.keySet ? 'ok' : 'missing'}">${p.keySet ? 'set' : 'not set'}</span> ${p.keyName}</li>`).join('');
  return `
    <h2>The God's language model</h2>
    <form id="ai-form" class="form">
      <label>Model<span><select name="godProvider">${options(s.ai.god.provider)}</select><input name="godModel" value="${escapeHtml(s.ai.god.model)}"></span></label>
      <label>Fallback, if it fails<span><select name="fallbackProvider">${options(s.ai.fallback?.provider ?? '', true)}</select><input name="fallbackModel" value="${escapeHtml(s.ai.fallback?.model ?? '')}" placeholder="default model"></span></label>
      <label>Rule compiler<span><select name="compilerProvider">${options(s.ai.compiler?.provider ?? '', true).replace('>None<', '>Same as the God<')}</select><input name="compilerModel" value="${escapeHtml(s.ai.compiler?.model ?? '')}" placeholder="drafts scripts for Major wishes"></span></label>
      <label>Images for wishes<span><select name="imageProvider"><option value="gemini"${s.ai.image.provider === 'gemini' ? ' selected' : ''}>Google AI Studio${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.image.provider === 'none' ? ' selected' : ''}>None (placeholder art only)</option></select><input name="imageModel" value="${escapeHtml(s.ai.image.model)}"></span></label>
      <button type="submit">Save</button>
    </form>
    <p class="note">The offline God needs no key: it understands simple wishes and is always the last fallback. Keys live in the server's environment, never here.</p>
    <ul class="keys">${keys}</ul>
    <h2>Try it</h2>
    <form id="ai-test" class="form">
      <label>Prayer<span><input name="prompt" placeholder="I wish for a glowing blue hat"><button type="submit">Ask</button></span></label>
    </form>
    <pre id="ai-result" hidden></pre>
    ${codingAgent(b)}`;
}

/** Who builds Engine wishes, how many a day, and whether GitHub is connected. */
function codingAgent(b: BuildsInfo): string {
  const c = b.connection;
  const status = c.connected
    ? `<p class="note"><b class="ok">Connected</b> to <code>${escapeHtml(c.repo ?? '')}</code>${c.lastSync ? ` · checked ${when(c.lastSync)}` : ''} · ${b.today} of ${b.settings.dailyLimit} builds started today</p>${c.lastError ? `<p class="note bad">${escapeHtml(c.lastError)}</p>` : ''}`
    : `<p class="note warn"><b>Not connected.</b> ${escapeHtml(c.reason ?? '')}</p>`;
  return `
    <h2>Coding agent</h2>
    <p class="note">Builds approved Engine wishes as pull requests on GitHub. It can only open pull requests: you merge them, then release them from Updates.</p>
    ${status}
    <form id="builds-form" class="form">
      <label>Who builds<span><select name="agent">
        <option value="claude"${b.settings.agent === 'claude' ? ' selected' : ''}>Claude Code in GitHub Actions</option>
        <option value="manual"${b.settings.agent === 'manual' ? ' selected' : ''}>A person (the game only opens the issue)</option>
      </select></span></label>
      <label>Builds per day<span><input name="dailyLimit" type="number" min="0" max="20" step="1" value="${b.settings.dailyLimit}"></span></label>
      <label>Guessed cost per build, counted until the run reports its real cost (USD)<span><input name="usdPerBuild" type="number" min="0" max="50" step="0.5" value="${b.settings.usdPerBuild}"></span></label>
      <button type="submit">Save</button>
    </form>
    <p class="actions"><button type="button" class="quiet" data-builds-sync${c.connected ? '' : ' disabled'}>Check GitHub now</button></p>
    ${c.connected ? '' : `<details open><summary>Setting it up (once)</summary><ol class="setup">
      <li>Install the Claude GitHub app on the repository: github.com/apps/claude.</li>
      <li>Add your Anthropic API key to the repository's secrets as <code>ANTHROPIC_API_KEY</code> (Settings, Secrets and variables, Actions).</li>
      <li>Make a fine-grained GitHub token for this repository only, with Issues set to read and write and nothing else. Put it in the server's <code>.env</code> as <code>GITHUB_ISSUES_TOKEN=…</code> and restart the game.</li>
    </ol></details>`}`;
}

const label = (id: string) => ({ gemini: 'Google Gemini', anthropic: 'Anthropic Claude', openai: 'OpenAI-compatible', offline: 'Offline God' })[id] ?? id;

// --- Budget --------------------------------------------------------------------

async function budget(): Promise<string> {
  const b = await api<Budget>('budget');
  const pct = Math.min(100, (100 * b.spentUsd) / Math.max(b.monthlyUsd, 0.0001));
  const list = (o: Record<string, number> = {}) =>
    Object.entries(o).sort((a, c) => c[1] - a[1]).map(([k, v]) => `<li><span>${escapeHtml(k)}</span><b>${usd(v)}</b></li>`).join('') || '<li><span>Nothing yet</span></li>';
  return `
    <h2>This month</h2>
    <div class="budget ${b.over ? 'bad' : b.warn ? 'warn' : ''}">
      <div class="bar"><span style="width:${pct}%"></span><i style="left:${(100 * b.warnUsd) / Math.max(b.monthlyUsd, 0.0001)}%"></i></div>
      <p><b>${usd(b.spentUsd)}</b> of ${usd(b.monthlyUsd)} · ${b.calls ?? 0} paid calls${b.estimatedUsd ? ` · ${usd(b.estimatedUsd)} of it is a guess until those builds report their real cost` : ''}${b.over ? ' · <b>Over the ceiling: the offline God answers and no art is painted.</b>' : b.warn ? ' · Past the warning line.' : ''}</p>
    </div>
    <div class="cols">
      <div><h3>By provider</h3><ul class="spend">${list(b.byProvider)}</ul></div>
      <div><h3>By kind</h3><ul class="spend">${list(b.byKind)}</ul></div>
      <div><h3>By player</h3><ul class="spend">${list(b.byPlayer)}</ul></div>
    </div>
    <h2>Limits</h2>
    <form id="budget-form" class="form">
      <label>Monthly ceiling (USD)<span><input name="monthlyUsd" type="number" min="0" step="1" value="${b.monthlyUsd}"></span></label>
      <label>Warn at (USD)<span><input name="warnUsd" type="number" min="0" step="1" value="${b.warnUsd}"></span></label>
      <button type="submit">Save</button>
    </form>`;
}

// --- Updates -------------------------------------------------------------------

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

// --- Actions -------------------------------------------------------------------

main.addEventListener('click', async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!t) return;
  try {
    if (t.dataset.review) {
      const r = await api<{ status: string }>(`content/${t.dataset.review}/review`, 'POST', { approve: t.dataset.approve === 'yes' });
      toast(r.status === 'granted' ? 'Approved. The rule is live and everyone was told.' : t.dataset.approve === 'yes' ? 'Approved. The wisher has been told.' : 'Rejected. The wisher has been told.');
    } else if (t.dataset.build) {
      const r = await api<{ build?: string }>(`content/${t.dataset.build}/build`, 'POST', {});
      toast(r.build === 'building' ? 'Sent. A coding agent is building it on GitHub.' : 'Queued to be built.');
    } else if (t.dataset.rejectBuilt) {
      if (!confirm('Give up on this wish? The wisher is told it was not approved.')) return;
      await api(`content/${t.dataset.rejectBuilt}/review`, 'POST', { approve: false });
      toast('Rejected. The wisher has been told.');
    } else if (t.dataset.buildsSync !== undefined) {
      t.disabled = true;
      await api('builds/sync', 'POST');
      toast('Checked GitHub.');
    } else if (t.dataset.rollback) {
      if (!confirm('Roll this wish back for everyone? It disappears from the world and from bags.')) return;
      await api(`content/${t.dataset.rollback}/rollback`, 'POST');
      toast('Rolled back.');
    } else if (t.dataset.paint) {
      await api(`content/${t.dataset.paint}/paint`, 'POST');
      toast('Painting. The new art appears in a few seconds.');
    } else if (t.dataset.pause) {
      await api(`content/${t.dataset.pause}/rule`, 'POST', { paused: t.dataset.to === 'pause' });
      toast(t.dataset.to === 'pause' ? 'Paused. Nothing it does happens until you resume it.' : 'Resumed.');
    } else if (t.dataset.suspend) {
      if (t.dataset.to === 'suspend') {
        const reason = prompt('Why? The player sees this.');
        if (reason === null) return;
        await api(`players/${t.dataset.suspend}/suspend`, 'POST', { suspend: true, reason });
        toast('Suspended. They were disconnected.');
      } else {
        await api(`players/${t.dataset.suspend}/suspend`, 'POST', { suspend: false });
        toast('Suspension lifted.');
      }
    } else if (t.dataset.reportRollback) {
      if (!confirm('Roll this wish back for everyone and close the report?')) return;
      await api(`content/${t.dataset.target}/rollback`, 'POST').catch((err: Error) => toast(err.message));
      await api(`reports/${t.dataset.reportRollback}/close`, 'POST', { status: 'resolved', action: 'rolled the wish back' });
      toast('Rolled back. The reporter has been told.');
    } else if (t.dataset.reportSuspend) {
      const reason = prompt('Why? The player sees this.');
      if (reason === null) return;
      await api(`players/${t.dataset.target}/suspend`, 'POST', { suspend: true, reason });
      await api(`reports/${t.dataset.reportSuspend}/close`, 'POST', { status: 'resolved', action: 'suspended the player' });
      toast('Suspended. The reporter has been told.');
    } else if (t.dataset.reportClose) {
      await api(`reports/${t.dataset.reportClose}/close`, 'POST', { status: t.dataset.status });
      toast(t.dataset.status === 'resolved' ? 'Marked handled.' : 'Dismissed.');
    } else if (t.dataset.updateCheck !== undefined) {
      t.disabled = true;
      await api('update/check', 'POST');
    } else if (t.dataset.updatePull !== undefined) {
      if (!confirm('Pull main and restart the game? Everyone is disconnected for a moment.')) return;
      const r = await api<{ from: string }>('update', 'POST');
      main.innerHTML = '<p class="note">Pulling main and restarting. This page reloads when the game is back…</p>';
      void reloadWhenBack(r.from);
      return;
    } else if (t.dataset.role) {
      await api(`players/${t.dataset.role}/role`, 'POST', { role: t.dataset.to });
      toast(t.dataset.to === 'steward' ? 'Appointed. The God has told them.' : 'Steward role removed.');
    } else return;
    (document.activeElement as HTMLElement | null)?.blur();
    void render();
  } catch (err) {
    toast((err as Error).message);
  }
});

main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
  try {
    if (form.dataset.approveEngine) {
      const r = await api<{ build?: string }>(`content/${form.dataset.approveEngine}/review`, 'POST', { approve: true, note: f.note ?? '', allowCore: f.allowCore === 'on' });
      toast(r.build === 'building' ? 'Approved. A coding agent is building it on GitHub.' : 'Approved and queued to be built.');
    } else if (form.id === 'builds-form') {
      await api('builds', 'PUT', { agent: f.agent, dailyLimit: Number(f.dailyLimit), usdPerBuild: Number(f.usdPerBuild) });
      toast('Saved.');
    } else if (form.dataset.revise) {
      await api(`content/${form.dataset.revise}/revise`, 'POST', { note: f.note ?? '' });
      toast('The God is drafting. The new version appears here when its test run is done.');
      pollDrafting();
    } else if (form.id === 'ai-form') {
      await api('ai', 'PUT', {
        god: { provider: f.godProvider, model: f.godModel },
        fallback: f.fallbackProvider ? { provider: f.fallbackProvider, model: f.fallbackModel } : null,
        compiler: f.compilerProvider ? { provider: f.compilerProvider, model: f.compilerModel } : null,
        image: { provider: f.imageProvider, model: f.imageModel },
      });
      toast('Saved. The next prayer uses these models.');
    } else if (form.id === 'ai-test') {
      const out = document.getElementById('ai-result')!;
      out.hidden = false;
      out.textContent = 'Asking…';
      const r = await api<{ provider: string; model: string; reply: unknown; usd: number }>('ai/test', 'POST', { prompt: f.prompt });
      out.textContent = `${label(r.provider)} · ${r.model} · ${usd(r.usd)}\n\n${JSON.stringify(r.reply, null, 2)}`;
      return;
    } else if (form.id === 'budget-form') {
      await api('budget', 'PUT', { monthlyUsd: Number(f.monthlyUsd), warnUsd: Number(f.warnUsd) });
      toast('Budget saved.');
    }
    (document.activeElement as HTMLElement | null)?.blur();
    void render();
  } catch (err) {
    toast((err as Error).message);
  }
});

/** While a rule is being drafted, refresh the Wishes tab until it is done. */
let polling = 0;
function pollDrafting(): void {
  clearInterval(polling);
  polling = window.setInterval(async () => {
    if (tab !== 'wishes') return clearInterval(polling);
    const { content } = await api<{ content: Entry[] }>('content').catch(() => ({ content: [] as Entry[] }));
    if (!content.some((e) => e.draft?.state === 'drafting')) {
      clearInterval(polling);
      (document.activeElement as HTMLElement | null)?.blur();
      void render();
    }
  }, 2000);
}

// A provider change suggests its default model.
main.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement;
  const input = select.parentElement?.querySelector<HTMLInputElement>('input');
  const provider = aiState?.providers.find((p) => p.id === select.value);
  if (input && provider && /Provider$/.test(select.name) && select.name !== 'imageProvider') input.value = provider.defaultModel;
});

void boot();
