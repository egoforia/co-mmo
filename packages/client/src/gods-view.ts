// God's View: the Owner's and Stewards' dashboard (design doc, God's View).
// Plain DOM over the /api/admin endpoints; the session token is the one the
// game saved in this browser.

import { loadToken } from './api.ts';
import { escapeHtml } from './ui.ts';

const token = loadToken();
const main = document.getElementById('main')!;

interface Region {
  id: string;
  name: string;
  biome: string;
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
  definition?: { kind: string; name: string; description: string };
  art?: string;
  conversation?: { role: string; content: string }[];
  usd?: number;
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
}

interface AiSettings {
  ai: {
    god: { provider: string; model: string };
    fallback: { provider: string; model: string } | null;
    image: { provider: string; model: string };
  };
  providers: { id: string; keySet: boolean; keyName: string | null; defaultModel: string }[];
  imageKeySet: boolean;
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
    ['players', 'Players'],
    ...(owner ? [['ai', 'AI models'], ['budget', 'Budget']] : []),
  ];
  main.innerHTML = `
    <nav>${tabs.map(([id, label]) => `<button type="button" data-tab="${id}">${label}</button>`).join('')}</nav>
    <section id="panel"></section>`;
  main.querySelector('nav')!.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (id) show(id);
  });
  show(location.hash.slice(1) || 'world');
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
    const html = current === 'world' ? await world() : current === 'wishes' ? await wishes() : current === 'players' ? await players() : current === 'ai' ? await ai() : await budget();
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
  const o = await api<{ regions: Region[]; online: number; recent: Entry[]; queue: number; budget: Budget | null }>('overview');
  regions = o.regions;
  const byId = new Map(regions.map((r) => [r.id, r]));
  const cell = (id: string) => {
    const r = byId.get(id);
    if (!r) return '<div></div>';
    const alive = r.creatures.filter((c) => c.alive).length;
    return `<figure class="region ${r.id}"><canvas data-region="${r.id}" width="${r.width * 4}" height="${r.height * 4}"></canvas>
      <figcaption><b>${escapeHtml(r.name)}</b> · ${r.players.length} here · ${alive} creatures</figcaption></figure>`;
  };
  const b = o.budget;
  const budgetCard = b
    ? `<div class="stat ${b.over ? 'bad' : b.warn ? 'warn' : ''}"><b>${usd(b.spentUsd)}</b><span>spent of ${usd(b.monthlyUsd)} this month</span></div>`
    : '';
  return `
    <div class="stats">
      <div class="stat"><b>${o.online}</b><span>online now</span></div>
      <div class="stat ${o.queue ? 'warn' : ''}"><b>${o.queue}</b><span>wishes waiting for review</span></div>
      ${budgetCard}
    </div>
    <div class="map">${['', '', '', 'woods', 'sanctum', 'shore', '', 'desert', ''].map((id) => (id ? cell(id) : '<div></div>')).join('')}</div>
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
  const queue = pending.length
    ? pending.map((e) => `
      <article class="wish pending">
        <header><span class="tier ${e.tier}">${e.tier}</span><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.wisher.name)} · ${when(e.at)}</small></header>
        <p>${escapeHtml(e.summary)}</p>
        ${conversation(e)}
        <div class="actions">
          <button type="button" data-review="${e.id}" data-approve="yes">Approve</button>
          <button type="button" class="quiet" data-review="${e.id}" data-approve="no">Reject</button>
        </div>
      </article>`).join('')
    : '<p class="note">Nothing is waiting. Major and engine wishes appear here for review.</p>';
  const rows = content.map((e) => `
    <tr class="${e.status}">
      <td>${e.art ? `<img src="${escapeHtml(e.art)}" alt="">` : e.definition ? '<span class="ph" title="Placeholder art">✦</span>' : ''}</td>
      <td><b>${escapeHtml(e.title)}</b><br><small>${escapeHtml(e.summary)}</small>${conversation(e)}</td>
      <td><span class="tier ${e.tier}">${e.tier}</span></td>
      <td>${escapeHtml(e.status)}</td>
      <td>${escapeHtml(e.wisher.name)}<br><small>${when(e.at)}</small></td>
      ${owner ? `<td>${e.usd !== undefined ? usd(e.usd) : ''}</td>` : ''}
      <td><div class="actions">
        ${e.status === 'granted' ? `<button type="button" class="quiet" data-rollback="${e.id}">Roll back</button>` : ''}
        ${owner && e.status === 'granted' && e.definition ? `<button type="button" class="quiet" data-paint="${e.id}">${e.art ? 'Repaint' : 'Paint'}</button>` : ''}
      </div></td>
    </tr>`).join('');
  return `
    <h2>Waiting for review</h2>
    ${queue}
    <h2>Content log</h2>
    ${content.length ? `<table class="log"><thead><tr><th></th><th>Wish</th><th>Tier</th><th>Status</th><th>Wished by</th>${owner ? '<th>Cost</th>' : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">No wishes yet.</p>'}`;
}

