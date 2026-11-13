// What every God's View tab shares: talking to /api/admin, the signed-in
// person's role, small formatters, and the Tab contract each tab implements.

import { loadToken } from '../api.ts';

/** Spending against the month's budget and today's cap, with the Budget tab's breakdowns. */
export interface Budget {
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

/** A wish as God's View sees it. */
export interface Entry {
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
  /** Switched off by a Steward: who and when. */
  off?: { by: string; at: number };
  /** An Engine wish's switch, which its code checks. */
  mod?: string;
  /** An Engine wish that takes an earlier wish's code change out: that wish's id. */
  undoes?: string;
  progress?: { state: 'in-progress' | 'needs-input' | 'error' | 'done' | 'closed'; label: string; detail?: string; link?: string };
  live?: { paused: boolean; reason?: string; runs: number; errors: { at: number; message: string }[]; effects: Record<string, number>; events: string[]; timers: number } | null;
}

/** An Engine wish being built on GitHub. */
export interface Build {
  state: 'queued' | 'building' | 'fixing' | 'review' | 'merged' | 'live' | 'failed' | 'closed' | 'split';
  at: number;
  note?: string;
  allowCore?: boolean;
  issue?: { number: number; url: string };
  pr?: { number: number; url: string };
  message?: string;
  tries?: number;
}

/** Who is looking and which tab is open; the shell keeps it current. */
export const view = {
  owner: false,
  tab: 'world',
  /** Draws the open tab again. */
  render: (): void => undefined,
};

/** Draws the open tab again after an action, letting go of the button that had focus first. */
export function rerender(): void {
  // A closed dialog gives focus back to its button, which would keep the page from redrawing.
  (document.activeElement as HTMLElement | null)?.blur();
  view.render();
}

const token = loadToken();

/** The game server is not answering: it is restarting, or stopped. */
export class GameDown extends Error {
  constructor() {
    super('The game is starting up. Try again in a moment.');
  }
}

/** Extracts a readable error description from an API response body. */
export function formatError(data: unknown, status?: number): string {
  if (!data || typeof data !== 'object') {
    return status === 422 ? 'Validation failed (422)' : 'Something went wrong. Try again.';
  }
  const d = data as Record<string, unknown>;
  const fields = Array.isArray(d.invalid_fields)
    ? (d.invalid_fields as Array<{ field?: string; description?: string }>)
        .map((f) => `${f.field ? f.field + ': ' : ''}${f.description ?? ''}`.trim())
        .filter(Boolean)
        .join('; ')
    : '';
  const detail = typeof d.detail === 'string' ? d.detail.trim().replace(/^-\s*/, '') : '';
  const message = typeof d.message === 'string' ? d.message.trim() : '';
  const error = typeof d.error === 'string' ? d.error.trim() : '';
  const title = typeof d.title === 'string' ? d.title.trim() : '';

  const details = fields || detail || message || error;
  if (status === 422) {
    if (details) {
      return details.toLowerCase().includes('422') || details.toLowerCase().startsWith('validation')
        ? details
        : `Validation failed (422): ${details}`;
    }
    return title ? `${title} (422)` : 'Validation failed (422)';
  }

  return details || title || 'Something went wrong. Try again.';
}

/** Calls God's View's API as the signed-in person. */
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  // No answer, or the dev proxy saying the server behind it is down.
  if (!res || res.status === 502 || res.status === 503 || res.status === 504) throw new GameDown();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorText = formatError(data, res.status);
    if (res.status === 422) {
      toast(errorText, true);
    }
    const err = new Error(errorText) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short note at the bottom of the page. */
export function toast(text: string, bad?: boolean): void {
  const el = typeof document !== 'undefined' ? document.getElementById('toast') : null;
  if (!el) return;
  el.textContent = text;
  const isBad = bad ?? /\b(422|500|400|404|409|failed|error|refused|denied|invalid)\b/i.test(text);
  el.classList.toggle('bad', isBad);
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('bad');
  }, isBad ? 7000 : 4000);
}

/** Dollars, to a tenth of a cent under a dollar. */
export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
/** A day and time, short. */
export const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What a button or form action did: false when it was not this tab's, 'keep' when the page must not be redrawn. */
export type Handled = boolean | 'keep';

/**
 * One God's View tab. The shell draws the open tab's page, sends every
 * click, submit and change to each tab in turn until one handles it, and
 * redraws afterwards. A new tab is one file and one line in the shell.
 */
export interface Tab {
  id: string;
  label: string;
  /** Only the Owner sees it. */
  ownerOnly?: boolean;
  /** The tab's HTML. */
  page(): Promise<string>;
  /** Runs after the page is in place (drawing the world map). */
  after?(): void;
  /** Redraws on its own this often while open, in ms. */
  refreshMs?: number;
  click?(button: HTMLButtonElement): Promise<Handled>;
  submit?(form: HTMLFormElement, fields: Record<string, string>): Promise<Handled>;
  change?(el: HTMLElement): boolean;
}
