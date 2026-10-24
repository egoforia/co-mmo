// Shared types, constants, formatters and view-state store (artState) for
// God's View's Art tab (art-ui.ts and art-ui/*).

import {
  type ArtPointsManifest,
  type Facing,
  type IsoWay,
} from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';

/** What the Art tab needs from God's View. */
export interface ArtContext {
  api<T>(path: string, method?: string, body?: unknown): Promise<T>;
  toast(text: string): void;
  /** Draws the open tab again. */
  rerender(): void;
}

export interface Budget {
  spentUsd: number;
  monthlyUsd: number;
  warn: boolean;
  paused?: boolean;
  why?: string;
}

export interface ArtJob {
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

export interface RecipePicture { name: string; url?: string; later?: boolean }
export interface RecipeStep { label: string; media: 'picture' | 'clip' | 'sound'; provider: string; model: string; prompt: string; note?: string; pictures: RecipePicture[]; settings: string[]; usd: number }
export interface Recipe { at: number; steps: RecipeStep[]; notes?: string[]; partial?: boolean }

export type Tab = 'characters' | 'monsters' | 'items' | 'biomes';
export interface Place { tab: Tab; page: string; section?: string }

export interface ArtItem {
  id: string;
  name: string;
  url?: string;
  source: 'shipped' | 'painted' | 'redone' | 'missing';
  place: Place;
  recipe?: Recipe;
  estimateUsd: number;
  repaintable: boolean;
  why?: string;
  takesNote: boolean;
  versions?: { id: string; url: string; recipe?: Recipe }[];
  shipped?: { url: string; recipe?: Recipe };
  check?: { pass: boolean; why?: string; tries: number };
  reused?: string;
  /** Its painted normal map, when one was painted; otherwise the game works one out. */
  normalMap?: string;
  /** Whether a normal map can be painted for it. */
  normalPaintable?: boolean;
}

export type Direction = 'front' | 'right' | 'back' | 'left';
export interface WalkVersion { id: string; url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe }
export interface WalkStrip { url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe; versions: WalkVersion[] }
export interface StandingView { url?: string; approved: boolean; recipe?: Recipe; versions: { id: string; url: string; recipe?: Recipe }[] }

export interface WalkerView {
  id: string;
  name: string;
  kind: string;
  url?: string;
  place: Place;
  walks: Partial<Record<Facing, WalkStrip>>;
  runs?: Partial<Record<Facing, WalkStrip>>;
  attacks?: Partial<Record<Facing, WalkStrip>>;
  lost: Partial<Record<Facing, WalkVersion[]>>;
  standing: Record<Facing, StandingView>;
  estimateUsd: number;
  clipUsd: number;
  viewUsd: number;
}

export interface SoundItem {
  id: string;
  name: string;
  kind: 'effect' | 'music';
  url?: string;
  prompt: string;
  recipe?: Recipe;
  versions: { id: string; url: string; recipe: Recipe }[];
  estimateUsd: number;
  makeable: boolean;
  why?: string;
}

export interface ArtOverview {
  imageModel: string | null;
  videoModel: string | null;
  budget: Budget;
  jobs: ArtJob[];
  items: ArtItem[];
  groups: { id: string; title: string; items: ArtItem[] }[];
  walkers: WalkerView[];
  bodies: { id: string; name: string }[];
  sounds: SoundItem[];
  effectsModel: string | null;
  musicModel: string | null;
  /** The building kit's looks: each one's texture sheets and how every texture fared in its checks. */
  sheets?: KitSheetView[];
}

/** A building look's texture sheets, as the server checked them. */
export interface KitSheetView {
  look: string;
  name: string;
  paintings: { id: string; shipped: boolean }[];
  checking: boolean;
  textures: { name: string; ok: boolean; painting?: string; failed: string[] }[];
}

/** A paid request, as the server's review and approval take it. */
export type Ask =
  | { what: 'paint'; asset: string }
  | { what: 'paint-group'; group: string }
  | { what: 'walk'; walker: string; body: string; directions?: Direction[]; views?: boolean }
  | { what: 'view'; walker: string; direction: Facing; prompt?: string; from?: string[] }
  | { what: 'ways'; walker?: string }
  | { what: 'clip'; walker: string; body: string; direction: Facing; prompt?: string }
  | { what: 'sound'; sound: string }
  | { what: 'normal'; asset: string; prompt?: string }
  | { what: 'sheet'; look: string; textures?: string[] };

export interface Review {
  title: string;
  parts: { name: string; recipe: Recipe }[];
  estimateUsd: number;
  fingerprint: string;
}

/** The questions the hand finder asks, one per way of facing. */
export interface HandQuestion { facing: Direction; prompt: string; usual: string; own: boolean; system: string }

/** One version in a comparison: how it looks and what made it. */
export interface Shown { id: string; label: string; look: string; recipe?: Recipe }

export const SUBTABS = [['now', 'Painting now'], ['characters', 'Characters'], ['monsters', 'Monsters'], ['items', 'Items'], ['biomes', 'Biomes'], ['looks', 'Building looks'], ['sounds', 'Sounds and music']] as const;
export type Subtab = (typeof SUBTABS)[number][0];
export const ITEM_ORDER = ['Consumables', 'Weapons', 'Shields', 'Armour', 'Charms', 'Materials', 'Books and scrolls', 'Other'];
export const DIRECTIONS: [Direction, string][] = [['front', 'towards us'], ['right', 'right'], ['back', 'away'], ['left', 'left']];
/** The isometric camera's ways, in words, as the Art tab shows them. */
export const WAYS: [IsoWay, string][] = [['front-left', 'towards us, left'], ['front-right', 'towards us, right'], ['back-left', 'away, left'], ['back-right', 'away, right']];
/** Every way a standing picture can face, in words. */
export const FACING_WORDS: [Facing, string][] = [...DIRECTIONS, ...WAYS];
/** The way a walker faces after turning round. */
export const TURNED: Record<Direction, Direction> = { front: 'back', back: 'front', left: 'right', right: 'left' };
export const SOURCE: Record<ArtItem['source'], string> = { shipped: 'shipped with the game', painted: 'painted here', redone: 'painted again here', missing: 'not painted yet' };
export const STATUS: Record<ArtJob['status'], string> = { queued: 'In line', waiting: 'Waiting for a turn', painting: 'Painting now', done: 'Done', failed: 'Failed', skipped: 'Not painted' };
export const MEDIA: Record<ArtJob['media'], string> = { picture: 'picture', clip: 'video clip', sound: 'sound' };
export const ASKED: Record<ArtJob['source'], string> = { 'start-up': 'start-up', 'gods-view': "God's View", wish: 'a wish' };
/** Item pages whose items can be held. */
export const HOLDABLE = ['Weapons', 'Shields', 'Charms'];

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
export const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const esc = escapeHtml;

/** Shared state for the Art tab's sub-tabs, walker views and modals. */
export const artState: {
  data: ArtOverview | null;
  /** Where the hand finder found each look's hands, frame by frame, and each item's grip, by art id. */
  points: ArtPointsManifest;
  questions: HandQuestion[];
  /** Walks whose hands were mirrored from another walk: the walk they came from, by art id. */
  mirrored: Record<string, string>;
  ctx: ArtContext;
  /** Items tried in each hand in the hands preview, by art id; the same for every character while God's View is open. */
  tryOn: { right?: string; left?: string };
  /** Item pictures' sizes once loaded, by url, so a tried item is drawn at its game size. */
  sizes: Map<string, [number, number]>;
  /** Hand panels left open, so they stay open when the page is drawn again after a look. */
  openHands: Set<string>;
} = {
  data: null,
  points: {},
  questions: [],
  mirrored: {},
  ctx: undefined as unknown as ArtContext,
  tryOn: {},
  sizes: new Map(),
  openHands: new Set(),
};

/** Where the Art tab is: its sub-tab and page, from the address (#art/<sub-tab>/<page>). */
export function where(): { sub: Subtab; page?: string } {
  const [, sub, ...page] = location.hash.slice(1).split('/');
  const known = SUBTABS.some(([id]) => id === sub);
  return { sub: known ? (sub as Subtab) : 'now', ...(page.length ? { page: decodeURIComponent(page.join('/')) } : {}) };
}

export function go(sub: Subtab, page?: string): string {
  return `#art/${sub}${page ? `/${encodeURIComponent(page)}` : ''}`;
}

export function openCount(jobs: ArtJob[]): string {
  const n = jobs.filter(isOpen).length;
  return n ? ` <span class="count">${n}</span>` : '';
}

export function isOpen(j: ArtJob): boolean {
  return j.status === 'queued' || j.status === 'waiting' || j.status === 'painting';
}

export function budgetLine(b: Budget): string {
  return `${usd(b.spentUsd)} of ${usd(b.monthlyUsd)} spent this month${b.paused ? ` · <b class="bad">${esc(b.why ?? 'Nothing more is painted for now.')}</b>` : b.warn ? ' · past the warning line' : ''}`;
}

/** Page buttons along the top of a tab, with the chosen one marked. */
export function pagesNav(sub: Subtab, pages: string[], chosen: string): string {
  return `<nav class="pages">${pages.map((p) => `<a href="${go(sub, p)}" data-art-go${p === chosen ? ' aria-current="page"' : ''}>${esc(p)}</a>`).join('')}</nav>`;
}

/** A button that shows a picture lit at dawn, midday, dusk, night and by a lantern; `figure` adds the rim light characters get. */
export function lightButton(url: string, normal: string | undefined, figure: boolean): string {
  return `<button type="button" class="quiet" data-light-preview="${esc(JSON.stringify({ url, normal, figure }))}">Preview the light</button>`;
}

export function stripHtml(strip: { url: string; frames: number; width: number; height: number; cycleSeconds: number } | undefined, label: string, height = 72): string {
  if (!strip) return `<div class="walk none" title="${label}: no walk yet"><span>${label}</span></div>`;
  const frameWidth = strip.width / strip.frames;
  const width = Math.round((frameWidth * height) / strip.height);
  return `<div class="walk" title="${label}"><i style="width:${width}px;height:${height}px;background-image:url('${esc(strip.url)}');background-size:${strip.frames * 100}% 100%;animation-duration:${strip.cycleSeconds}s;--steps:${strip.frames}"></i><span>${label}</span></div>`;
}
