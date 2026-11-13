// Standalone AI Art Studio (/art-studio.html):
// Dedicated creative workspace for the Owner, decoupled from God's View.
// Hosts the "Up Next" Queue, Missing & Stand-In Art Navigator, AI Art Director,
// Unified Characters/Monsters/NPCs Studio (with Interactive Hand Workbench & Attack/Skill Stage),
// Items, Biomes, Building Kit Looks, Buildings, HUD & FX, Sounds, In-Studio Map Editor,
// and Art/Video/Audio AI Models.

import { loadToken, rejoinWhenBack } from './api.ts';
import { apiLogPage, wireApiLog } from './api-log-ui.ts';
import {
  afterArtRender,
  artChange,
  artClick,
  artPage,
  artSubmit,
  refreshArtJobs,
  refreshHandStatus,
  type ArtContext,
} from './art-ui.ts';
import { GameDown, api, toast } from './gods-view/core.ts';
import { escapeHtml } from './ui.ts';

const main = document.getElementById('main')!;
const apiLogDrawer = document.getElementById('studio-api-log-drawer')!;
const apiLogBody = document.getElementById('studio-api-log-body')!;

let waiting = false;
let apiLogOpen = false;

const artContext: ArtContext = {
  api,
  toast,
  rerender: (force?: boolean) => void render(force ?? true),
};

function waitForGame(): void {
  if (waiting) return;
  waiting = true;
  main.innerHTML = '<p class="note">The game is starting up. This studio opens by itself when it is ready…</p>';
  void rejoinWhenBack();
}

async function boot(): Promise<void> {
  if (!loadToken()) {
    main.innerHTML = '<p class="note">Sign in to the game in this browser first, then open the AI Art Studio.</p>';
    return;
  }
  try {
    const overview = await api<{ you: { name: string; role: string } }>('overview');
    document.getElementById('you')!.textContent = `${overview.you.name} · ${overview.you.role === 'owner' ? 'Owner' : 'Steward'}`;
    if (overview.you.role !== 'owner') {
      main.innerHTML = '<p class="note">Only the Owner can open the AI Art Studio.</p>';
      return;
    }
  } catch (err) {
    if (err instanceof GameDown) return waitForGame();
    main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
    return;
  }

  addEventListener('hashchange', () => void render(false));

  // Wire the collapsible Art API Call Log drawer
  wireApiLog(
    apiLogBody,
    api,
    () => apiLogOpen,
    (err) => (err instanceof GameDown ? waitForGame() : toast(err.message)),
  );
  document.getElementById('toggle-api-log')?.addEventListener('click', () => void toggleApiLog());
  document.getElementById('close-api-log')?.addEventListener('click', () => void toggleApiLog(false));

  await render(true);

  // Keep live job status and background hand-finder progress fresh
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshArtJobs(artContext);
    void refreshHandStatus(artContext);
  }, 3000);
}

async function toggleApiLog(force?: boolean): Promise<void> {
  apiLogOpen = force !== undefined ? force : !apiLogOpen;
  apiLogDrawer.hidden = !apiLogOpen;
  if (apiLogOpen) {
    apiLogBody.innerHTML = '<p class="note">Loading API call log…</p>';
    try {
      apiLogBody.innerHTML = await apiLogPage(api);
      apiLogDrawer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      apiLogBody.innerHTML = `<p class="note bad">${escapeHtml((err as Error).message)}</p>`;
    }
  }
}

async function render(force = false): Promise<void> {
  if (waiting) return;
  try {
    const html = await artPage(artContext, force);
    // Preserve active text input focus if the user is typing
    if (
      main.contains(document.activeElement) &&
      (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) &&
      document.activeElement.type !== 'checkbox'
    ) {
      return;
    }
    main.innerHTML = html;
    afterArtRender();
  } catch (err) {
    if (err instanceof GameDown) return waitForGame();
    main.innerHTML = `<p class="note">${escapeHtml((err as Error).message)}</p>`;
  }
}

main.addEventListener('click', (e) => {
  artClick(e.target as HTMLElement);
});

main.addEventListener('submit', (e) => {
  e.preventDefault();
  artSubmit(e.target as HTMLFormElement);
});

main.addEventListener('change', (e) => {
  artChange(e.target as HTMLElement);
});

void boot();
