// Types, constants, error classes and pure helpers for ArtStudio (art-studio.ts)
// and its submodules in art-studio/.

import { createHash } from 'node:crypto';
import {
  isFacing,
  type ArtManifest,
  type Facing,
} from '@co-mmo/shared';
import type { AiServices } from '../ai/services.ts';
import type { ArtVersion } from '../art-history.ts';
import type { ArtJobs } from '../art-jobs.ts';
import type { ArtPlace } from '../art-places.ts';
import type { Recipe, RecipeBook } from '../art-recipes.ts';
import type { KitSheets } from '../assets/building-kit/kit-sheets.ts';
import type { KitAsset } from '../assets/kit.ts';
import type { BuildingPainter } from '../building-painter.ts';
import type { Budget } from '../budget.ts';
import type { PaintRequests } from '../paint-requests.ts';
import type { ArtUse } from '../settings.ts';
import type { SoundMaker } from '../sound-maker.ts';
import type { Store } from '../store.ts';
import type { StandingView, ViewSource, WalkPainter, WalkVersion } from '../walk-painter.ts';
import type { Wishes } from '../wishes.ts';

/** Where art shipped with the game and painted again here is kept and served from. */
export const REDONE_ART_PATH = 'wished-art/redone';

/** Where a picture came from. */
export type ArtSource = 'shipped' | 'painted' | 'redone' | 'missing';

/** One picture in the Art tab. */
export interface ArtItem {
  id: string;
  name: string;
  /** Where the browser loads it from, when there is one. */
  url?: string;
  source: ArtSource;
  /** About what painting it again costs, in US dollars. */
  estimateUsd: number;
  /** False when it cannot be painted from here, with why. */
  repaintable: boolean;
  why?: string;
  /** Whether the Owner's added words reach the painter. */
  takesNote: boolean;
  /** Where it sits in the Art tab. */
  place: ArtPlace;
  /** What made the version shown now, when that is known. */
  recipe?: Recipe;
  /** Earlier versions that can be put back, newest first. */
  versions?: ArtVersion[];
  /** Painted again over a shipped picture, which can be put back. */
  shippedBack?: boolean;
  /** The picture that shipped with the game, when another one shows now. */
  shipped?: { url: string; recipe?: Recipe };
  /** What the style check made of a wished picture, when it ran. */
  check?: { pass: boolean; why?: string; tries: number };
  /** The existing picture a wished thing shows instead of its own. */
  reused?: string;
  /** Its painted normal map, when one was painted; otherwise the game works one out. */
  normalMap?: string;
  /** Whether a normal map can be painted for it here. */
  normalPaintable?: boolean;
}

/** A group of pictures in the Art tab that can be painted again together: one heading on one page. */
export interface ArtGroup {
  id: string;
  title: string;
  items: ArtItem[];
}

/** A walk in one direction: its strip, what made it, and its earlier versions. */
export interface WalkStrip {
  url: string;
  frames: number;
  width: number;
  height: number;
  cycleSeconds: number;
  recipe?: Recipe;
  versions: WalkVersion[];
}

/** What an Owner asks to have painted or made, to review before it is approved. */
export type ArtAsk =
  | { kind: 'paint'; asset: string; note?: string }
  | { kind: 'group'; group: string }
  | { kind: 'view'; walker: string; direction: Facing; prompt?: string; from?: string[] }
  /** The isometric ways one walker, or every walker, has no standing picture for yet. */
  | { kind: 'ways'; walker?: string }
  | { kind: 'clip'; walker: string; body: string; direction: Facing; prompt?: string }
  | { kind: 'sound'; sound: string; note?: string }
  | { kind: 'normal'; asset: string; prompt?: string }
  | { kind: 'sheet'; look: string; textures?: string[]; note?: string };

/** Everything a request will send, for the Owner to approve. */
export interface ArtReview {
  title: string;
  /** One recipe per thing painted: one for a picture, several for a group. */
  parts: { name: string; recipe: Recipe }[];
  estimateUsd: number;
  /** Sent back with the approval; painting is refused if anything changed meanwhile. */
  fingerprint: string;
}

