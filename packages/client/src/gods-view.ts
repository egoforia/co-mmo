// God's View: the Owner's and Stewards' dashboard (design doc, God's View).
// Plain DOM over the /api/admin endpoints; the session token is the one the
// game saved in this browser. This file is the shell: sign-in, the tab bar,
// drawing the open tab and passing clicks to the tabs. Each tab lives in
// gods-view/ (or art-ui.ts, loot-tab.ts and api-log-ui.ts for the bigger ones).

import { loadToken, rejoinWhenBack } from './api.ts';
import { escapeHtml } from './ui.ts';
import { apiLogPage, wireApiLog } from './api-log-ui.ts';
import { artChange, artClick, artPage, artSubmit, refreshArtJobs, type ArtContext } from './art-ui.ts';
import { lootClick, lootPage, lootSubmit } from './loot-tab.ts';
import { GameDown, api, rerender, toast, view, type Tab } from './gods-view/core.ts';
import { worldTab } from './gods-view/world.ts';
import { wishesTab } from './gods-view/wishes.ts';
import { rulesTab } from './gods-view/rules.ts';
import { reportsTab } from './gods-view/reports.ts';
import { playersTab } from './gods-view/players.ts';
import { aiTab } from './gods-view/ai.ts';
import { budgetTab } from './gods-view/budget.ts';
import { serversTab } from './gods-view/servers.ts';
import { updatesTab } from './gods-view/updates.ts';

const main = document.getElementById('main')!;

const artContext: ArtContext = { api, toast, rerender };

/** Every tab, in the order the tab bar shows them. */
const TABS: Tab[] = [
  worldTab,
  wishesTab,
  rulesTab,
  { id: 'loot', label: 'Loot', page: () => lootPage(artContext) },
  reportsTab,
  playersTab,
  { id: 'art', label: 'Art', ownerOnly: true, page: () => artPage(artContext) },
  aiTab,
  budgetTab,
  serversTab,
  { id: 'api-log', label: 'API Log', ownerOnly: true, page: () => apiLogPage(api) },
  updatesTab,
];

/** Says the game is starting, and opens God's View again once it answers. */
let waiting = false;
function waitForGame(): void {
  if (waiting) return;
  waiting = true;
  main.innerHTML = '<p class="note">The game is starting up. This page opens by itself when it is ready…</p>';
  void rejoinWhenBack();
}

async function boot(): Promise<void> {
  if (!loadToken()) {
    main.innerHTML = '<p class="note">Sign in to the game in this browser first, then come back.</p>';
    return;
  }
  try {
    const overview = await api<{ you: { name: string; role: string } }>('overview');
    view.owner = overview.you.role === 'owner';
    document.getElementById('you')!.textContent = `${overview.you.name} · ${overview.you.role === 'owner' ? 'Owner' : 'Steward'}`;
  } catch (err) {
    // Opened (or reloaded by Vite) while the game restarts after an update.
    if (err instanceof GameDown) return waitForGame();
    main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
    return;
  }
  const tabs = TABS.filter((t) => view.owner || !t.ownerOnly);
  main.innerHTML = `
    <nav>${tabs.map((t) => `<button type="button" data-tab="${t.id}">${t.label}</button>`).join('')}</nav>
    <section id="panel"></section>`;
  main.querySelector('nav')!.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (id) show(id);
  });
  wireApiLog(main, api, () => view.tab === 'api-log', (err) => (err instanceof GameDown ? waitForGame() : toast(err.message)));
  view.render = () => void render();
  show(location.hash.slice(1) || 'world');
  addEventListener('hashchange', () => show(location.hash.slice(1) || 'world'));
  // Tabs that change on their own (the world map, server health) redraw while open.
  for (const t of tabs) {
    if (t.refreshMs) setInterval(() => view.tab === t.id && document.visibilityState === 'visible' && void render(), t.refreshMs);
  }
  // Painting moves on its own; keep the log fresh without touching the forms below it.
  setInterval(() => view.tab === 'art' && document.visibilityState === 'visible' && void refreshArtJobs(artContext), 3000);
}

/** Opens a tab; the Art tab's own pages follow it in the address (#art/items/Weapons). */
function show(id: string): void {
  view.tab = id.split('/')[0]!;
  if (location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  for (const b of main.querySelectorAll<HTMLElement>('[data-tab]')) b.toggleAttribute('aria-current', b.dataset.tab === view.tab);
  void render();
}

async function render(): Promise<void> {
  if (waiting) return;
  const panel = document.getElementById('panel')!;
  const current = view.tab;
  const tab = TABS.find((t) => t.id === current) ?? worldTab;
  try {
    const html = await tab.page();
    if (view.tab !== current) return;
    // Keep what the Owner is typing when the panel refreshes.
    if (panel.contains(document.activeElement) && current !== 'world') return;
    panel.innerHTML = html;
    tab.after?.();
  } catch (err) {
    if (err instanceof GameDown) return waitForGame();
    panel.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
  }
}

// --- Actions: each goes to the tabs in turn until one handles it ---------------

main.addEventListener('click', async (e) => {
  if (view.tab === 'art' && artClick(e.target as HTMLElement)) return;
  if (view.tab === 'loot' && lootClick(e.target as HTMLElement, artContext)) return;
  const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!t) return;
  try {
    for (const tab of TABS) {
      const handled = await tab.click?.(t);
      if (!handled) continue;
      if (handled === true) rerender();
      return;
    }
  } catch (err) {
    toast((err as Error).message);
  }
});

main.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  if (artSubmit(form) || lootSubmit(form, artContext)) return;
  const fields = Object.fromEntries(new FormData(form)) as Record<string, string>;
  try {
    for (const tab of TABS) {
      const handled = await tab.submit?.(form, fields);
      if (!handled) continue;
      if (handled === true) rerender();
      return;
    }
    rerender();
  } catch (err) {
    toast((err as Error).message);
  }
});

main.addEventListener('change', (e) => {
  if (view.tab === 'art' && artChange(e.target as HTMLElement)) return;
  for (const tab of TABS) if (tab.change?.(e.target as HTMLElement)) return;
});

void boot();
