// God's View's Art tab server facade over art-studio/:
// - art-studio/types.ts: shared types, ArtRequestError, REDONE_ART_PATH, and pure helpers
// - art-studio/catalog.ts: ArtCatalog (items, wishedItems, walkerViews, recipes, file lookup)
// - art-studio/review.ts: dry-run Recipe previews and handler registry keyed by ArtAsk['kind']
// Put new catalog queries in art-studio/catalog.ts and new review previews in art-studio/review.ts.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  BODY_TYPES,
  BUILDING_STYLES,
  walkArt,
  type ArtManifest,
} from '@co-mmo/shared';
import { ArtHistory } from './art-history.ts';
import { plain, type ArtJob, type ArtJobHandle } from './art-jobs.ts';
import { keepingImage } from './art-recipes.ts';
import { ArtDirector } from './art-studio/art-director.ts';
import { ArtCatalog } from './art-studio/catalog.ts';
import { normalAsk, reviewAsk, sheetAsk } from './art-studio/review.ts';
import { UpNextQueue } from './art-studio/up-next-queue.ts';
import {
  type ArtAsk,
  type ArtGroup,
  type ArtItem,
  type ArtReferenceInfo,
  ArtRequestError,
  type ArtReview,
  type ArtStudioOptions,
  REDONE_ART_PATH,
  type WalkerView,
  groupsOf,
  ownPrompt,
  useOf,
  withSelf,
} from './art-studio/types.ts';
import type { KitSheetView } from './assets/building-kit/kit-sheets.ts';
import type { KitAsset } from './assets/kit.ts';
import { seaCaveBox } from './assets/sea-cave-kit.ts';
import { homeLandBox } from './assets/home-land-art.ts';
import { KEY_COLOR } from './assets/style.ts';
import { paintKitAsset, resolveReferenceImage } from './assets/wild-kit.ts';
import { estimateImageUsd, imageUsd } from './assets/wish-art.ts';
import type { BudgetState } from './budget.ts';
import { fitNormalMap, normalMapId } from './normal-painter.ts';
import { watched } from './paint-queue.ts';
import type { PaintRequest } from './paint-requests.ts';
import type { ArtUse } from './settings.ts';
import type { SoundItem } from './sound-maker.ts';
import { estimateClipUsd, facingWords } from './walk-painter.ts';

export {
  ArtRequestError,
  REDONE_ART_PATH,
  type ArtAsk,
  type ArtGroup,
  type ArtItem,
  type ArtReview,
  type ArtSource,
  type ArtStudioOptions,
  type WalkStrip,
  type WalkerView,
} from './art-studio/types.ts';

/** The Art tab's server side. */
export class ArtStudio {
  private redone: ArtManifest = {};
  private readonly history: ArtHistory;
  private readonly catalog: ArtCatalog;
  readonly upNext: UpNextQueue;
  readonly director: ArtDirector;
  private loaded = false;
  /** Owner requests, one after another, behind any start-up painting. */
  private queue: Promise<void> = Promise.resolve();
  /** Requests waiting or painting, so tests and shutdown can wait for them. */
  readonly pending = new Set<Promise<void>>();
  /** Requests a limit stopped (the budget, today's clips), kept until resume() asks for them again. */
  private stopped: { request: PaintRequest; release: () => void }[] = [];
  private cachedCatalog: {
    imageModel: string | null;
    videoModel: string | null;
    items: ArtItem[];
    groups: ArtGroup[];
    walkers: WalkerView[];
    bodies: { id: string; name: string }[];
    sounds: SoundItem[];
    effectsModel: string | null;
    musicModel: string | null;
  } | null = null;
  private cachedAt = 0;
  private catalogPromise: Promise<NonNullable<ArtStudio['cachedCatalog']>> | null = null;

  constructor(private readonly options: ArtStudioOptions) {
    const origOnPainted = options.onPainted;
    options.onPainted = (ids) => {
      this.invalidateOverview();
      origOnPainted?.(ids);
    };
    this.history = new ArtHistory(options.artDir, options.recipes);
    this.catalog = new ArtCatalog(options, this.history, this.redoneDir, () => this.manifest());
    this.upNext = new UpNextQueue(options.artDir, options.store.kept);
    this.director = new ArtDirector({
      artDir: options.artDir,
      kept: options.store.kept,
      anchorDir: options.anchorDir,
      ai: options.ai,
      budget: options.budget,
      catalog: this.catalog,
      readArt: options.readArt,
    });
  }