/** Something that can be made to walk, and how far along its walks are. */
export interface WalkerView {
  id: string;
  name: string;
  kind: string;
  url?: string;
  /** Where it sits in the Art tab. */
  place: ArtPlace;
  /** Each way's walk strip, when it has one: its frames side by side. */
  walks: Partial<Record<Facing, WalkStrip>>;
  /** Each way's run strip, when it has one. */
  runs?: Partial<Record<Facing, WalkStrip>>;
  /** Each way's attack strip, when it has one. */
  attacks?: Partial<Record<Facing, WalkStrip>>;
  /** Earlier walks of ways that have none now. */
  lost: Partial<Record<Facing, WalkVersion[]>>;
  /** Each way's standing picture: what its walk clip starts and ends on. */
  standing: Record<Facing, StandingView>;
  /** About what making the missing walks costs. */
  estimateUsd: number;
  /** About what painting one direction again costs (one clip). */
  clipUsd: number;
  /** About what painting one standing view costs. */
  viewUsd: number;
}

export interface ArtStudioOptions {
  store: Store;
  wishes: Wishes;
  buildings: BuildingPainter;
  walks: WalkPainter;
  jobs: ArtJobs;
  /** The image and video models, as chosen in God's View. */
  ai: AiServices;
  /** Spending against the month's budget and today's cap. */
  budget: Budget;
  anchorDir: string;
  artDir: string;
  shipped: () => Promise<ArtManifest>;
  /** Requests kept across a restart until they are painted. */
  requests?: PaintRequests;
  /** The game's sound effects and music. */
  sounds?: SoundMaker;
  /** What was sent to make each picture. */
  recipes: RecipeBook;
  /** Reads a picture the game shows, by its path from the site root, to send along. */
  readArt?: (file: string) => Promise<Buffer>;
  /** Tells pages already open which pictures changed, so they load them without a reload. */
  onPainted?: (ids: string[]) => void;
  /** The building kit's texture sheets, painted flat and checked before any building uses them. */
  sheets?: KitSheets;
}

/** A refusal the Owner reads as it is. */
export class ArtRequestError extends Error {}

/** A shipped picture to paint again, with its own approved picture sent along too so the new one keeps its character. */
export function withSelf(asset: KitAsset): KitAsset {
  return { ...asset, references: [...(asset.references ?? []), asset.id] };
}

/** The pictures that can be painted again together: everything under one heading of one page. */
export function groupsOf(items: ArtItem[]): ArtGroup[] {
  const groups = new Map<string, ArtGroup>();
  for (const item of items) {
    const id = [item.place.tab, item.place.page, item.place.section ?? ''].join('/');
    const title = item.place.section && item.place.section !== 'Scenery' ? item.place.section : item.place.section ? `${item.place.page}: ${item.place.section.toLowerCase()}` : item.place.page;
    const group = groups.get(id) ?? { id, title, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** A short hash of everything a request will send, so an approval holds only for exactly that. */
export function fingerprint(parts: ArtReview['parts']): string {
  const sent = parts.map((p) => p.recipe.steps.map(({ usd: _u, ...step }) => step));
  return createHash('sha1').update(JSON.stringify(sent)).digest('hex').slice(0, 16);
}

/** Which image model paints a shipped picture: scenery's for tiles, props and landmarks, wished things' for characters and items. */
export function useOf(asset: { kind: string }): ArtUse {
  return asset.kind === 'tile' || asset.kind === 'prop' || asset.kind === 'set-piece' ? 'scenery' : 'wishes';
}

/** Scenery that can be painted from here: tiles and props, not effects. */
export function repaintableKit(a: KitAsset): boolean {
  return a.kind === 'tile' || a.kind === 'prop';
}

/** A manifest path as a URL from the site root. */
export function slash(file: string): string {
  return file.startsWith('/') ? file : `/${file}`;
}

/** The Owner's own prompt, when they wrote one: undefined keeps the usual words. */
export function ownPrompt(prompt: string | undefined): string | undefined {
  const text = prompt?.trim().slice(0, 4000);
  return text || undefined;
}

/** The pictures chosen to paint a standing picture from; undefined keeps the approved picture alone. */
export function viewSources(from: string[] | undefined): ViewSource[] | undefined {
  const sources = (from ?? []).filter((f): f is ViewSource => f === 'approved' || isFacing(f));
  return sources.length ? sources : undefined;
}
