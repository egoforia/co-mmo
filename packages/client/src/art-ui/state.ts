// Shared types, constants, formatters and view-state store (artState) for
// God's View's Art tab (art-ui.ts and art-ui/*).

import type { BuildingView } from './buildings.ts';
import {
  ISO_WAYS,
  movingArt,
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

export type Tab = 'characters' | 'monsters' | 'items' | 'biomes' | 'hud';
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
  /** When this item or gather spot currently uses another picture as a stand-in until its own is painted. */
  standIn?: { id: string; name?: string; url?: string };
  /** Region fashion style (pilgrim, barkwarden, pearlcoat, sunwrap, windfelt, sporeweave). */
  fashionStyle?: string;
  /** Equipment slot when wearable/wieldable. */
  slot?: string;
  /** Sub-category (e.g., craft-tool, boss-unique, gather-spot, garment). */
  category?: string;
  /** Biome affinity. */
  biome?: string;
  /** Anchor kind. */
  kind?: string;
}

export interface WalkVersion { id: string; url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe }
export interface WalkStrip { url: string; frames: number; width: number; height: number; cycleSeconds: number; recipe?: Recipe; versions: WalkVersion[] }
export interface StandingView { url?: string; recipe?: Recipe; versions: { id: string; url: string; recipe?: Recipe }[] }

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
  tier?: string;
  biome?: string;
  body?: string;
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

/** A selectable version of an art reference (current, earlier history version, or shipped original). */
export interface ArtReferenceVersion {
  id: string;
  label: string;
  url?: string;
}

/** A reference image sent along with a paint request. */
export interface ArtReferenceInfo {
  id: string;
  assetId?: string;
  versionId?: string;
  name: string;
  url?: string;
  availableVersions?: ArtReferenceVersion[];
}

/** A paid request, as the server's review and approval take it. */
export type Ask =
  | { what: 'paint'; asset: string; references?: string[] }
  | { what: 'paint-group'; group: string }
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
  references?: ArtReferenceInfo[];
}

/** The questions the hand finder asks: one for a look's own picture, which faces us, and one per way of facing. */
export interface HandQuestion { facing: Facing | 'look'; prompt: string; usual: string; own: boolean; system: string }

/** One version in a comparison: how it looks and what made it. */
export interface Shown { id: string; label: string; look: string; recipe?: Recipe }

export const SUBTABS = [
  ['queue', 'Queue & Jobs'],
  ['missing', 'Missing & Stand-In'],
  ['art-director', '✦ AI Art Director'],
  ['entities', 'Characters, Monsters & NPCs'],
  ['items', 'Items'],
  ['biomes', 'Biomes'],
  ['looks', 'Building looks'],
  ['buildings', 'Buildings'],
  ['hud-fx', 'HUD & FX'],
  ['sounds', 'Sounds'],
  ['map-editor', 'Map Preview & Editor'],
  ['models', 'AI Models'],
] as const;
export type Subtab = (typeof SUBTABS)[number][0] | 'now' | 'characters' | 'monsters';
export const ITEM_ORDER = ['Consumables', 'Weapons', 'Shields', 'Armour', 'Charms', 'Craft tools', 'Materials', 'Books and scrolls', 'Other'];
/** The isometric camera's ways, in words, as the Art tab shows them. */
export const WAYS: [IsoWay, string][] = [['front-left', 'towards us, left'], ['front-right', 'towards us, right'], ['back-left', 'away, left'], ['back-right', 'away, right']];
export const SOURCE: Record<ArtItem['source'], string> = { shipped: 'shipped with the game', painted: 'painted here', redone: 'painted again here', missing: 'not painted yet' };
export const STATUS: Record<ArtJob['status'], string> = { queued: 'In line', waiting: 'Waiting for a turn', painting: 'Painting now', done: 'Done', failed: 'Failed', skipped: 'Not painted' };
export const MEDIA: Record<ArtJob['media'], string> = { picture: 'picture', clip: 'video clip', sound: 'sound' };
export const ASKED: Record<ArtJob['source'], string> = { 'start-up': 'start-up', 'gods-view': "God's View", wish: 'a wish' };
/** Item pages whose items can be held. */
export const HOLDABLE = ['Weapons', 'Shields', 'Charms', 'Craft tools'];

export const usd = (n: number) => `$${(n ?? 0).toFixed((n ?? 0) < 1 ? 3 : 2)}`;
export const when = (at: number) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const esc = (s: string | undefined | null): string => escapeHtml(s ?? '');

export interface UpNextEntry {
  id: string;
  priority: number;
  kind: 'paint' | 'paint-group' | 'view' | 'ways' | 'clip' | 'sound' | 'normal' | 'sheet';
  targetId: string;
  label: string;
  category: string;
  direction?: Facing;
  body?: string;
  note?: string;
  prompt?: string;
  harmonizedPrompt?: string;
  references?: string[];
  estimateUsd: number;
  status: 'staged' | 'running' | 'done' | 'failed';
  addedAt: number;
  reason?: string;
}

export interface UpNextState {
  running: boolean;
  items: UpNextEntry[];
}

