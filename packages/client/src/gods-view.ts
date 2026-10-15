// God's View: the Owner's and Stewards' dashboard (design doc, God's View).
// Plain DOM over the /api/admin endpoints; the session token is the one the
// game saved in this browser.

import { loadToken, rejoinWhenBack, reloadWhenBack } from './api.ts';
import { escapeHtml } from './ui.ts';
import { TICK_SECONDS } from '@co-mmo/shared';

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
  todayUsd?: number;
  dailyUsd?: number;
  overToday?: boolean;
  paused?: boolean;
  why?: string;
  byKind?: Record<string, number>;
  byPlayer?: Record<string, number>;
  byProvider?: Record<string, number>;
  /** The part of the spending that is still a guess (builds whose run has not reported its cost). */
  estimatedUsd?: number;
  calls?: number;
  /** Wish Workshop samples: paid pictures before a wish is sent. */
  workshop?: { samples: boolean; sampleFavor: number };
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
  /** Shaped in the Wish Workshop: its subcategory and, for wishes people build, the player's brief. */
  shaped?: { category: string; brief?: string[] };
  /** What was asked of the image model, by picture id. */
  artPrompts?: Record<string, { prompt: string; references: string[]; note?: string; provider: string; model: string; at: number; usd?: number }>;
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
    image: { provider: string; model: string; uses?: Partial<Record<ArtUse, string>> };
    video: { provider: string; model: string; dailyClips: number };
    sound: { effects: { provider: string; model: string }; music: { provider: string; model: string } };
    styleCheck: { judge: { provider: string; model: string } | null; retries: number; reuse: boolean };
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  imageKeySet: boolean;
  effectsKeySet: boolean;
  /** Walk clips made since Google's daily reset, when walks use Veo. */
  clipsToday?: { count: number; resetsAt: number };
  keys: { name: string; set: boolean; for: string }[];
  catalog: Record<'image' | 'video' | 'music' | 'effects', { model: string; usd: number; per: string }[]>;
}

type ArtUse = 'wishes' | 'buildings' | 'scenery' | 'walks';
const ART_USES: [ArtUse, string][] = [['buildings', 'Buildings and furniture'], ['scenery', 'Scenery and landmarks'], ['wishes', 'Wished things and characters'], ['walks', 'Standing views for walks']];

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

/** The game server is not answering: it is restarting, or stopped. */
class GameDown extends Error {
  constructor() {
    super('The game is starting up. Try again in a moment.');
  }
}

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  // No answer, or the dev proxy saying the server behind it is down.
  if (!res || res.status === 502 || res.status === 503 || res.status === 504) throw new GameDown();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? 'Something went wrong. Try again.');
  return data as T;
}

/** Says the game is starting, and opens God's View again once it answers. */
let waiting = false;
function waitForGame(): void {
  if (waiting) return;
  waiting = true;
  main.innerHTML = '<p class="note">The game is starting up. This page opens by itself when it is ready…</p>';
  void rejoinWhenBack();
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
    // Opened (or reloaded by Vite) while the game restarts after an update.
    if (err instanceof GameDown) return waitForGame();
    main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
    return;
  }
  const tabs = [
    ['world', 'World'],
    ['wishes', 'Wishes'],
    ['rules', 'Rules'],
    ['reports', 'Reports'],
    ['players', 'Players'],
    ...(owner ? [['art', 'Art'], ['ai', 'AI models'], ['budget', 'Budget'], ['servers', 'Server health'], ['updates', 'Updates']] : []),
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
  // Painting moves on its own; keep the log fresh without touching the forms below it.
  setInterval(() => tab === 'art' && document.visibilityState === 'visible' && void refreshArtJobs(), 3000);
  // Region servers report every two seconds.
  setInterval(() => tab === 'servers' && document.visibilityState === 'visible' && void render(), 3000);
}

function show(id: string): void {
  tab = id;
  history.replaceState(null, '', `#${id}`);
  for (const b of main.querySelectorAll<HTMLElement>('[data-tab]')) b.toggleAttribute('aria-current', b.dataset.tab === id);
  void render();
}