  private get redoneDir(): string {
    return resolve(this.options.artDir, 'redone');
  }

  /** Art shipped with the game that the Owner had painted again, for clients to load. */
  async manifest(): Promise<ArtManifest> {
    await this.load();
    return this.redone;
  }

  /** Invalidates the in-memory cached overview so the next overview call fetches fresh catalog data. */
  invalidateOverview(): void {
    this.cachedCatalog = null;
    this.cachedAt = 0;
  }

  private async buildCatalogData(): Promise<NonNullable<ArtStudio['cachedCatalog']>> {
    await this.load();
    await this.options.walks.load();
    const imageModel = this.options.ai.image()?.model ?? null;
    const videoModel = this.options.ai.video()?.model ?? null;
    const shipped = await this.options.shipped();
    const painted: ArtManifest = { ...(await this.options.wishes.kitManifest()), ...this.options.buildings.manifest(), ...this.options.walks.manifest() };
    const items = await this.catalog.items(shipped, painted);
    return {
      imageModel,
      videoModel,
      items,
      groups: groupsOf(items),
      walkers: await this.catalog.walkerViews(shipped, painted, this.catalog.pictureUsd('walks')),
      bodies: Object.values(BODY_TYPES).map((b) => ({ id: b.id, name: b.name })),
      sounds: (await this.options.sounds?.list()) ?? [],
      effectsModel: this.options.sounds?.models().effects ?? null,
      musicModel: this.options.sounds?.models().music ?? null,
    };
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
    const TTL_MS = 60_000;
    const now = Date.now();
    if (!this.cachedCatalog || now - this.cachedAt > TTL_MS) {
      if (!this.catalogPromise) {
        this.catalogPromise = this.buildCatalogData().finally(() => {
          this.catalogPromise = null;
        });
      }
      this.cachedCatalog = await this.catalogPromise;
      this.cachedAt = Date.now();
    }
    return {
      ...this.cachedCatalog,
      sheets: (await this.options.sheets?.overview()) ?? [],
      budget: this.options.budget.state(),
      jobs: this.options.jobs.list(),
    };
  }

  /**
   * Exactly what a request would send to the AI models, before anything is
   * painted: the Owner approves this, and the request then names its
   * fingerprint so nothing different is painted.
   */
  async review(ask: ArtAsk): Promise<ArtReview> {
    return reviewAsk(ask, this.options, this.catalog, this.redoneDir);
  }

  /** Refuses a request unless the Owner approved exactly what it will send now. */
  async approved(ask: ArtAsk, approved: unknown): Promise<void> {
    this.refuseWhenSpent();
    if (typeof approved !== 'string' || !approved) throw new ArtRequestError('Review what will be sent first, then approve it.');
    const now = await this.review(ask);
    if (now.fingerprint !== approved) throw new ArtRequestError('Something changed since you reviewed this (the model, the prompt or a picture sent along). Review it again before painting.');
  }

