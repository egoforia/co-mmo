import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import sharp from 'sharp';
import {
  BODY_TYPES,
  BUILDING_STYLES,
  FACINGS,
  ISO_WAYS,
  ISO_WAY_BESIDE,
  WALK_CYCLE_SECONDS,
  WALK_DIRECTIONS,
  WALK_FRAMES,
  regionPictures,
  ruleItemId,
  walkArt,
  wishArtKey,
  isFacing,
  isWalkDirection,
  type ArtManifest,
  type BiomeId,
  type Facing,
  type IsoWay,
  type ItemWish,
  type PicturedWish,
  type WalkDirection,
} from '@co-mmo/shared';
import { ANCHORS } from './assets/anchors.ts';
import type { ImageProvider, ImageRequest } from './assets/provider.ts';
import { buildingArtJobs } from './assets/building-art.ts';
import type { KitSheets, KitSheetView } from './assets/building-kit/kit-sheets.ts';
import type { SheetGuide } from './assets/building-kit/sheet.ts';
import { BIOME_KIT, type KitAsset } from './assets/kit.ts';
import { paintKitAsset, wildKit } from './assets/wild-kit.ts';
import { artRequest, estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import { pictureName } from './assets/names.ts';
import { ArtHistory, type ArtVersion } from './art-history.ts';
import { plain, type ArtJob, type ArtJobHandle, type ArtJobs } from './art-jobs.ts';
import { buildingPlace, shippedPlace, wishedPlace, landName, type ArtPlace } from './art-places.ts';
import { Previewed, dryImage, keepingImage, recipeUsd, type Recipe, type RecipeBook } from './art-recipes.ts';
import type { BuildingPainter } from './building-painter.ts';
import { fitNormalMap, normalMapId, normalRequest } from './normal-painter.ts';
import { watched } from './paint-queue.ts';
import type { PaintRequest, PaintRequests } from './paint-requests.ts';
import type { SoundItem, SoundMaker } from './sound-maker.ts';
import type { ContentRecord, Store } from './store.ts';
import type { ArtUse } from './settings.ts';
import { estimateClipUsd, facingWords, type StandingView, type ViewSource, type WalkPainter, type WalkVersion, type Walker } from './walk-painter.ts';
import type { Wishes } from './wishes.ts';
import type { AiServices } from './ai/services.ts';
import type { Budget, BudgetState } from './budget.ts';

// God's View's Art tab: every picture the game draws, where it came from,
// and buttons to paint any of it again or to make something walk. Before
// anything is painted the Owner reviews exactly what will be sent (prompt,
// pictures, model, cost) and approves it; it then waits its turn behind other
// painting and is paid from the same monthly budget as everything else. Every
// version keeps what made it, so old and new can be compared and put back.

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
  | { kind: 'walk'; walker: string; body: string; directions?: WalkDirection[]; views?: boolean }
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
  /** Earlier walks of ways that have none now. */
  lost: Partial<Record<Facing, WalkVersion[]>>;
  /** Each way's standing picture: for the top-down ways, what its walk clip starts and ends on. */
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

/** The Art tab's server side. */
export class ArtStudio {
  private redone: ArtManifest = {};
  private readonly history: ArtHistory;
  private loaded = false;
  /** Owner requests, one after another, behind any start-up painting. */
  private queue: Promise<void> = Promise.resolve();
  /** Requests waiting or painting, so tests and shutdown can wait for them. */
  readonly pending = new Set<Promise<void>>();
  /** Requests a limit stopped (the budget, today's clips), kept until resume() asks for them again. */
  private stopped: { request: PaintRequest; release: () => void }[] = [];

  constructor(private readonly options: ArtStudioOptions) {
    this.history = new ArtHistory(options.artDir, options.recipes);
  }

  private get redoneDir(): string {
    return resolve(this.options.artDir, 'redone');
  }

  /** Art shipped with the game that the Owner had painted again, for clients to load. */
  async manifest(): Promise<ArtManifest> {
    await this.load();
    return this.redone;
  }

  /** Everything the Art tab shows. */
  async overview(): Promise<{
    imageModel: string | null;
    videoModel: string | null;
    budget: BudgetState;
    jobs: ArtJob[];
    items: ArtItem[];
    groups: ArtGroup[];
    walkers: WalkerView[];
    bodies: { id: string; name: string }[];
    sounds: SoundItem[];
    effectsModel: string | null;
    musicModel: string | null;
    sheets: KitSheetView[];
  }> {
    await this.load();
    await this.options.walks.load();
    const imageModel = this.options.ai.image()?.model ?? null;
    const videoModel = this.options.ai.video()?.model ?? null;
    const shipped = await this.options.shipped();
    const painted: ArtManifest = { ...(await this.options.wishes.kitManifest()), ...this.options.buildings.manifest(), ...this.options.walks.manifest() };
    const items = await this.items(shipped, painted);
    return {
      imageModel,
      videoModel,
      budget: this.options.budget.state(),
      jobs: this.options.jobs.list(),
      items,
      groups: groupsOf(items),
      walkers: await this.walkerViews(shipped, painted, this.pictureUsd('walks')),
      bodies: Object.values(BODY_TYPES).map((b) => ({ id: b.id, name: b.name })),
      sounds: (await this.options.sounds?.list()) ?? [],
      effectsModel: this.options.sounds?.models().effects ?? null,
      musicModel: this.options.sounds?.models().music ?? null,
      sheets: (await this.options.sheets?.overview()) ?? [],
    };
  }

  /** Every picture, where it sits, and what made it. */
  private async items(shipped: ArtManifest, painted: ArtManifest): Promise<ArtItem[]> {
    const url = (id: string): { url?: string; source: ArtSource } => {
      if (this.redone[id]) return { url: `/${this.redone[id]!.file}`, source: 'redone' };
      if (painted[id]?.redone) return { url: slash(painted[id]!.file), source: 'redone' };
      if (shipped[id]) return { url: slash(shipped[id]!.file), source: 'shipped' };
      if (painted[id]) return { url: slash(painted[id]!.file), source: 'painted' };
      return { source: 'missing' };
    };
    const items: ArtItem[] = [];
    for (const a of BIOME_KIT.filter(repaintableKit)) {
      items.push({ id: a.id, name: a.name ?? a.id, place: shippedPlace(a), ...url(a.id), estimateUsd: this.pictureUsd('scenery'), repaintable: true, takesNote: true });
    }
    for (const a of ANCHORS) {
      const repaintable = Boolean(shipped[a.id]) && a.kind !== 'effect';
      items.push({ id: a.id, name: a.name ?? a.id, place: shippedPlace(a), ...url(a.id), estimateUsd: this.pictureUsd(useOf(a)), repaintable, takesNote: true, ...(shipped[a.id] ? {} : { why: 'Not part of the game yet.' }) });
    }
    // Lands' buildings after their scenery, so each land's page and the list of lands start with the launch kit.
    for (const style of Object.values(BUILDING_STYLES)) {
      for (const job of buildingArtJobs(style)) {
        const name = job.id.slice(style.id.length + 1).replace(/^furniture-/, '').replace(/-/g, ' ').replace(/^exterior$/, 'outside');
        items.push({ id: job.id, name, place: buildingPlace(style.id), ...url(job.id), estimateUsd: this.pictureUsd('buildings'), repaintable: true, takesNote: true });
      }
    }
    items.push(...this.wishedItems(this.pictureUsd('wishes')));
    for (const item of items) {
      // Normal maps are painted for the game's own pictures, which share their id with the picture the game draws.
      if (!item.id.includes(':') && item.url && this.options.readArt) item.normalPaintable = true;
      const normal = this.redone[normalMapId(item.id)];
      if (normal) item.normalMap = `/${normal.file}`;
      const versions = await this.history.versions(item.id);
      if (versions.length) item.versions = versions;
      const recipe = item.source === 'missing' ? undefined : await this.recipeOf(item.id, item.source === 'shipped');
      if (recipe) item.recipe = recipe;
      if (item.source === 'redone' && shipped[item.id]) {
        item.shippedBack = true;
        const first = await this.shippedRecipe(item.id);
        item.shipped = { url: slash(shipped[item.id]!.file), ...(first ? { recipe: first } : {}) };
      }
    }
    return items;
  }

  /** Granted wishes' pictures, and wished lands' scenery. */
  private wishedItems(picture: number): ArtItem[] {
    const items: ArtItem[] = [];
    const kits = new Map<BiomeId, ContentRecord>();
    for (const record of this.options.store.content) {
      const def = record.definition;
      if (record.status !== 'granted' || !def || def.kind === 'recipe' || def.kind === 'loot') continue;
      const item = (id: string, pictured: PicturedWish, art?: string): ArtItem => {
        const kept = record.artPrompts?.[id];
        return {
          id: `${record.id}:${id}`, name: pictured.name, place: wishedPlace(pictured), ...(art ? { url: art } : {}), source: art ? 'painted' : 'missing', estimateUsd: picture, repaintable: true, takesNote: true,
          ...(kept?.check ? { check: kept.check } : {}), ...(kept?.reused ? { reused: kept.reused.name } : {}),
        };
      };
      if (def.kind === 'region') {
        kits.set(def.biome, kits.get(def.biome) ?? record);
        for (const p of regionPictures(record.id, def)) items.push(item(p.id, p.def, record.itemArt?.[p.id]));
      } else if (def.kind === 'rule') {
        for (const [key, it] of Object.entries(def.items)) items.push(item(ruleItemId(record.id, key), { kind: 'item', ...it } as ItemWish, record.itemArt?.[ruleItemId(record.id, key)]));
      } else {
        items.push(item(record.id, def, record.art));
      }
    }
    for (const [biome, record] of kits) {
      for (const asset of wildKit(biome)) {
        const art = record.kitArt?.[asset.id];
        items.push({ id: `${record.id}:${asset.id}`, name: asset.name ?? asset.id, place: { tab: 'biomes', page: landName(biome), section: 'Scenery' }, ...(art ? { url: art } : {}), source: art ? 'painted' : 'missing', estimateUsd: this.pictureUsd('scenery'), repaintable: true, takesNote: false });
      }
    }
    return items;
  }

  /** Everything that can walk: the approved people and creatures, then wished ones. */
  private walkerList(): (Walker & { kind: string; url?: string; place: ArtPlace })[] {
    const list: (Walker & { kind: string; url?: string; place: ArtPlace })[] = [];
    for (const a of ANCHORS) {
      if (a.kind !== 'player' && a.kind !== 'npc' && a.kind !== 'monster') continue;
      list.push({ ...this.options.walks.anchorWalker(a.id), kind: a.kind === 'player' ? 'player look' : a.kind === 'npc' ? 'person' : 'creature', url: `/art/${a.id}.png`, place: shippedPlace(a) });
    }
    for (const record of this.options.store.content) {
      const def = record.definition;
      if (record.status !== 'granted' || !def) continue;
      const pictures = def.kind === 'region' ? regionPictures(record.id, def) : def.kind === 'player' || def.kind === 'creature' || def.kind === 'npc' ? [{ id: record.id, def }] : [];
      for (const p of pictures) {
        const art = def.kind === 'region' ? record.itemArt?.[p.id] : record.art;
        if (!art) continue;
        list.push({
          id: wishArtKey(p.id),
          name: p.def.name,
          kind: p.def.kind === 'player' ? `${record.wisher.name}'s look` : p.def.kind === 'npc' ? 'wished person' : 'wished creature',
          url: art,
          place: wishedPlace(p.def),
          gear: [],
          body: 'two-legged',
          reference: () => readFile(resolve(this.options.artDir, `${p.id}.png`)),
        });
      }
    }
    return list;
  }

  private async walkerViews(shipped: ArtManifest, painted: ArtManifest, picture: number): Promise<WalkerView[]> {
    const clip = estimateClipUsd(this.options.ai.video()?.model ?? '');
    const views: WalkerView[] = [];
    for (const w of this.walkerList()) {
      const walks: WalkerView['walks'] = {};
      const lost: WalkerView['lost'] = {};
      for (const d of FACINGS) {
        const id = walkArt(w.id, d);
        const entry = painted[id] ?? shipped[id];
        const versions = await this.options.walks.versions(w.id, d);
        if (!entry) {
          if (versions.length) lost[d] = versions;
          continue;
        }
        const recipe = painted[id] ? await this.options.recipes.current(id) : undefined;
        walks[d] = { url: slash(entry.file), frames: entry.frames ?? WALK_FRAMES, width: entry.width, height: entry.height, cycleSeconds: entry.cycleSeconds ?? WALK_CYCLE_SECONDS, ...(recipe ? { recipe } : {}), versions };
      }
      const needs = await this.options.walks.needs(w);
      const standing = {} as WalkerView['standing'];
      for (const d of FACINGS) standing[d] = await this.options.walks.standing(w, d, w.url);
      views.push({ id: w.id, name: w.name, kind: w.kind, ...(w.url ? { url: w.url } : {}), place: w.place, walks, lost, standing, estimateUsd: needs.views.length * picture + needs.clips.length * clip, clipUsd: clip, viewUsd: picture });
    }
    return views;
  }

  /**
   * Exactly what a request would send to the AI models, before anything is
   * painted: the Owner approves this, and the request then names its
   * fingerprint so nothing different is painted.
   */
  async review(ask: ArtAsk): Promise<ArtReview> {
    const parts: ArtReview['parts'] = [];
    let title: string;
    try {
      if (ask.kind === 'paint') {
        const name = await this.nameOf(ask.asset);
        title = `Paint ${name} again`;
        parts.push({ name, recipe: await this.previewPaint(ask.asset, ask.note ?? '') });
      } else if (ask.kind === 'group') {
        const group = await this.group(ask.group);
        title = `Paint all ${group.items.length} pictures of ${group.title} again`;
        for (const item of group.items) parts.push({ name: item.name, recipe: await this.previewPaint(item.id, '') });
      } else if (ask.kind === 'walk') {
        const walker = this.walker(ask.walker, ask.body);
        const redo = (ask.directions ?? []).filter((d) => WALK_DIRECTIONS.includes(d));
        title = redo.length ? `Paint ${walker.name} walking ${redo.length === 1 ? 'one way' : `${redo.length} ways`} again` : `Make ${walker.name} walk`;
        const recipe = await this.options.walks.preview(walker, redo, ask.views === true);
        if (!recipe.steps.length) throw new ArtRequestError(`${walker.name} already walks every way. Pick a direction to paint again.`);
        parts.push({ name: walker.name, recipe });
      } else if (ask.kind === 'view') {
        const walker = this.walker(ask.walker, 'two-legged');
        const direction = this.facing(ask.direction);
        title = `Paint ${walker.name} standing, facing ${facingWords(direction)}`;
        parts.push({ name: walker.name, recipe: await this.options.walks.previewView(walker, direction, ownPrompt(ask.prompt), await this.sourcesFor(walker, direction, ask.from)) });
      } else if (ask.kind === 'ways') {
        const todo = await this.missingWays(ask.walker);
        const one = ask.walker ? this.walker(ask.walker, 'two-legged') : undefined;
        if (!todo.length) throw new ArtRequestError(one ? `${one.name} already has a standing picture for every isometric way.` : 'Every walker already has a standing picture for every isometric way.');
        title = one
          ? `Paint ${one.name} standing in ${todo.length === ISO_WAYS.length ? 'the four isometric ways' : `${todo.length} more isometric way${todo.length > 1 ? 's' : ''}`}`
          : `Paint every walker standing in the isometric ways: ${todo.length} pictures`;
        // One part per walker, a picture for each way it lacks.
        const byWalker = new Map<string, { name: string; recipe: Recipe }>();
        for (const t of todo) {
          const recipe = await this.options.walks.previewView(t.walker, t.way, undefined, t.from);
          const part = byWalker.get(t.walker.id);
          if (part) part.recipe.steps.push(...recipe.steps);
          else byWalker.set(t.walker.id, { name: t.walker.name, recipe });
        }
        parts.push(...byWalker.values());
      } else if (ask.kind === 'clip') {
        const walker = this.walker(ask.walker, ask.body);
        const direction = this.facing(ask.direction);
        title = `Make ${walker.name}'s walk clip, ${direction === 'front' ? 'walking towards us' : direction === 'back' ? 'walking away' : isWalkDirection(direction) ? `facing ${direction}` : `walking ${facingWords(direction)}`}`;
        parts.push({ name: walker.name, recipe: await this.options.walks.previewClip(walker, direction, ownPrompt(ask.prompt)) });
      } else if (ask.kind === 'normal') {
        const name = await this.nameOf(ask.asset);
        title = `Paint a normal map for ${name}`;
        parts.push({ name, recipe: await this.previewNormal(ask.asset, ask.prompt) });
      } else if (ask.kind === 'sheet') {
        const { name, label, provider, request } = await this.sheetAsk(ask.look, ask.textures ?? [], ask.note ?? '');
        title = label;
        parts.push({ name, recipe: { at: Date.now(), steps: [await this.options.recipes.imageStep(label, provider, request, estimateImageUsd(provider.model))], notes: ['Each texture is checked for free when it comes back; only those that pass are used, and the rest stay as they were.'] } });
      } else {
        const sounds = this.options.sounds;
        const item = (await sounds?.list())?.find((x) => x.id === ask.sound);
        if (!sounds || !item) throw new ArtRequestError('There is no sound by that name.');
        title = `Make ${item.name} again`;
        parts.push({ name: item.name, recipe: sounds.preview(ask.sound, (ask.note ?? '').trim().slice(0, 1000)) });
      }
    } catch (err) {
      if (err instanceof ArtRequestError) throw err;
      throw new ArtRequestError(plain(err));
    }
    const estimateUsd = parts.reduce((n, p) => n + recipeUsd(p.recipe), 0);
    return { title, parts, estimateUsd, fingerprint: fingerprint(parts) };
  }

  /** Refuses a request unless the Owner approved exactly what it will send now. */
  async approved(ask: ArtAsk, approved: unknown): Promise<void> {
    this.refuseWhenSpent();
    if (typeof approved !== 'string' || !approved) throw new ArtRequestError('Review what will be sent first, then approve it.');
    const now = await this.review(ask);
    if (now.fingerprint !== approved) throw new ArtRequestError('Something changed since you reviewed this (the model, the prompt or a picture sent along). Review it again before painting.');
  }

  /** What painting one picture again would send. */
  private async previewPaint(asset: string, note: string): Promise<Recipe> {
    note = note.trim().slice(0, 1000);
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      if (!record || record.status !== 'granted') throw new ArtRequestError('That wish is not granted, so it has no picture to paint again.');
      return this.options.wishes.preview(record, pictureId, note ? `${this.promptOf(record, pictureId)}\nAlso: ${note}` : undefined);
    }
    if (Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`))) return this.options.buildings.preview(asset, note);
    const kit = this.kitAsset(asset);
    if (!kit) throw new ArtRequestError('There is no picture by that name.');
    const box = (await this.options.shipped())[asset];
    if (!box) throw new ArtRequestError('That picture is not part of the game yet.');
    const provider = this.options.ai.image(useOf(kit));
    if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const dry = dryImage(provider);
    await paintKitAsset(withSelf(kit), dry, this.options.anchorDir, this.redoneDir, { box: { width: box.width, height: box.height }, note }).catch((err) => {
      if (!(err instanceof Previewed)) throw err;
    });
    return { at: Date.now(), steps: [await this.options.recipes.imageStep(kit.name ?? asset, provider, dry.sent!, estimateImageUsd(provider.model))] };
  }

  /** What painting a picture's normal map would send. */
  private async previewNormal(asset: string, prompt?: string): Promise<Recipe> {
    const { name, provider, request } = await this.normalAsk(asset, prompt);
    return { at: Date.now(), steps: [await this.options.recipes.imageStep(`Normal map of ${name}`, provider, request, estimateImageUsd(provider.model))] };
  }

  /** The picture, model and request for painting a picture's normal map; refused when it cannot be painted. */
  private async normalAsk(asset: string, prompt?: string): Promise<{ name: string; picture: Buffer; provider: ImageProvider; request: ImageRequest }> {
    const read = this.options.readArt;
    if (asset.includes(':') || !read) throw new ArtRequestError('Normal maps can be painted for the game\'s own pictures, not for wished ones yet.');
    const file = await this.pictureFile(asset);
    if (!file) throw new ArtRequestError('That picture is not part of the game yet, so it has no normal map to paint.');
    const provider = this.options.ai.image(this.useFor(asset));
    if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const name = await this.nameOf(asset);
    const picture = await read(file).catch(() => {
      throw new ArtRequestError('That picture could not be read from disk.');
    });
    return { name, picture, provider, request: await normalRequest(picture, name, ownPrompt(prompt)) };
  }

  /** Where the picture the game shows now is loaded from, for the game's own pictures. */
  private async pictureFile(asset: string): Promise<string | undefined> {
    await this.load();
    const painted = this.options.buildings.manifest();
    const shipped = await this.options.shipped();
    return this.redone[asset]?.file ?? (painted[asset]?.redone ? painted[asset]!.file : undefined) ?? shipped[asset]?.file ?? painted[asset]?.file;
  }

  /** Which image model paints a picture's things. */
  private useFor(asset: string): ArtUse {
    if (Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`))) return 'buildings';
    const kit = this.kitAsset(asset);
    return kit ? useOf(kit) : 'wishes';
  }

  /**
   * Paints a normal map for one of the game's own pictures, in place of the
   * one the game works out; the Owner's `prompt` replaces the usual words.
   */
  async paintNormal(asset: string, prompt?: string): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const { name, provider } = await this.normalAsk(asset, prompt);
    const id = normalMapId(asset);
    const estimateUsd = estimateImageUsd(provider.model);
    const handle = this.options.jobs.add(id, `Normal map of ${name}`, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      // Read again when its turn comes, so the map is made for the picture shown then.
      const { picture, request } = await this.normalAsk(asset, prompt);
      handle.start();
      const sent = keepingImage(watched(provider, handle));
      const image = await sent.generate(request);
      const { width = 1, height = 1 } = await sharp(picture).metadata();
      const png = await fitNormalMap(image.data, width, height);
      const usd = imageUsd(provider.model, image);
      await this.keepCurrent(id);
      await this.options.recipes.record(id, { at: Date.now(), steps: [await this.options.recipes.imageStep(`Normal map of ${name}`, provider, request, usd)] });
      this.options.budget.spend('image', { provider: provider.id, model: provider.model }, usd);
      await mkdir(this.redoneDir, { recursive: true });
      await writeFile(resolve(this.redoneDir, `${id}.png`), png);
      this.redone[id] = { file: `${REDONE_ART_PATH}/${id}.png?v=${Date.now().toString(36)}`, kind: 'normal', width, height, redone: Date.now() };
      await this.saveRedone();
      handle.done(usd);
      this.options.onPainted?.([id]);
    }, handle);
    return { estimateUsd };
  }

  /** Puts back the normal map the game works out by itself; the painted one is kept as a version. */
  async dropNormal(asset: string): Promise<void> {
    await this.load();
    const id = normalMapId(asset);
    if (!this.redone[id]) throw new ArtRequestError('That picture has no painted normal map.');
    await this.keepCurrent(id);
    delete this.redone[id];
    await this.saveRedone();
  }

  /** The guide, model and request for painting a building look's texture sheet, or only some of its textures again. */
  private async sheetAsk(look: string, textures: string[], note: string): Promise<{ name: string; label: string; provider: ImageProvider; request: ImageRequest; guide: SheetGuide }> {
    const sheets = this.options.sheets;
    const found = sheets?.look(look);
    if (!sheets || !found) throw new ArtRequestError('There is no building look by that name.');
    const provider = this.options.ai.image('buildings');
    if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const names = [...new Set(textures)];
    const guide = await sheets.guide(look, names, note).catch((err) => {
      throw new ArtRequestError(plain(err));
    });
    const label = names.length ? `Paint ${names.length === 1 ? `the ${names[0]} texture` : `${names.length} textures`} of the ${found.name.toLowerCase()} sheet again` : `Paint the ${found.name.toLowerCase()} texture sheet`;
    return { name: found.name, label, provider, request: sheets.request(guide), guide };
  }

  /**
   * Paints a building look's texture sheet, or only some of its textures
   * again. The new painting is kept beside the others and checked for free;
   * a texture is used only once a painting of it passes.
   */
  async paintSheet(look: string, textures: string[] = [], note = ''): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const { label, provider } = await this.sheetAsk(look, textures, note);
    const estimateUsd = estimateImageUsd(provider.model);
    const id = `kit-sheet-${look}`;
    const handle = this.options.jobs.add(id, label, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      // Made again when its turn comes, so a sheet painted meanwhile is painted over.
      const { request, guide } = await this.sheetAsk(look, textures, note);
      handle.start();
      const image = await watched(provider, handle).generate(request);
      const usd = imageUsd(provider.model, image);
      this.options.budget.spend('image', { provider: provider.id, model: provider.model }, usd);
      const kept = await this.options.sheets!.keep(look, image.data, guide);
      await this.options.recipes.record(`${id}-${kept.id.split('/')[1]}`, { at: Date.now(), steps: [await this.options.recipes.imageStep(label, provider, request, usd)] });
      handle.done(usd);
      // checked now, so the Art tab shows how it fared as soon as it can
      void this.options.sheets!.checked(look).catch(() => undefined);
    }, handle, { kind: 'sheet', look, ...(textures.length ? { textures } : {}), ...(note ? { note } : {}) });
    return { estimateUsd };
  }

  /** A picture's name, for a review's title. */
  private async nameOf(asset: string): Promise<string> {
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      const def = record?.definition;
      if (def?.kind === 'region') return regionPictures(record!.id, def).find((p) => p.id === pictureId)?.def.name ?? wildKit(def.biome).find((a) => a.id === pictureId)?.name ?? pictureId;
      if (def?.kind === 'rule') return Object.entries(def.items).find(([k]) => ruleItemId(record!.id, k) === pictureId)?.[1].name ?? pictureId;
      return def && 'name' in def ? def.name : pictureId;
    }
    return pictureName(asset);
  }

  /** One group's pictures that can be painted again; refused when there are none. */
  private async group(groupId: string): Promise<{ title: string; items: ArtItem[] }> {
    await this.load();
    const painted: ArtManifest = { ...(await this.options.wishes.kitManifest()), ...this.options.buildings.manifest() };
    const group = groupsOf(await this.items(await this.options.shipped(), painted)).find((g) => g.id === groupId);
    if (!group) throw new ArtRequestError('There is no group of pictures by that name.');
    const items = group.items.filter((i) => i.repaintable && i.source !== 'missing');
    if (!items.length) throw new ArtRequestError('Nothing in that group can be painted again.');
    return { title: group.title, items };
  }

  /** A walker by id, with the body type chosen. */
  private walker(walkerId: string, body: string): Walker {
    const found = this.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name to make walk.');
    if (!BODY_TYPES[body]) throw new ArtRequestError('That body type is unknown.');
    return { ...found, body };
  }

  private direction(direction: string): WalkDirection {
    if (!WALK_DIRECTIONS.includes(direction as WalkDirection)) throw new ArtRequestError('That is not a direction.');
    return direction as WalkDirection;
  }

  /** A way a standing picture can face: one a walk can face, or an isometric way. */
  private facing(facing: string): Facing {
    if (!isFacing(facing)) throw new ArtRequestError('That is not a direction.');
    return facing;
  }

  /**
   * The isometric ways each walker (or only `walkerId`) has no standing
   * picture for, with the pictures each is painted from: the approved
   * picture, and the standing pictures painted for the ways on either side.
   */
  private async missingWays(walkerId?: string): Promise<{ walker: Walker; way: IsoWay; from: ViewSource[] }[]> {
    const walkers = walkerId ? [this.walker(walkerId, 'two-legged')] : this.walkerList();
    const out: { walker: Walker; way: IsoWay; from: ViewSource[] }[] = [];
    for (const walker of walkers) {
      for (const way of ISO_WAYS) {
        if ((await this.options.walks.standing(walker, way)).url) continue;
        out.push({ walker, way, from: await this.besideSources(walker, way) });
      }
    }
    return out;
  }

  /**
   * What a standing picture is painted from: the pictures chosen, or for an
   * isometric way, the approved picture and the standing pictures painted
   * for the ways on either side; otherwise the approved picture alone.
   */
  private async sourcesFor(walker: Walker, direction: Facing, from: string[] | undefined): Promise<ViewSource[] | undefined> {
    return viewSources(from) ?? (isWalkDirection(direction) ? undefined : this.besideSources(walker, direction));
  }

  /** The approved picture, and the painted standing pictures of the ways either side of an isometric way. */
  private async besideSources(walker: Walker, way: IsoWay): Promise<ViewSource[]> {
    const from: ViewSource[] = ['approved'];
    for (const beside of ISO_WAY_BESIDE[way]) {
      const view = await this.options.walks.standing(walker, beside);
      if (view.url && !view.approved) from.push(beside);
    }
    return from;
  }

  /** A shipped scenery piece, character or item that can be painted again. */
  private kitAsset(asset: string): KitAsset | undefined {
    return [...BIOME_KIT.filter(repaintableKit), ...ANCHORS.filter((a) => a.kind !== 'effect')].find((a) => a.id === asset) as KitAsset | undefined;
  }

  /**
   * What made the picture shown now: kept when it was painted, or for
   * pictures from before recipes were kept, what is known about them.
   */
  private async recipeOf(asset: string, shipped = false): Promise<Recipe | undefined> {
    if (shipped) return this.shippedRecipe(asset);
    const kept = await this.options.recipes.current(asset);
    if (kept) return kept;
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    const record = wishId ? this.options.store.contentById(wishId) : undefined;
    const p = pictureId ? record?.artPrompts?.[pictureId] : undefined;
    if (!p) return undefined;
    return {
      at: p.at, partial: true,
      steps: [{ label: await this.nameOf(asset), media: 'picture', provider: p.provider, model: p.model, prompt: p.prompt, ...(p.note ? { note: p.note } : {}), pictures: p.references.map((r) => ({ name: pictureName(r), url: `/art/${r}.png` })), settings: [], usd: p.usd ?? 0 }],
      ...(p.reused ? { notes: [`Shows the picture of ${p.reused.name}.`] } : {}),
    };
  }

  /** What made a picture that shipped with the game, from the notes kept beside it. */
  private async shippedRecipe(asset: string): Promise<Recipe | undefined> {
    const read = (path: string) => readFile(path, 'utf8').then((t) => JSON.parse(t) as { prompt: string; references?: string[]; provider: string; model: string; createdAt?: string }, () => undefined);
    const notes = (await read(resolve(this.options.anchorDir, `${asset}.json`))) ?? (await read(resolve(this.options.anchorDir, '..', 'buildings', 'raw', `${asset}.json`)));
    if (!notes) return undefined;
    // A reference is shown as the game has it, when the game has it; "player-ilya (before)" and the like were not kept.
    const shipped = await this.options.shipped();
    const pictures = (notes.references ?? []).map((r) => ({ name: pictureName(r), ...(shipped[r] ? { url: slash(shipped[r]!.file) } : {}) }));
    return {
      at: notes.createdAt ? Date.parse(notes.createdAt) : 0, partial: true,
      steps: [{ label: pictureName(asset), media: 'picture', provider: notes.provider, model: notes.model, prompt: notes.prompt, pictures, settings: [], usd: estimateImageUsd(notes.model) }],
      notes: ['Shipped with the game. The pictures sent along are shown as the game has them now.'],
    };
  }

  /**
   * Paints one picture again: a building's, shipped scenery or a shipped
   * character or item, or a granted wish's (`<wish id>:<picture id>`).
   * The Owner's `note` is added to the prompt.
   */
  async repaint(asset: string, note = ''): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    note = note.trim().slice(0, 1000);
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    const building = Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`));
    const kit = this.kitAsset(asset);
    const use: ArtUse = wishId ? 'wishes' : building ? 'buildings' : kit ? useOf(kit) : 'wishes';
    const provider = this.options.ai.image(use);
    if (!provider) throw new ArtRequestError("No image model is set. Choose one on the AI models tab first.");
    const estimateUsd = estimateImageUsd(provider.model);
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      if (!record || record.status !== 'granted') throw new ArtRequestError('That wish is not granted, so it has no picture to paint again.');
      const prompts = note ? { [pictureId]: `${this.promptOf(record, pictureId)}\nAlso: ${note}` } : {};
      await this.keepCurrent(asset);
      const job = this.options.wishes.paint(record, true, prompts, pictureId);
      if (!job) throw new ArtRequestError('That picture cannot be painted now.');
      this.hold(job);
      return { estimateUsd };
    }
    if (building) {
      const handle = this.options.buildings.queue(asset, 'gods-view');
      if (!handle) throw new ArtRequestError('There is no building picture by that name.');
      this.enqueue(async () => {
        await this.keepCurrent(asset);
        await this.options.buildings.repaint(asset, note, handle);
      }, handle, { kind: 'repaint', asset, note });
      return { estimateUsd };
    }
    if (!kit) throw new ArtRequestError('There is no picture by that name.');
    const shipped = (await this.options.shipped())[asset];
    if (!shipped) throw new ArtRequestError('That picture is not part of the game yet.');
    const handle = this.options.jobs.add(asset, kit.name ?? asset, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      await this.keepCurrent(asset);
      await this.repaintShipped(kit, { width: shipped.width, height: shipped.height }, note, handle);
    }, handle, { kind: 'repaint', asset, note });
    return { estimateUsd };
  }

  /**
   * Makes something walk, or walk again: `directions` are painted afresh
   * (their standing views too when `views` is set); with none, only what is
   * missing is painted. Directions already made are kept for free.
   */
  async walk(walkerId: string, body: string, directions: WalkDirection[], views: boolean): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.walker(walkerId, body);
    const image = this.options.ai.image('walks');
    const video = this.options.ai.video();
    if (!image) throw new ArtRequestError("No image model is set. Choose one on the AI models tab first.");
    if (!video) throw new ArtRequestError('Walks are made with Google\'s video model, which needs Google AI Studio as the image model and its key.');
    const redo = directions.filter((d) => WALK_DIRECTIONS.includes(d));
    await this.options.walks.forget(walker, redo, views);
    const plan = await this.options.walks.plan(walker, 'gods-view');
    const estimateUsd = plan.views.size * estimateImageUsd(image.model) + plan.clips.size * estimateClipUsd(video.model);
    if (!plan.views.size && !plan.clips.size) throw new ArtRequestError(`${walker.name} already walks every way. Pick a direction to paint again.`);
    this.enqueue(() => this.options.walks.paintWalker(walker, 'gods-view', true, plan), undefined, { kind: 'walk', walker: walkerId, body });
    return { estimateUsd };
  }

  /**
   * Paints a walker standing in one direction, and only that, so the Owner
   * can look at it (and paint it again) before a walk clip is made from it.
   */
  async paintView(walkerId: string, direction: string, prompt?: string, from?: string[]): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.walker(walkerId, 'two-legged');
    const d = this.facing(direction);
    const image = this.options.ai.image('walks');
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const estimateUsd = estimateImageUsd(image.model);
    const own = ownPrompt(prompt);
    const handle = this.options.jobs.add(`${walker.id}-${d}`, `${walker.name} standing, facing ${facingWords(d)}`, 'picture', 'gods-view', estimateUsd);
    const sources = await this.sourcesFor(walker, d, from);
    this.enqueue(() => this.options.walks.paintView(walker, d, own, handle, sources), handle, { kind: 'view', walker: walkerId, direction: d, ...(own ? { prompt: own } : {}), ...(sources ? { from: [...sources] } : {}) });
    return { estimateUsd };
  }

  /**
   * Paints the isometric ways one walker, or every walker, has no standing
   * picture for, each a picture of its own in the painting log.
   */
  async paintWays(walkerId?: string): Promise<{ estimateUsd: number; count: number }> {
    this.refuseWhenSpent();
    const image = this.options.ai.image('walks');
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const todo = await this.missingWays(walkerId);
    if (!todo.length) throw new ArtRequestError('Every isometric way already has a standing picture.');
    const usd = estimateImageUsd(image.model);
    for (const { walker, way, from } of todo) {
      const handle = this.options.jobs.add(`${walker.id}-${way}`, `${walker.name} standing, facing ${facingWords(way)}`, 'picture', 'gods-view', usd);
      this.enqueue(() => this.options.walks.paintView(walker, way, undefined, handle, from), handle, { kind: 'view', walker: walker.id, direction: way, from: [...from] });
    }
    return { estimateUsd: usd * todo.length, count: todo.length };
  }

  /** Makes one direction's walk clip from the standing picture there now, and only that. */
  async makeClip(walkerId: string, body: string, direction: string, prompt?: string): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.walker(walkerId, body);
    const d = this.facing(direction);
    const video = this.options.ai.video();
    if (!video) throw new ArtRequestError("Walks are made with Google's video model, which needs Google AI Studio as the image model and its key.");
    const estimateUsd = estimateClipUsd(video.model);
    const own = ownPrompt(prompt);
    const handle = this.options.jobs.add(walkArt(walker.id, d), `${walker.name} walking ${facingWords(d)}`, 'clip', 'gods-view', estimateUsd);
    this.enqueue(() => this.options.walks.makeClip(walker, d, own, handle), handle, { kind: 'clip', walker: walkerId, body, direction: d, ...(own ? { prompt: own } : {}) });
    return { estimateUsd };
  }

  /**
   * Makes a sound effect or a land's music again, with the Owner's `note`
   * added to its description. Sounds are quick, so they do not wait behind
   * start-up painting.
   */
  async sound(id: string, note = ''): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const sounds = this.options.sounds;
    const item = (await sounds?.list())?.find((s) => s.id === id);
    if (!sounds || !item) throw new ArtRequestError('There is no sound by that name.');
    if (!item.makeable) throw new ArtRequestError(item.why ?? 'That sound cannot be made now.');
    const handle = sounds.queue(id, 'gods-view');
    this.hold(sounds.remake(id, note.trim().slice(0, 1000), handle).catch((err) => console.error(`Making ${id} again failed:`, (err as Error).message)));
    return { estimateUsd: item.estimateUsd };
  }

  /**
   * Paints every picture in one Art tab group again (say, after choosing a
   * better model for buildings), each as its own request. Returns about
   * what it all costs; painting stops if the budget runs out on the way.
   */
  async repaintGroup(groupId: string): Promise<{ estimateUsd: number; count: number }> {
    this.refuseWhenSpent();
    const { items } = await this.group(groupId);
    let estimateUsd = 0;
    for (const item of items) estimateUsd += (await this.repaint(item.id)).estimateUsd;
    return { estimateUsd, count: items.length };
  }

  /**
   * Puts an earlier version of a picture back, or with `version` "shipped"
   * the picture that shipped with the game. The one it replaces is kept.
   */
  async restore(asset: string, version: string): Promise<void> {
    if (version === 'shipped') {
      if (!(await this.options.shipped())[asset]) throw new ArtRequestError('That picture did not ship with the game.');
      await this.load();
      const file = await this.currentFile(asset);
      if (file) await this.history.keep(asset, file, await this.recipeOf(asset));
      await this.options.recipes.forget(asset);
      if (this.redone[asset]) {
        delete this.redone[asset];
        await this.saveRedone();
      } else {
        await this.options.buildings.forget(asset);
      }
      return;
    }
    const file = await this.currentFile(asset);
    if (!file || !(await this.history.restore(asset, version, file, await this.recipeOf(asset)))) throw new ArtRequestError('That earlier version is not there any more.');
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) this.options.wishes.touchArt(wishId, pictureId);
    else if (this.redone[asset]) {
      this.redone[asset] = { ...this.redone[asset]!, file: `${this.redone[asset]!.file.split('?')[0]}?v=${Date.now().toString(36)}`, redone: Date.now() };
      await this.saveRedone();
    } else await this.options.buildings.touch(asset);
  }

  /** Puts a walk in one direction back as it was in an earlier version, for free. */
  async restoreWalk(walkerId: string, direction: string, version: string): Promise<void> {
    const found = this.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restore(found, this.facing(direction), version))) throw new ArtRequestError('That earlier walk is not there any more.');
  }

  /** Puts an earlier standing picture back in one direction, for free; its walk clip is not made again. */
  async restoreView(walkerId: string, direction: string, version: string): Promise<void> {
    const found = this.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restoreView(found, this.facing(direction), version))) throw new ArtRequestError('That earlier picture is not there any more.');
  }

  /** Puts an earlier version of a sound back, for free. */
  async restoreSound(id: string, version: string): Promise<void> {
    if (!(await this.options.sounds?.restore(id, version))) throw new ArtRequestError('That earlier version is not there any more.');
  }

  /** Puts a picture's current file aside before it is painted again, when it was painted here, with what made it. */
  private async keepCurrent(asset: string): Promise<void> {
    const file = await this.currentFile(asset);
    if (file) await this.history.keep(asset, file, await this.recipeOf(asset));
  }

  /**
   * The file on disk a picture is shown from, when it was painted here:
   * a wish's picture, a building picture, or shipped art painted again.
   * Wished lands' scenery is shared by every region of the land and has no history.
   */
  private async currentFile(asset: string): Promise<string | undefined> {
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      const def = record?.definition;
      if (def?.kind === 'region' && wildKit(def.biome).some((a) => a.id === pictureId)) return undefined;
      return resolve(this.options.artDir, `${pictureId}.png`);
    }
    await this.load();
    if (this.redone[asset]) return resolve(this.redoneDir, basename(this.redone[asset]!.file.split('?')[0]!));
    return this.options.buildings.fileOf(asset);
  }

  private async saveRedone(): Promise<void> {
    await mkdir(this.redoneDir, { recursive: true });
    await writeFile(resolve(this.redoneDir, 'manifest.json'), JSON.stringify(this.redone, null, 2));
  }

  /** The painting log, newest first. */
  jobs(): ArtJob[] {
    return this.options.jobs.list();
  }

  /** Waits for every request so far (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** About what one picture of this kind costs with its model. */
  private pictureUsd(use: ArtUse): number {
    return estimateImageUsd(this.options.ai.image(use)?.model ?? '');
  }

  private refuseWhenSpent(): void {
    const budget = this.options.budget.state();
    if (budget.over) throw new ArtRequestError("This month's budget is spent, so nothing more can be painted until next month or until the ceiling is raised on the Budget tab.");
    if (budget.overToday) throw new ArtRequestError("Today's spending cap is reached, so nothing more can be painted until midnight UTC or until the cap is raised on the Budget tab.");
  }

  /**
   * Asks again for the requests a limit stopped, once painting is allowed
   * again (a new day, or the Owner raised a limit). A walk paints only the
   * directions still missing, so nothing finished is paid for twice.
   */
  resume(): void {
    for (const { request, release } of this.stopped.splice(0)) {
      void this.again(request)
        .catch((err) => {
          if (!(err instanceof ArtRequestError)) console.error(`A stopped ${request.kind} painting was not asked again:`, (err as Error).message);
        })
        .finally(release);
    }
  }

  private async again(request: PaintRequest): Promise<unknown> {
    if (request.kind === 'walk') return this.walk(request.walker, request.body, [], false);
    if (request.kind === 'view') return this.paintView(request.walker, request.direction, request.prompt, request.from);
    if (request.kind === 'clip') return this.makeClip(request.walker, request.body, request.direction, request.prompt);
    if (request.kind === 'repaint') return this.repaint(request.asset, request.note);
    if (request.kind === 'sheet') return this.paintSheet(request.look, request.textures, request.note);
    return undefined;
  }

  /** Keeps a stopped request, across a restart too, until resume(). */
  private stop(request: PaintRequest | undefined): void {
    if (!request) return;
    let release!: () => void;
    this.options.requests?.hold(request, new Promise<void>((r) => (release = r)));
    this.stopped.push({ request, release });
  }

  /**
   * Runs a request after the ones before it and after any start-up painting;
   * `request` keeps it across a restart, and while a limit holds it back
   * (`task` gives false when a limit stopped it).
   */
  private enqueue(task: () => Promise<unknown>, handle?: ArtJobHandle, request?: PaintRequest): void {
    const run = this.queue.then(async () => {
      await Promise.all([this.options.buildings.job, this.options.walks.job]);
      const budget = this.options.budget.state();
      if (budget.paused) {
        handle?.skip(budget.why ?? 'The budget is spent.');
        return this.stop(request);
      }
      if ((await task()) === false) this.stop(request);
    });
    this.queue = run.catch((err) => {
      console.error('Painting from God\'s View failed:', (err as Error).message);
      handle?.fail(plain(err));
    });
    this.hold(this.queue);
    if (request) this.options.requests?.hold(request, this.queue);
  }

  private hold(job: Promise<unknown>): void {
    const held = job.then(() => undefined, () => undefined);
    this.pending.add(held);
    void held.finally(() => this.pending.delete(held));
  }

  /** The prompt a wish's picture was last painted with, or would be. */
  private promptOf(record: ContentRecord, pictureId: string): string {
    const kept = record.artPrompts?.[pictureId]?.prompt;
    if (kept) return kept;
    const def = record.definition;
    if (def?.kind === 'region') {
      const p = regionPictures(record.id, def).find((x) => x.id === pictureId);
      if (p) return artRequest(p.def, def.biome).prompt;
    } else if (def?.kind === 'rule') {
      const key = Object.keys(def.items).find((k) => ruleItemId(record.id, k) === pictureId);
      if (key) return artRequest({ kind: 'item', ...def.items[key]! } as Parameters<typeof artRequest>[0], 'sanctum').prompt;
    } else if (def && def.kind !== 'recipe' && def.kind !== 'loot') {
      return artRequest(def, 'sanctum').prompt;
    }
    throw new ArtRequestError('That wish has no picture by that name.');
  }

  /** Paints a shipped scenery piece, character or item again, at its shipped size. */
  private async repaintShipped(asset: KitAsset, box: { width: number; height: number }, note: string, handle: ArtJobHandle): Promise<void> {
    const provider = this.options.ai.image(useOf(asset));
    if (!provider) return handle.skip("No image model is set in God's View.");
    handle.start();
    const sent = keepingImage(watched(provider, handle));
    const { image, entry } = await paintKitAsset(withSelf(asset), sent, this.options.anchorDir, this.redoneDir, { box, note });
    const usd = imageUsd(provider.model, image);
    if (sent.sent) await this.options.recipes.record(asset.id, { at: Date.now(), steps: [await this.options.recipes.imageStep(asset.name ?? asset.id, provider, sent.sent, usd)] });
    this.options.budget.spend('image', { provider: provider.id, model: provider.model }, usd);
    await this.load();
    const kind = asset.kind === 'tile' || asset.kind === 'prop' ? entry.kind : asset.kind;
    this.redone[asset.id] = { ...entry, kind, file: `${REDONE_ART_PATH}/${entry.file}?v=${Date.now().toString(36)}`, redone: Date.now() };
    await mkdir(this.redoneDir, { recursive: true });
    await writeFile(resolve(this.redoneDir, 'manifest.json'), JSON.stringify(this.redone, null, 2));
    handle.done(usd);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.redone = JSON.parse(await readFile(resolve(this.redoneDir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
    this.loaded = true;
  }
}

/** A shipped picture to paint again, with its own approved picture sent along too so the new one keeps its character. */
function withSelf(asset: KitAsset): KitAsset {
  return { ...asset, references: [...(asset.references ?? []), asset.id] };
}

/** The pictures that can be painted again together: everything under one heading of one page. */
function groupsOf(items: ArtItem[]): ArtGroup[] {
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
function fingerprint(parts: ArtReview['parts']): string {
  const sent = parts.map((p) => p.recipe.steps.map(({ usd: _u, ...step }) => step));
  return createHash('sha1').update(JSON.stringify(sent)).digest('hex').slice(0, 16);
}

/** Which image model paints a shipped picture: scenery's for tiles, props and landmarks, wished things' for characters and items. */
function useOf(asset: { kind: string }): ArtUse {
  return asset.kind === 'tile' || asset.kind === 'prop' || asset.kind === 'set-piece' ? 'scenery' : 'wishes';
}

/** Scenery that can be painted from here: tiles and props, not effects. */
function repaintableKit(a: KitAsset): boolean {
  return a.kind === 'tile' || a.kind === 'prop';
}

/** A manifest path as a URL from the site root. */
function slash(file: string): string {
  return file.startsWith('/') ? file : `/${file}`;
}

/** The Owner's own prompt, when they wrote one: undefined keeps the usual words. */
function ownPrompt(prompt: string | undefined): string | undefined {
  const text = prompt?.trim().slice(0, 4000);
  return text || undefined;
}

/** The pictures chosen to paint a standing picture from; undefined keeps the approved picture alone. */
function viewSources(from: string[] | undefined): ViewSource[] | undefined {
  const sources = (from ?? []).filter((f): f is ViewSource => f === 'approved' || isFacing(f));
  return sources.length ? sources : undefined;
}