async function render(): Promise<void> {
  if (waiting) return;
  const panel = document.getElementById('panel')!;
  const current = tab;
  try {
    const pages: Record<string, () => Promise<string>> = { world, wishes, rules, reports, players, art, ai, budget, servers, updates };
    const html = await (pages[current] ?? world)();
    if (tab !== current) return;
    // Keep what the Owner is typing when the panel refreshes.
    if (panel.contains(document.activeElement) && current !== 'world') return;
    panel.innerHTML = html;
    if (current === 'world') drawMaps();
  } catch (err) {
    if (err instanceof GameDown) return waitForGame();
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
        ${brief(e)}
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
      <td><b>${escapeHtml(e.title)}</b><br><small>${escapeHtml(e.summary)}</small>${conversation(e)}${artPrompts(e)}</td>
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
  const keys = s.keys.map((k) => `<li><span class="${k.set ? 'ok' : 'missing'}">${k.set ? 'set' : 'not set'}</span> ${escapeHtml(k.name)} <small>${escapeHtml(k.for)}</small></li>`).join('');
  return `
    <h2>The God's language model</h2>
    <form id="ai-form" class="form">
      <label>Model<span><select name="godProvider">${options(s.ai.god.provider)}</select><input name="godModel" value="${escapeHtml(s.ai.god.model)}"></span></label>
      <label>Fallback, if it fails<span><select name="fallbackProvider">${options(s.ai.fallback?.provider ?? '', true)}</select><input name="fallbackModel" value="${escapeHtml(s.ai.fallback?.model ?? '')}" placeholder="default model"></span></label>
      <label>Rule compiler<span><select name="compilerProvider">${options(s.ai.compiler?.provider ?? '', true).replace('>None<', '>Same as the God<')}</select><input name="compilerModel" value="${escapeHtml(s.ai.compiler?.model ?? '')}" placeholder="drafts scripts for Major wishes"></span></label>
      <h3>Pictures, video and sound</h3>
      <label>Pictures<span><select name="imageProvider"><option value="gemini"${s.ai.image.provider === 'gemini' ? ' selected' : ''}>Google AI Studio${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.image.provider === 'none' ? ' selected' : ''}>None (placeholder art only)</option></select><input name="imageModel" list="image-models" value="${escapeHtml(s.ai.image.model)}"></span></label>
      ${ART_USES.map(([use, name]) => `<label class="sub">${name}<span><input name="use-${use}" list="image-models" value="${escapeHtml(s.ai.image.uses?.[use] ?? '')}" placeholder="same as Pictures"></span></label>`).join('')}
      <label>Walk videos<span><select name="videoProvider"><option value="gemini"${s.ai.video.provider === 'gemini' ? ' selected' : ''}>Google Veo${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.video.provider === 'none' ? ' selected' : ''}>None (no new walks)</option></select><input name="videoModel" list="video-models" value="${escapeHtml(s.ai.video.model)}" placeholder="veo-3.1-lite-generate-preview"></span></label>
      <label class="sub">Clips a day<span><input name="dailyClips" type="number" min="0" max="1000" step="1" value="${s.ai.video.dailyClips}"></span></label>
      <p class="note">Google allows only a few Veo clips a day on this key and does not say so when it refuses, so walks stop once this many are made and pick up after Google's reset at 08:00 UTC.${s.clipsToday ? ` Made since the last reset: <b>${s.clipsToday.count} of ${s.ai.video.dailyClips}</b>.` : ''}</p>
      <label>Sound effects<span><select name="effectsProvider"><option value="elevenlabs"${s.ai.sound.effects.provider === 'elevenlabs' ? ' selected' : ''}>ElevenLabs${s.effectsKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.sound.effects.provider === 'none' ? ' selected' : ''}>None (no sound effects)</option></select><input name="effectsModel" list="effects-models" value="${escapeHtml(s.ai.sound.effects.model)}" placeholder="eleven_text_to_sound_v2"></span></label>
      <label>Music<span><select name="musicProvider"><option value="gemini"${s.ai.sound.music.provider === 'gemini' ? ' selected' : ''}>Google Lyria${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.sound.music.provider === 'none' ? ' selected' : ''}>None (no music)</option></select><input name="musicModel" list="music-models" value="${escapeHtml(s.ai.sound.music.model)}" placeholder="lyria-3-clip-preview"></span></label>
      <h3>Style check</h3>
      <label>Judge<span><select name="judgeProvider">${options(s.ai.styleCheck.judge?.provider ?? '', true).replace('>None<', '>Same as the God<').replace(/>Offline God[^<]*</, '>Free checks only<')}</select><input name="judgeModel" value="${escapeHtml(s.ai.styleCheck.judge?.provider === 'offline' ? '' : s.ai.styleCheck.judge?.model ?? '')}" placeholder="a model that can see pictures"></span></label>
      <label>Paint again when a picture fails<span><select name="retries">${[0, 1, 2].map((n) => `<option value="${n}"${n === s.ai.styleCheck.retries ? ' selected' : ''}>${n === 0 ? 'Never' : n === 1 ? 'Once' : 'Up to twice'}</option>`).join('')}</select></span></label>
      <label class="check"><input type="checkbox" name="reuse"${s.ai.styleCheck.reuse ? ' checked' : ''}> Show an existing picture when a new wish looks the same, instead of painting one</label>
      <p class="note">Every wished picture is checked for free first: a clean background, nothing cut off, no pure black, white or neon. The judge then compares it with the approved anchors and the wish, for well under a cent. A picture that still fails after its retries is shown anyway, marked on the Art tab, and the Stewards are told.</p>
      ${(['image', 'video', 'effects', 'music'] as const).map((kind) => `<datalist id="${kind}-models">${s.catalog[kind].map((m) => `<option value="${escapeHtml(m.model)}">about ${usd(m.usd)} a ${m.per}</option>`).join('')}</datalist>`).join('')}
      <p class="note">Prices per model: ${(['image', 'video', 'effects', 'music'] as const).flatMap((kind) => s.catalog[kind].map((m) => `<code>${escapeHtml(m.model)}</code> about ${usd(m.usd)} a ${m.per}`)).join(' · ')}. A dearer picture model can be used only where it shows most, such as buildings.</p>
      <button type="submit">Save</button>
    </form>
    <p class="note">The offline God needs no key: it understands simple wishes and is always the last fallback. Keys live in the server's environment (the .env file), never here; restart the game after adding one.</p>
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
      <div><h3>Today</h3><ul class="spend"><li><span>Spent today (UTC)</span><b>${usd(b.todayUsd ?? 0)}</b></li><li><span>Daily cap</span><b>${usd(b.dailyUsd ?? 0)}</b></li></ul>${b.overToday ? '<p class="note bad">Today\'s cap is reached: painting and sound wait until midnight UTC, then whatever is missing is made.</p>' : ''}</div>
      <div><h3>By provider</h3><ul class="spend">${list(b.byProvider)}</ul></div>
      <div><h3>By kind</h3><ul class="spend">${list(b.byKind)}</ul></div>
      <div><h3>By player</h3><ul class="spend">${list(b.byPlayer)}</ul></div>
    </div>
    <h2>Limits</h2>
    <form id="budget-form" class="form">
      <label>Monthly ceiling (USD)<span><input name="monthlyUsd" type="number" min="0" step="1" value="${b.monthlyUsd}"></span></label>
      <label>Warn at (USD)<span><input name="warnUsd" type="number" min="0" step="1" value="${b.warnUsd}"></span></label>
      <label>Daily cap (USD): painting, walks and sound pause for the day once spending reaches it<span><input name="dailyUsd" type="number" min="0" step="0.5" value="${b.dailyUsd ?? 10}"></span></label>
      <label class="check"><input type="checkbox" name="samples"${b.workshop?.samples ? ' checked' : ''}> Paint a sample in Wish Workshop previews (one per draft, paid by the player in Favor; paused past the warning line)</label>
      <label>Favor a sample costs<span><input name="sampleFavor" type="number" min="0" max="10" step="1" value="${b.workshop?.sampleFavor ?? 1}"></span></label>
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

// --- Server health -------------------------------------------------------------

interface ServerLoad {
  tickMs: number;
  worstTickMs: number;
  memoryMb: number;
  errors: number;
  lastError?: string;
  host: string;
  pid: number;
  startedAt: number;
}

interface Host {
  id: string;
  kind: 'gateway' | 'region-server';
  regions: { id: string; name: string; players: number }[];
  players: number;
  load: ServerLoad;
  seen: number;
}

/** A tick has this long before the next one is due. */
const TICK_MS = TICK_SECONDS * 1000;

const since = (ms: number) => (ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`);

async function servers(): Promise<string> {
  const s = await api<{ hosts: Host[]; regionServers: boolean; store: string; now: number }>('servers');
  const hostName = (h: Host) => (h.kind === 'gateway' ? 'Game server' : `Region server ${escapeHtml(h.id)}`);
  const card = (h: Host) => {
    const l = h.load;
    // Half a tick is fine; a whole tick means players feel it.
    const busy = l.worstTickMs >= TICK_MS ? 'bad' : l.tickMs >= TICK_MS / 2 ? 'warn' : '';
    const quiet = s.now - h.seen;
    const moveTo = () => s.hosts.filter((o) => o.id !== h.id).map((o) => `<option value="${escapeHtml(o.id)}">${o.kind === 'gateway' ? 'Game server' : escapeHtml(o.id)}</option>`).join('');
    const rows = h.regions.map((r) => `<tr><td><b>${escapeHtml(r.name)}</b></td><td>${r.players} here</td><td class="actions">
        <button type="button" data-region-restart="${escapeHtml(r.id)}" data-players="${r.players}">Restart</button>
        ${s.hosts.length > 1 ? `<select data-move-for="${escapeHtml(r.id)}" aria-label="Move ${escapeHtml(r.name)} to">${moveTo()}</select><button type="button" data-region-move="${escapeHtml(r.id)}" data-players="${r.players}">Move</button>` : ''}
      </td></tr>`).join('');
    return `<div class="host">
      <h3>${hostName(h)}</h3>
      <div class="stats">
        <div class="stat ${busy}"><b>${l.tickMs.toFixed(1)} ms</b><span>a tick on average (slowest ${l.worstTickMs.toFixed(1)} ms of ${TICK_MS} ms)</span></div>
        <div class="stat"><b>${h.players}</b><span>player${h.players === 1 ? '' : 's'} in ${h.regions.length} region${h.regions.length === 1 ? '' : 's'}</span></div>
        <div class="stat"><b>${l.memoryMb} MB</b><span>memory</span></div>
        <div class="stat ${l.errors ? 'warn' : ''}"><b>${l.errors}</b><span>error${l.errors === 1 ? '' : 's'} since it started</span></div>
      </div>
      ${l.lastError ? `<p class="note warn">Last error: ${escapeHtml(l.lastError)}</p>` : ''}
      <p class="note">On ${escapeHtml(l.host)} (process ${l.pid}), running for ${since(s.now - l.startedAt)}${h.kind === 'region-server' ? `, last heard from ${since(quiet)} ago` : ''}.</p>
      ${rows ? `<table class="log">${rows}</table>` : '<p class="note">No regions run here right now.</p>'}
    </div>`;
  };
  const how = s.regionServers
    ? s.hosts.length > 1
      ? 'Regions run on the region servers below. If one stops, its regions come back to the game server within a few seconds, with their players.'
      : 'No region server is running, so every region runs in the game server. Start some with <code>npm run region-server</code> (or <code>REGION_SERVERS</code> with <code>npm run dev</code>).'
    : 'Every region runs in the game server. Set <code>REDIS_URL</code> to let region servers share the work (see docs/scale.md).';
  return `
    <p>${how} The world is kept in ${escapeHtml(s.store)}.</p>
    ${s.hosts.map(card).join('')}
    <p class="note">Restarting a region sets it up again from scratch: creatures respawn, and players inside stay where they stood. Moving a region does the same on another server.</p>`;
}

// --- Art -----------------------------------------------------------------------

interface ArtJob {
  id: string;
  asset: string;
  label: string;
  media: 'picture' | 'clip' | 'sound';
  source: 'start-up' | 'gods-view' | 'wish';
  status: 'queued' | 'waiting' | 'painting' | 'done' | 'failed' | 'skipped';
  estimateUsd: number;
  usd?: number;
  reason?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
}

interface ArtItem {
  id: string;
  name: string;
  url?: string;
  source: 'shipped' | 'painted' | 'redone' | 'missing';
  estimateUsd: number;
  repaintable: boolean;
  why?: string;
  takesNote: boolean;
  versions?: { id: string; url: string }[];
  shippedBack?: boolean;
  check?: { pass: boolean; why?: string; tries: number };
  reused?: string;
}

type WalkStrip = { url: string; frames: number; width: number; height: number; cycleSeconds: number };

interface WalkerView {
  id: string;
  name: string;
  kind: string;
  url?: string;
  walks: Partial<Record<'front' | 'right' | 'back' | 'left', WalkStrip>>;
  estimateUsd: number;
  clipUsd: number;
  viewUsd: number;
}

interface ArtOverview {
  imageModel: string | null;
  videoModel: string | null;
  budget: Budget;
  jobs: ArtJob[];
  groups: { id: string; title: string; note?: string; items: ArtItem[] }[];
  walkers: WalkerView[];
  bodies: { id: string; name: string }[];
  sounds: SoundItem[];
  effectsModel: string | null;
  musicModel: string | null;
}

interface SoundItem {
  id: string;
  name: string;
  kind: 'effect' | 'music';
  url?: string;
  prompt: string;
  estimateUsd: number;
  makeable: boolean;
  why?: string;
}

const DIRECTIONS = [['front', 'towards us'], ['right', 'right'], ['back', 'away'], ['left', 'left']] as const;
const SOURCE: Record<ArtItem['source'], string> = { shipped: 'shipped with the game', painted: 'painted here', redone: 'painted again here', missing: 'not painted yet' };
const STATUS: Record<ArtJob['status'], string> = { queued: 'In line', waiting: 'Waiting for a turn', painting: 'Painting now', done: 'Done', failed: 'Failed', skipped: 'Not painted' };
const MEDIA: Record<ArtJob['media'], string> = { picture: 'picture', clip: 'video clip', sound: 'sound' };
const ASKED: Record<ArtJob['source'], string> = { 'start-up': 'start-up', 'gods-view': "God's View", wish: 'a wish' };
let artBudget: Budget | null = null;

async function art(): Promise<string> {
  const o = await api<ArtOverview>('art');
  artBudget = o.budget;
  return `
    <p class="note">Every picture in the game, and everything being painted. Painting again replaces a picture for everyone; players see it after they reload. Each costs about what its button says, from this month's budget.</p>
    <p>${o.imageModel ? `Pictures: <b>${escapeHtml(o.imageModel)}</b>` : '<b class="bad">No image model is set</b> (AI models tab)'} · ${o.videoModel ? `Walks: <b>${escapeHtml(o.videoModel)}</b>` : 'Walks need Google AI Studio as the image model'}</p>
    <div id="art-jobs">${artJobsHtml(o.jobs, o.budget)}</div>
    <h2>Walk animations</h2>
    <p class="note">One short clip per direction, made from a standing picture of each view. Directions already made are kept, so painting one again only pays for that one.</p>
    <div class="walkers">${o.walkers.map((w) => walkerHtml(w, o.bodies)).join('')}</div>
    <h2>Sounds and music</h2>
    <p class="note">Effects: ${o.effectsModel ? `<b>${escapeHtml(o.effectsModel)}</b>` : '<b class="bad">no service set</b> (AI models tab; ElevenLabs needs ELEVENLABS_API_KEY)'} · Music: ${o.musicModel ? `<b>${escapeHtml(o.musicModel)}</b>` : '<b class="bad">no service set</b> (AI models tab)'}. Each land has its own looping track. Making one again keeps the old file on the server.</p>
    <div class="sounds">${o.sounds.map(soundHtml).join('')}</div>
    ${o.groups.map((g) => `
      <h2>${escapeHtml(g.title)}</h2>
      ${g.note ? `<p class="note">${escapeHtml(g.note)}</p>` : ''}
      ${groupRepaintHtml(g)}
      <div class="art-grid">${g.items.map(artItemHtml).join('')}</div>`).join('')}`;
}

function artJobsHtml(jobs: ArtJob[], b: Budget): string {
  const open = jobs.filter((j) => j.status === 'queued' || j.status === 'waiting' || j.status === 'painting');
  const done = jobs.filter((j) => !open.includes(j)).slice(0, 30);
  const waiting = open.reduce((n, j) => n + j.estimateUsd, 0);
  const row = (j: ArtJob) => `
    <tr class="${j.status}">
      <td>${when(j.endedAt ?? j.startedAt ?? j.queuedAt)}</td>
      <td><b>${escapeHtml(j.label)}</b><br><small>${MEDIA[j.media]} · asked by ${ASKED[j.source]}</small></td>
      <td><span class="job ${j.status}">${STATUS[j.status]}</span>${j.reason ? `<br><small>${escapeHtml(j.reason)}</small>` : ''}</td>
      <td>${j.usd !== undefined ? usd(j.usd) : `about ${usd(j.estimateUsd)}`}</td>
    </tr>`;
  return `
    <h2>Painting now</h2>
    <p class="note">Each model is asked only as often as Google allows (video: 2 clips a minute, one at a time), so some requests wait their turn. Requests still waiting when the server restarts are painted after it starts again.</p>
    <p>${usd(b.spentUsd)} of ${usd(b.monthlyUsd)} spent this month${b.paused ? ` · <b class="bad">${escapeHtml(b.why ?? 'Nothing more is painted for now.')}</b>` : b.warn ? ' · Past the warning line.' : ''}${open.length ? ` · ${open.length} waiting or painting, about ${usd(waiting)} more` : ''}</p>
    ${open.length ? `<table class="log jobs">${open.map(row).join('')}</table>` : '<p class="note">Nothing is being painted right now.</p>'}
    ${done.length ? `<details${open.length ? '' : ' open'}><summary>Painted lately (${done.length})</summary><table class="log jobs">${done.map(row).join('')}</table></details>` : '<p class="note">Nothing painted since the server started.</p>'}`;
}

async function refreshArtJobs(): Promise<void> {
  const box = document.getElementById('art-jobs');
  if (!box) return;
  const { jobs, budget: b } = await api<{ jobs: ArtJob[]; budget: Budget }>('art/jobs').catch(() => ({ jobs: null, budget: null }));
  if (!jobs || !b || tab !== 'art') return;
  artBudget = b;
  const open = box.querySelector('details')?.open;
  box.innerHTML = artJobsHtml(jobs, b);
  const details = box.querySelector('details');
  if (details && open !== undefined) details.open = open;
}

/** Paints a whole group again, say after choosing a better model for it; each picture's old version is kept. */
function groupRepaintHtml(g: { id: string; title: string; items: ArtItem[] }): string {
  const items = g.items.filter((i) => i.repaintable && i.source !== 'missing');
  if (items.length < 2) return '';
  const total = items.reduce((n, i) => n + i.estimateUsd, 0);
  return `<form class="form art-group" data-group="${escapeHtml(g.id)}" data-name="${escapeHtml(g.title)}" data-count="${items.length}" data-usd="${total}"><button type="submit" class="quiet">Paint all ${items.length} again with today's model · about ${usd(total)}</button></form>`;
}

/** Earlier versions of a picture, and the shipped one, each of which can be put back for free. */
function versionsHtml(item: ArtItem): string {
  const back = (version: string, label: string) => `<form class="art-restore" data-asset="${escapeHtml(item.id)}" data-version="${escapeHtml(version)}"><button type="submit" class="quiet">${label}</button></form>`;
  if (!item.versions?.length && !item.shippedBack) return '';
  return `
    <details><summary>Earlier versions${item.versions?.length ? ` (${item.versions.length})` : ''}</summary>
      <div class="versions">
        ${(item.versions ?? []).map((v) => `<figure><img src="${escapeHtml(v.url)}" alt="" loading="lazy">${back(v.id, 'Use this one')}</figure>`).join('')}
        ${item.shippedBack ? back('shipped', 'Back to the shipped picture') : ''}
      </div>
    </details>`;
}

function artItemHtml(item: ArtItem): string {
  const picture = item.url ? `<img src="${escapeHtml(item.url)}" alt="" loading="lazy">` : '<span class="ph">?</span>';
  const form = item.repaintable ? `
    <details><summary>Paint again · about ${usd(item.estimateUsd)}</summary>
      <form class="form art-paint" data-asset="${escapeHtml(item.id)}" data-name="${escapeHtml(item.name)}" data-usd="${item.estimateUsd}">
        ${item.takesNote ? '<label>Anything to change? (optional)<span><textarea name="note" rows="2" maxlength="1000" placeholder="warmer light, a mossier roof"></textarea></span></label>' : ''}
        <button type="submit">Paint again</button>
      </form>
    </details>` : item.why ? `<small>${escapeHtml(item.why)}</small>` : '';
  const check = item.reused ? `<br><small>Shows the picture of ${escapeHtml(item.reused)}</small>`
    : item.check && !item.check.pass ? `<br><small class="bad">Style check not passed after ${item.check.tries} ${item.check.tries === 1 ? 'try' : 'tries'}: ${escapeHtml(item.check.why ?? '')}</small>`
    : item.check ? `<br><small>Style check passed${item.check.tries > 1 ? ` on try ${item.check.tries}` : ''}</small>` : '';
  return `<figure class="art-item ${item.source}${item.check && !item.check.pass ? ' flagged' : ''}">${picture}<figcaption><b>${escapeHtml(item.name)}</b><br><small>${SOURCE[item.source]}</small>${check}${form}${versionsHtml(item)}</figcaption></figure>`;
}

function soundHtml(s: SoundItem): string {
  const form = s.makeable ? `
    <details><summary>Make again · about ${usd(s.estimateUsd)}</summary>
      <form class="form art-sound" data-sound="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}" data-usd="${s.estimateUsd}">
        <label>Anything to change? (optional)<span><textarea name="note" rows="2" maxlength="1000" placeholder="${s.kind === 'music' ? 'slower, more flute' : 'softer, less metallic'}"></textarea></span></label>
        <button type="submit">Make again</button>
      </form>
    </details>` : `<small>${escapeHtml(s.why ?? '')}</small>`;
  return `
    <div class="sound ${s.url ? '' : 'missing'}">
      <b>${escapeHtml(s.name)}</b> <small>${s.kind === 'music' ? 'music' : 'effect'}${s.url ? '' : ' · not made yet'}</small>
      ${s.url ? `<audio controls preload="none" src="${escapeHtml(s.url)}"${s.kind === 'music' ? ' loop' : ''}></audio>` : ''}
      <details><summary>What the service is asked</summary><pre>${escapeHtml(s.prompt)}</pre></details>
      ${form}
    </div>`;
}

function walkStripHtml(strip: WalkStrip | undefined, label: string): string {
  if (!strip) return `<div class="walk none" title="${label}: no walk yet"><span>${label}</span></div>`;
  const frameWidth = strip.width / strip.frames;
  const height = 72;
  const width = Math.round((frameWidth * height) / strip.height);
  return `<div class="walk" title="${label}"><i style="width:${width}px;height:${height}px;background-image:url('${escapeHtml(strip.url)}');background-size:${strip.frames * 100}% 100%;animation-duration:${strip.cycleSeconds}s;--steps:${strip.frames}"></i><span>${label}</span></div>`;
}

function walkerHtml(w: WalkerView, bodies: ArtOverview['bodies']): string {
  const made = DIRECTIONS.filter(([d]) => w.walks[d]).length;
  const bodyPick = `<label>Body<span><select name="body">${bodies.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('')}</select></span></label>`;
  return `
    <div class="walker">
      <header>${w.url ? `<img src="${escapeHtml(w.url)}" alt="">` : ''}<div><b>${escapeHtml(w.name)}</b><br><small>${escapeHtml(w.kind)} · ${made === 4 ? 'walks every way' : made ? `walks ${made} of 4 ways` : 'no walks yet'}</small></div></header>
      <div class="walks">${DIRECTIONS.map(([d, label]) => walkStripHtml(w.walks[d], label)).join('')}</div>
      ${made < 4 ? `
        <form class="form art-walk" data-walker="${escapeHtml(w.id)}" data-name="${escapeHtml(w.name)}" data-usd="${w.estimateUsd}">
          ${bodyPick}
          <button type="submit">Make ${made ? 'the missing walks' : 'walks'} · about ${usd(w.estimateUsd)}</button>
        </form>` : ''}
      ${made ? `
        <details><summary>Paint some directions again</summary>
          <form class="form art-walk" data-walker="${escapeHtml(w.id)}" data-name="${escapeHtml(w.name)}" data-clip="${w.clipUsd}" data-view="${w.viewUsd}">
            <span class="dirs">${DIRECTIONS.map(([d, label]) => `<label class="check"><input type="checkbox" name="dir-${d}"> ${label}</label>`).join('')}</span>
            <label class="check"><input type="checkbox" name="views"> Paint their standing pictures again too (about ${usd(w.viewUsd)} each)</label>
            ${bodyPick}
            <button type="submit">Paint again · about ${usd(w.clipUsd)} a direction</button>
          </form>
        </details>` : ''}
    </div>`;
}

/** Asks before spending, with the cost and what is left of the month's budget. */
function confirmSpend(what: string, cost: number): boolean {
  const b = artBudget;
  const left = b ? ` This month: ${usd(b.spentUsd)} of ${usd(b.monthlyUsd)} spent.` : '';
  return confirm(`${what} for about ${usd(cost)}?${left} Retries after a bad result can cost up to twice that.`);
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
    } else if (t.dataset.regionRestart || t.dataset.regionMove) {
      const region = (t.dataset.regionRestart ?? t.dataset.regionMove)!;
      const to = t.dataset.regionMove ? main.querySelector<HTMLSelectElement>(`select[data-move-for="${CSS.escape(region)}"]`)?.value : undefined;
      const players = Number(t.dataset.players);
      if (players && !confirm(`${players} player${players === 1 ? ' is' : 's are'} in this region. They stay where they stand but may notice a short pause. Go ahead?`)) return;
      t.disabled = true;
      const r = await api<{ message: string }>('servers/move', 'POST', { region, ...(to ? { to } : {}) });
      toast(r.message);
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
        image: { provider: f.imageProvider, model: f.imageModel, uses: Object.fromEntries(ART_USES.map(([use]) => [use, f[`use-${use}`] ?? ''])) },
        video: { provider: f.videoProvider, model: f.videoModel, dailyClips: f.dailyClips },
        sound: { effects: { provider: f.effectsProvider, model: f.effectsModel }, music: { provider: f.musicProvider, model: f.musicModel } },
        styleCheck: { judge: f.judgeProvider ? { provider: f.judgeProvider, model: f.judgeModel } : null, retries: Number(f.retries), reuse: f.reuse === 'on' },
      });
      toast('Saved. The next prayer uses these models.');
    } else if (form.id === 'ai-test') {
      const out = document.getElementById('ai-result')!;
      out.hidden = false;
      out.textContent = 'Asking…';
      const r = await api<{ provider: string; model: string; reply: unknown; usd: number }>('ai/test', 'POST', { prompt: f.prompt });
      out.textContent = `${label(r.provider)} · ${r.model} · ${usd(r.usd)}\n\n${JSON.stringify(r.reply, null, 2)}`;
      return;
    } else if (form.classList.contains('art-paint')) {
      if (!confirmSpend(`Paint "${form.dataset.name}" again`, Number(form.dataset.usd))) return;
      await api('art/paint', 'POST', { asset: form.dataset.asset, note: f.note ?? '' });
      toast('Asked. Follow it under Painting now.');
    } else if (form.classList.contains('art-group')) {
      if (!confirmSpend(`Paint all ${form.dataset.count} pictures of "${form.dataset.name}" again`, Number(form.dataset.usd))) return;
      const r = await api<{ count: number }>('art/paint-group', 'POST', { group: form.dataset.group });
      toast(`Asked for ${r.count} pictures. The old ones are kept under Earlier versions; follow the painting under Painting now.`);
    } else if (form.classList.contains('art-restore')) {
      await api('art/restore', 'POST', { asset: form.dataset.asset, version: form.dataset.version });
      toast('Put back. Players see it after they reload.');
    } else if (form.classList.contains('art-sound')) {
      if (!confirmSpend(`Make "${form.dataset.name}" again`, Number(form.dataset.usd))) return;
      await api('art/sound', 'POST', { sound: form.dataset.sound, note: f.note ?? '' });
      toast('Asked. Follow it under Painting now.');
    } else if (form.classList.contains('art-walk')) {
      const directions = ['front', 'right', 'back', 'left'].filter((d) => f[`dir-${d}`] === 'on');
      const redo = form.dataset.clip !== undefined;
      if (redo && !directions.length) return toast('Pick at least one direction.');
      const views = f.views === 'on';
      const cost = redo ? directions.length * (Number(form.dataset.clip) + (views ? Number(form.dataset.view) : 0)) : Number(form.dataset.usd);
      if (!confirmSpend(redo ? `Paint ${form.dataset.name} walking ${directions.length === 1 ? 'one way' : `${directions.length} ways`} again` : `Make ${form.dataset.name} walk`, cost)) return;
      await api('art/walk', 'POST', { walker: form.dataset.walker, body: f.body, directions, views });
      toast('Asked. Clips take a minute or two each; follow them under Painting now.');
    } else if (form.dataset.repaint) {
      await api(`content/${form.dataset.repaint}/paint`, 'POST', { picture: form.dataset.picture, prompt: f.prompt ?? '' });
      toast('Painting with your words. The new art appears in a few seconds.');
    } else if (form.id === 'budget-form') {
      await api('budget', 'PUT', { monthlyUsd: Number(f.monthlyUsd), warnUsd: Number(f.warnUsd), dailyUsd: Number(f.dailyUsd), samples: f.samples === 'on', sampleFavor: Number(f.sampleFavor) });
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
  if (input && provider && /Provider$/.test(select.name) && !['imageProvider', 'videoProvider', 'effectsProvider', 'musicProvider'].includes(select.name)) input.value = provider.defaultModel;
});

void boot();
