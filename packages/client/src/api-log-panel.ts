// The API log as a right-hand side panel (God's View and the AI Art Studio):
// it opens beside the page instead of below it, scrolls on its own, and can be
// dragged wider. What it shows and how its filters work is api-log-ui.ts.

import { apiLogPage, wireApiLog } from './api-log-ui.ts';
import { escapeHtml } from './ui.ts';

type Api = <T>(path: string) => Promise<T>;

const WIDTH_KEY = 'co-mmo.api-log-width';
const MIN_WIDTH = 380;

/** The side panel's controls, for a button or a link that opens it. */
export interface ApiLogPanel {
  open(): Promise<void>;
  close(): void;
  toggle(): Promise<void>;
  isOpen(): boolean;
}

/** The panel's first width: 45% of the window, between 380 and 720 px. */
const defaultWidth = () => Math.min(720, Math.max(MIN_WIDTH, Math.round(innerWidth * 0.45)));

/** Widest the panel may be: the page keeps at least a third of the window. */
const widest = () => Math.max(MIN_WIDTH, Math.round(innerWidth * 0.66));

function keptWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_WIDTH ? n : defaultWidth();
  } catch {
    return defaultWidth();
  }
}

/**
 * Adds the panel to the page, closed. `button` (when given) opens and closes
 * it and shows whether it is open.
 */
export function mountApiLogPanel(api: Api, onError: (err: Error) => void, button?: HTMLElement | null): ApiLogPanel {
  const aside = document.createElement('aside');
  aside.id = 'api-log-side';
  aside.className = 'api-log-side';
  aside.hidden = true;
  aside.setAttribute('aria-label', 'API log');
  aside.innerHTML = `
    <div class="api-log-grip" role="separator" aria-orientation="vertical" title="Drag to widen (double click: as it was)"></div>
    <div class="api-log-bar">
      <h2>📡 API log</h2>
      <button type="button" class="quiet" data-close-api-log title="Close (Esc)">Close ✕</button>
    </div>
    <div class="api-log-scroll"></div>`;
  document.body.append(aside);
  const body = aside.querySelector<HTMLElement>('.api-log-scroll')!;
  const grip = aside.querySelector<HTMLElement>('.api-log-grip')!;
  let open = false;

  const setWidth = (w: number) => {
    const width = Math.min(widest(), Math.max(MIN_WIDTH, Math.round(w)));
    document.documentElement.style.setProperty('--api-log-width', `${width}px`);
    return width;
  };
  setWidth(keptWidth());

  wireApiLog(body, api, () => open, onError);

  const show = async () => {
    open = true;
    aside.hidden = false;
    document.body.classList.add('api-log-open');
    button?.setAttribute('aria-pressed', 'true');
    body.innerHTML = '<p class="note">Loading the API log…</p>';
    try {
      body.innerHTML = await apiLogPage(api);
    } catch (err) {
      body.innerHTML = `<p class="note bad">${escapeHtml((err as Error).message)}</p>`;
    }
  };
  const hide = () => {
    open = false;
    aside.hidden = true;
    document.body.classList.remove('api-log-open');
    button?.setAttribute('aria-pressed', 'false');
  };

  button?.addEventListener('click', () => void (open ? hide() : show()));
  aside.querySelector('[data-close-api-log]')!.addEventListener('click', hide);
  addEventListener('keydown', (e) => {
    // Esc closes the panel unless it is closing something inside a form box.
    if (e.key === 'Escape' && open && !(e.target as HTMLElement).closest?.('input, select, textarea, dialog')) hide();
  });

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    aside.classList.add('dragging');
    const move = (m: PointerEvent) => setWidth(innerWidth - m.clientX);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      aside.classList.remove('dragging');
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(aside.getBoundingClientRect().width)));
      } catch {
        // The width is only a convenience; it is fine to forget it.
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    setWidth(defaultWidth());
    try {
      localStorage.removeItem(WIDTH_KEY);
    } catch {
      // As above.
    }
  });
  addEventListener('resize', () => setWidth(aside.getBoundingClientRect().width || keptWidth()));

  return { open: show, close: hide, toggle: () => (open ? (hide(), Promise.resolve()) : show()), isOpen: () => open };
}
