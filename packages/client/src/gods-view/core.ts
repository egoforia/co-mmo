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
  if (!res.ok) throw new Error(data.message ?? data.error ?? 'Something went wrong. Try again.');
  return data as T;
}

/** A short note at the bottom of the page. */
export function toast(text: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4000);
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
