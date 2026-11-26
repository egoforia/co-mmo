// The AI Art Studio (/art-studio.html), the Owner's workspace for every
// picture, walk and sound. This entry signs in and opens the Studio's window
// (art-studio/shell.ts): workspaces along the top, the asset browser and
// Inspector docked either side, today's pages (art-ui/*) in the middle and
// the painting strip along the bottom.

import { loadToken, rejoinWhenBack } from './api.ts';
import { mountApiLogPanel } from './api-log-panel.ts';
import { StudioShell } from './art-studio/shell.ts';
import { GameDown, api, toast } from './gods-view/core.ts';
import { escapeHtml } from './ui.ts';

const main = document.getElementById('main')!;

let waiting = false;

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

  // The API log opens as a side panel on the right, beside the Studio.
  mountApiLogPanel(api, (err) => (err instanceof GameDown ? waitForGame() : toast(err.message)), document.getElementById('toggle-api-log'));

  await new StudioShell(waitForGame).start();
}

void boot();