  /**
   * Paints a normal map for one of the game's own pictures, in place of the
   * one the game works out; the Owner's `prompt` replaces the usual words.
   */
  async paintNormal(asset: string, prompt?: string): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const { name, provider } = await normalAsk(asset, prompt, this.options, this.catalog);
    const id = normalMapId(asset);
    const estimateUsd = estimateImageUsd(provider.model);
    const handle = this.options.jobs.add(id, `Normal map of ${name}`, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      // Read again when its turn comes, so the map is made for the picture shown then.
      const { picture, request } = await normalAsk(asset, prompt, this.options, this.catalog);
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

  /**
   * Paints a building look's texture sheet, or only some of its textures
   * again. The new painting is kept beside the others and checked for free;
   * a texture is used only once a painting of it passes.
   */
  async paintSheet(look: string, textures: string[] = [], note = ''): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const { label, provider } = await sheetAsk(look, textures, note, this.options);
    const estimateUsd = estimateImageUsd(provider.model);
    const id = `kit-sheet-${look}`;
    const handle = this.options.jobs.add(id, label, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      // Made again when its turn comes, so a sheet painted meanwhile is painted over.
      const { request, guide } = await sheetAsk(look, textures, note, this.options);
      handle.start();
      const image = await watched(provider, handle).generate(request);
      const usd = imageUsd(provider.model, image);
      this.options.budget.spend('image', { provider: provider.id, model: provider.model }, usd);
      const kept = await this.options.sheets!.keep(look, image.data, guide);
      this.invalidateOverview();
      await this.options.recipes.record(`${id}-${kept.id.split('/')[1]}`, { at: Date.now(), steps: [await this.options.recipes.imageStep(label, provider, request, usd)] });
      handle.done(usd);
      // checked now, so the Art tab shows how it fared as soon as it can
      const checking = this.options.sheets!.checked(look).finally(() => this.invalidateOverview());
      this.hold(checking);
    }, handle, { kind: 'sheet', look, ...(textures.length ? { textures } : {}), ...(note ? { note } : {}) });
    return { estimateUsd };
  }

  /**
   * Paints one picture again: a building's, shipped scenery or a shipped
   * character or item, or a granted wish's (`<wish id>:<picture id>`).
   * The Owner's `note` and `references` are sent to the image model.
   */
  async repaint(asset: string, note = '', references?: string[]): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    note = note.trim().slice(0, 1000);
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    const building = Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`));
    const kit = this.catalog.kitAsset(asset);
    const use: ArtUse = wishId ? 'wishes' : building ? 'buildings' : kit ? useOf(kit) : 'wishes';
    const provider = this.options.ai.image(use);
    if (!provider) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const estimateUsd = estimateImageUsd(provider.model);
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      if (!record || record.status !== 'granted') throw new ArtRequestError('That wish is not granted, so it has no picture to paint again.');
      const prompts = note ? { [pictureId]: `${this.catalog.promptOf(record, pictureId)}\nAlso: ${note}` } : {};
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
      }, handle, { kind: 'repaint', asset, note, ...(references ? { references } : {}) });
      return { estimateUsd };
    }
    if (!kit) throw new ArtRequestError('There is no picture by that name.');
    const shipped = (await this.options.shipped())[asset] ?? seaCaveBox(asset) ?? homeLandBox(asset);
    if (!shipped) throw new ArtRequestError('That picture is not part of the game yet.');
    const handle = this.options.jobs.add(asset, kit.name ?? asset, 'picture', 'gods-view', estimateUsd);
    this.enqueue(async () => {
      await this.keepCurrent(asset);
      await this.repaintShipped(kit, { width: shipped.width, height: shipped.height }, note, handle, references);
    }, handle, { kind: 'repaint', asset, note, ...(references ? { references } : {}) });
    return { estimateUsd };
  }

  /**
   * Paints a walker standing in one direction, and only that, so the Owner
   * can look at it (and paint it again) before a walk clip is made from it.
   */
  async paintView(walkerId: string, direction: string, prompt?: string, from?: string[]): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.catalog.walker(walkerId, 'two-legged');
    const d = this.catalog.way(direction);
    const image = this.options.ai.image('walks');
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const estimateUsd = estimateImageUsd(image.model);
    const own = ownPrompt(prompt);
    const handle = this.options.jobs.add(`${walker.id}-${d}`, `${walker.name} standing, facing ${facingWords(d)}`, 'picture', 'gods-view', estimateUsd);
    const sources = await this.catalog.sourcesFor(walker, d, from);
    this.enqueue(() => this.options.walks.paintView(walker, d, own, handle, sources), handle, { kind: 'view', walker: walkerId, direction: d, ...(own ? { prompt: own } : {}), ...(sources ? { from: [...sources] } : {}) });
    return { estimateUsd };
  }

  /**
   * Paints the four isometric ways of one walker, or of every walker missing
   * some, together on one sheet a walker, so each walker keeps one look.
   */
  async paintWays(walkerId?: string, note?: string, references?: string[]): Promise<{ estimateUsd: number; count: number }> {
    this.refuseWhenSpent();
    const image = this.options.ai.image('walks');
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const todo = await this.catalog.waysToPaint(walkerId);
    if (!todo.length) throw new ArtRequestError('Every walker already has a standing picture for every isometric way.');
    const usd = estimateImageUsd(image.model);
    for (const walker of todo) {
      const handle = this.options.jobs.add(`${walker.id}-ways`, `${walker.name} standing in the four isometric ways`, 'picture', 'gods-view', usd);
      this.enqueue(async () => {
        let customRefBuffers: { data: Buffer; label: string }[] | undefined;
        if (references && references.length > 0) {
          customRefBuffers = [];
          for (const ref of references) {
            const resolved = await resolveReferenceImage(ref, {
              anchorDir: this.options.anchorDir,
              artDir: this.options.artDir,
              outDir: this.redoneDir,
              readArt: this.options.readArt,
              nameOf: (id) => this.catalog.nameOf(id),
            });
            if (resolved) {
              const magentaBuf = await sharp(resolved.data).flatten({ background: KEY_COLOR.hex }).png().toBuffer();
              customRefBuffers.push({ data: magentaBuf, label: `${resolved.label}'s approved picture, on magenta` });
            }
          }
        }
        return this.options.walks.paintWays(walker, handle, note, customRefBuffers);
      }, handle, { kind: 'ways', walker: walker.id, note, references });
    }
    return { estimateUsd: usd * todo.length, count: todo.length };
  }

  /** Makes one direction's walk clip from the standing picture there now, and only that. */
  async makeClip(walkerId: string, body: string, direction: string, prompt?: string): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.catalog.walker(walkerId, body);
    const d = this.catalog.way(direction);
    const video = this.options.ai.video();
    if (!video) throw new ArtRequestError("Walks are made with Google's video model, which needs Google AI Studio as the image model and its key.");
    const estimateUsd = estimateClipUsd(video.model);
    const own = ownPrompt(prompt);
    const handle = this.options.jobs.add(walkArt(walker.id, d), `${walker.name} walking ${facingWords(d)}`, 'clip', 'gods-view', estimateUsd);
    this.enqueue(() => this.options.walks.makeClip(walker, d, own, handle), handle, { kind: 'clip', walker: walkerId, body, direction: d, ...(own ? { prompt: own } : {}) });
    return { estimateUsd };
  }

  /** Adopts a denied walk clip that was previously flagged by automated consistency checks. */
  async adoptDeniedClip(walkerId: string, body: string, direction: string, useRetry = false): Promise<boolean> {
    this.invalidateOverview();
    const walker = this.catalog.walker(walkerId, body);
    const d = this.catalog.way(direction);
    return this.options.walks.adoptDeniedClip(walker, d, useRetry);
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
    const { items } = await this.catalog.group(groupId);
    let estimateUsd = 0;
    for (const item of items) estimateUsd += (await this.repaint(item.id)).estimateUsd;
    return { estimateUsd, count: items.length };
  }

  /**
   * Puts an earlier version of a picture back, or with `version` "shipped"
   * the picture that shipped with the game. The one it replaces is kept.
   */
  async restore(asset: string, version: string): Promise<void> {
    this.invalidateOverview();
    if (version === 'shipped') {
      if (!(await this.options.shipped())[asset]) throw new ArtRequestError('That picture did not ship with the game.');
      await this.load();
      const file = await this.catalog.currentFile(asset);
      if (file) await this.history.keep(asset, file, await this.catalog.recipeOf(asset));
      await this.options.recipes.forget(asset);
      if (this.redone[asset]) {
        delete this.redone[asset];
        await this.saveRedone();
      } else {
        await this.options.buildings.forget(asset);
      }
      return;
    }
    const file = await this.catalog.currentFile(asset);
    if (!file || !(await this.history.restore(asset, version, file, await this.catalog.recipeOf(asset)))) throw new ArtRequestError('That earlier version is not there any more.');
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) this.options.wishes.touchArt(wishId, pictureId);
    else if (this.redone[asset]) {
      this.redone[asset] = { ...this.redone[asset]!, file: `${this.redone[asset]!.file.split('?')[0]}?v=${Date.now().toString(36)}`, redone: Date.now() };
      await this.saveRedone();
    } else await this.options.buildings.touch(asset);
  }

  /** Puts a walk in one direction back as it was in an earlier version, for free. */
  async restoreWalk(walkerId: string, direction: string, version: string): Promise<void> {
    this.invalidateOverview();
    const found = this.catalog.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restore(found, this.catalog.facing(direction), version))) throw new ArtRequestError('That earlier walk is not there any more.');
  }

  /** Puts an earlier standing picture back in one direction, for free; its walk clip is not made again. */
  async restoreView(walkerId: string, direction: string, version: string): Promise<void> {
    this.invalidateOverview();
    const found = this.catalog.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restoreView(found, this.catalog.facing(direction), version))) throw new ArtRequestError('That earlier picture is not there any more.');
  }

  /** Puts an earlier version of a sound back, for free. */
  async restoreSound(id: string, version: string): Promise<void> {
    this.invalidateOverview();
    if (!(await this.options.sounds?.restore(id, version))) throw new ArtRequestError('That earlier version is not there any more.');
  }

  /** Puts a picture's current file aside before it is painted again, when it was painted here, with what made it. */
  private async keepCurrent(asset: string): Promise<void> {
    const file = await this.catalog.currentFile(asset);
    if (file) await this.history.keep(asset, file, await this.catalog.recipeOf(asset));
  }

  private async saveRedone(): Promise<void> {
    await mkdir(this.redoneDir, { recursive: true });
    await writeFile(resolve(this.redoneDir, 'manifest.json'), JSON.stringify(this.redone, null, 2));
    this.invalidateOverview();
  }

  /** The painting log, newest first. */
  jobs(): ArtJob[] {
    return this.options.jobs.list();
  }

  /** Waits for every request so far (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    this.invalidateOverview();
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
    if (request.kind === 'view') return this.paintView(request.walker, request.direction, request.prompt, request.from);
    if (request.kind === 'ways') return this.paintWays(request.walker, request.note, request.references);
    if (request.kind === 'clip') return this.makeClip(request.walker, request.body, request.direction, request.prompt);
    if (request.kind === 'repaint') return this.repaint(request.asset, request.note, request.references);
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
      try {
        if ((await task()) === false) this.stop(request);
      } finally {
        this.invalidateOverview();
      }
    });
    this.queue = run.catch((err) => {
      console.error("Painting from God's View failed:", (err as Error).message);
      handle?.fail(plain(err));
      this.invalidateOverview();
    });
    this.hold(this.queue);
    if (request) this.options.requests?.hold(request, this.queue);
  }

  private hold(job: Promise<unknown>): void {
    const held = job.then(() => undefined, () => undefined);
    this.pending.add(held);
    void held.finally(() => this.pending.delete(held));
  }

  /** Paints a shipped scenery piece, character or item again, at its shipped size. */
  private async repaintShipped(
    asset: KitAsset,
    box: { width: number; height: number },
    note: string,
    handle: ArtJobHandle,
    references?: string[],
  ): Promise<void> {
    const provider = this.options.ai.image(useOf(asset));
    if (!provider) return handle.skip("No image model is set in God's View.");
    handle.start();
    const sent = keepingImage(watched(provider, handle));
    const { image, entry } = await paintKitAsset(withSelf(asset), sent, this.options.anchorDir, this.redoneDir, {
      box,
      note,
      references,
      artDir: this.options.artDir,
      readArt: this.options.readArt,
      nameOf: (id) => this.catalog.nameOf(id),
    });
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

  /** Saves an uploaded image data URL or image fetched from a URL into the art references directory. */
  async saveReference(input: { dataUrl?: string; url?: string; name?: string }): Promise<ArtReferenceInfo> {
    let buffer: Buffer;
    let name = input.name?.trim();
    if (input.dataUrl) {
      const match = input.dataUrl.match(/^data:image\/[a-zA-Z+.-]+;base64,(.+)$/);
      if (!match) throw new ArtRequestError('Invalid image data URL.');
      buffer = Buffer.from(match[1]!, 'base64');
    } else if (input.url) {
      const res = await fetch(input.url);
      if (!res.ok) throw new ArtRequestError(`Failed to fetch image from URL: ${res.statusText}`);
      buffer = Buffer.from(await res.arrayBuffer());
      if (!name) {
        try {
          name = new URL(input.url).pathname.split('/').pop()?.replace(/\.[^/.]+$/, '');
        } catch {}
      }
    } else {
      throw new ArtRequestError('No image provided.');
    }
    const png = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const hash = createHash('sha1').update(png).digest('hex').slice(0, 16);
    const dir = resolve(this.options.artDir, 'references');
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `${hash}.png`), png);
    const refName = name || `Reference ${hash.slice(0, 6)}`;
    const metaFile = resolve(dir, 'meta.json');
    const meta: Record<string, string> = await readFile(metaFile, 'utf8').then((t) => JSON.parse(t) as Record<string, string>, () => ({}));
    meta[hash] = refName;
    await writeFile(metaFile, JSON.stringify(meta, null, 2));
    return {
      id: `ref:${hash}`,
      name: refName,
      url: `/wished-art/references/${hash}.png`,
    };
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.redone = JSON.parse(await readFile(resolve(this.redoneDir, 'manifest.json'), 'utf8').catch(() => '{}')) as ArtManifest;
    this.loaded = true;
  }
}