function conversation(e: Entry): string {
  if (!e.conversation?.length) return '';
  const lines = e.conversation.map((t) => `<li class="${t.role}"><b>${t.role === 'user' ? escapeHtml(e.wisher.name) : 'God'}:</b> ${escapeHtml(t.content)}</li>`).join('');
  return `<details><summary>Conversation</summary><ol class="talk">${lines}</ol></details>`;
}

// --- Players -------------------------------------------------------------------

async function players(): Promise<string> {
  const { players } = await api<{ players: Player[] }>('players');
  const rows = players.map((p) => `
    <tr>
      <td><b>${escapeHtml(p.name)}</b>${p.invitedBy ? `<br><small>invited by ${escapeHtml(p.invitedBy)}</small>` : ''}</td>
      <td>${p.role === 'owner' ? 'Owner' : p.role === 'steward' ? 'Steward' : 'Player'}</td>
      <td>${p.online ? `<span class="online">online</span> · ${escapeHtml(p.region ?? '')}` : '<small>offline</small>'}</td>
      <td>${p.level}</td>
      <td>${p.favor ?? ''}</td>
      ${owner ? `<td>${p.role === 'owner' ? '' : p.role === 'steward'
        ? `<button type="button" class="quiet" data-role="${p.id}" data-to="player">Remove Steward</button>`
        : `<button type="button" class="quiet" data-role="${p.id}" data-to="steward">Make Steward</button>`}</td>` : ''}
    </tr>`).join('');
  return `
    <h2>Players</h2>
    <table class="log"><thead><tr><th>Name</th><th>Role</th><th>Where</th><th>Level</th><th>Favor</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
}

// --- AI models -----------------------------------------------------------------

let aiState: AiSettings | null = null;

async function ai(): Promise<string> {
  aiState = await api<AiSettings>('ai');
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
      <label>Images for wishes<span><select name="imageProvider"><option value="gemini"${s.ai.image.provider === 'gemini' ? ' selected' : ''}>Google AI Studio${s.imageKeySet ? '' : ' (no key)'}</option><option value="none"${s.ai.image.provider === 'none' ? ' selected' : ''}>None (placeholder art only)</option></select><input name="imageModel" value="${escapeHtml(s.ai.image.model)}"></span></label>
      <button type="submit">Save</button>
    </form>
    <p class="note">The offline God needs no key: it understands simple wishes and is always the last fallback. Keys live in the server's environment, never here.</p>
    <ul class="keys">${keys}</ul>
    <h2>Try it</h2>
    <form id="ai-test" class="form">
      <label>Prayer<span><input name="prompt" placeholder="I wish for a glowing blue hat"><button type="submit">Ask</button></span></label>
    </form>
    <pre id="ai-result" hidden></pre>`;
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
      <p><b>${usd(b.spentUsd)}</b> of ${usd(b.monthlyUsd)} · ${b.calls ?? 0} paid calls${b.over ? ' · <b>Over the ceiling: the offline God answers and no art is painted.</b>' : b.warn ? ' · Past the warning line.' : ''}</p>
    </div>
    <div class="cols">
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

// --- Actions -------------------------------------------------------------------

main.addEventListener('click', async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!t) return;
  try {
    if (t.dataset.review) {
      await api(`content/${t.dataset.review}/review`, 'POST', { approve: t.dataset.approve === 'yes' });
      toast(t.dataset.approve === 'yes' ? 'Approved. The wisher has been told.' : 'Rejected. The wisher has been told.');
    } else if (t.dataset.rollback) {
      if (!confirm('Roll this wish back for everyone? It disappears from the world and from bags.')) return;
      await api(`content/${t.dataset.rollback}/rollback`, 'POST');
      toast('Rolled back.');
    } else if (t.dataset.paint) {
      await api(`content/${t.dataset.paint}/paint`, 'POST');
      toast('Painting. The new art appears in a few seconds.');
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
    if (form.id === 'ai-form') {
      await api('ai', 'PUT', {
        god: { provider: f.godProvider, model: f.godModel },
        fallback: f.fallbackProvider ? { provider: f.fallbackProvider, model: f.fallbackModel } : null,
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

// A provider change suggests its default model.
main.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement;
  const input = select.parentElement?.querySelector<HTMLInputElement>('input');
  const provider = aiState?.providers.find((p) => p.id === select.value);
  if (input && provider && /Provider$/.test(select.name) && select.name !== 'imageProvider') input.value = provider.defaultModel;
});

void boot();