/** Shared state for the AI Art Studio tabs, walker views, hand editor, skill stage, and modals. */
export const artState: {
  data: ArtOverview | null;
  /** Where the hand finder found each look's hands, frame by frame, and each item's grip, by art id. */
  points: ArtPointsManifest;
  questions: HandQuestion[];
  /** Walks whose hands were mirrored from another walk: the walk they came from, by art id. */
  mirrored: Record<string, string>;
  ctx: ArtContext;
  /** Items tried in each hand in the hands preview, by art id; the same for every character while the Studio is open. */
  tryOn: { right?: string; left?: string };
  /** Item pictures' sizes once loaded, by url, so a tried item is drawn at its game size. */
  sizes: Map<string, [number, number]>;
  /** Hand panels left open, so they stay open when the page is drawn again after a look. */
  openHands: Set<string>;
  /** Every building, for the Buildings page; loaded when it is opened. */
  buildings?: BuildingView[];
  /** Persistent Up Next staged queue state. */
  upNext?: UpNextState;
  /** Selected fashion style filter on the Items tab. */
  itemFashionFilter: string;
  /** Selected stand-in filter on the Items / Missing tab. */
  itemStandInOnly: boolean;
} = {
  data: null,
  points: {},
  questions: [],
  mirrored: {},
  ctx: undefined as unknown as ArtContext,
  tryOn: {},
  sizes: new Map(),
  openHands: new Set(),
  itemFashionFilter: 'all',
  itemStandInOnly: false,
};

/** Where the Art Studio is: its tab and page, from the address (#<tab>/<page> or legacy #art/<tab>/<page>). */
export function where(): { sub: Subtab; page?: string; walker?: string; asset?: string } {
  const [hashPath, queryString] = location.hash.slice(1).split('?');
  const raw = (hashPath ?? '').split('/').filter(Boolean);
  const parts = raw[0] === 'art' ? raw.slice(1) : raw;
  const subRaw = parts[0] ?? 'entities';
  const page = parts.length > 1 ? decodeURIComponent(parts.slice(1).join('/')) : undefined;
  const params = queryString ? new URLSearchParams(queryString) : undefined;
  const walker = params?.get('walker') ?? undefined;
  const asset = params?.get('asset') ?? undefined;
  const mapped: Subtab =
    subRaw === 'now' ? 'queue' :
    subRaw === 'characters' || subRaw === 'monsters' ? (subRaw as Subtab) :
    SUBTABS.some(([id]) => id === subRaw) ? (subRaw as Subtab) : 'entities';
  return { sub: mapped, ...(page ? { page } : {}), ...(walker ? { walker } : {}), ...(asset ? { asset } : {}) };
}

export function go(sub: Subtab, page?: string): string {
  return `#art/${sub}${page ? `/${encodeURIComponent(page)}` : ''}`;
}

/** Resolves any ArtJob asset ID or queued target ID to its deep link in the AI Art Studio. */
export function assetHref(asset: string | undefined, media?: 'picture' | 'clip' | 'sound'): string | undefined {
  if (!asset) return undefined;
  const data = artState.data;
  if (!data) return undefined;

  if (media === 'sound' || data.sounds.some((s) => s.id === asset)) {
    return `${go('sounds')}?asset=${encodeURIComponent(asset)}`;
  }

  if (asset.startsWith('kit-sheet-') || data.sheets?.some((s) => s.look === asset)) {
    const look = asset.replace(/^kit-sheet-/, '');
    return `${go('looks')}?asset=${encodeURIComponent(look)}`;
  }

  const group = data.groups.find((g) => g.id === asset);
  if (group?.items[0]) {
    const first = group.items[0];
    const tab =
      first.place.tab === 'hud'
        ? 'hud-fx'
        : first.place.tab === 'characters' || first.place.tab === 'monsters'
          ? 'entities'
          : first.place.tab;
    return `${go(tab, first.place.page)}?asset=${encodeURIComponent(first.id)}`;
  }

  const base = asset.replace(/-normal$/, '');
  const moving = movingArt(base);
  const waySuffix = ISO_WAYS.find((d) => base.endsWith(`-${d}`));
  const walkerId = base.endsWith('-ways')
    ? base.slice(0, -'-ways'.length)
    : moving
      ? moving.look
      : waySuffix
        ? base.slice(0, -(waySuffix.length + 1))
        : undefined;
  if (walkerId) {
    const w = data.walkers.find((x) => x.id === walkerId);
    if (w) return `${go('entities', w.place.page)}?walker=${encodeURIComponent(w.id)}`;
  }

  const item = data.items.find((i) => i.id === base || i.id.endsWith(`:${base}`));
  if (item) {
    const tab =
      item.place.tab === 'hud'
        ? 'hud-fx'
        : item.place.tab === 'characters' || item.place.tab === 'monsters'
          ? 'entities'
          : item.place.tab;
    return `${go(tab, item.place.page)}?asset=${encodeURIComponent(item.id)}`;
  }

  const w = data.walkers.find((x) => x.id === base);
  if (w) return `${go('entities', w.place.page)}?walker=${encodeURIComponent(w.id)}`;

  return undefined;
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
