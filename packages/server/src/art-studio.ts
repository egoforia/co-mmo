// God's View's Art tab server facade over art-studio/:
// - art-studio/types.ts: shared types, ArtRequestError, REDONE_ART_PATH, and pure helpers
// - art-studio/catalog.ts: ArtCatalog (items, wishedItems, walkerViews, recipes, file lookup)
// - art-studio/review.ts: dry-run Recipe previews and handler registry keyed by ArtAsk['kind']
// Put new catalog queries in art-studio/catalog.ts and new review previews in art-studio/review.ts.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  BODY_TYPES,
  BUILDING_STYLES,
  WALK_DIRECTIONS,
  walkArt,
  type ArtManifest,
  type WalkDirection,
} from '@co-mmo/shared';
import { ArtHistory } from './art-history.ts';
import { plain, type ArtJob, type ArtJobHandle } from './art-jobs.ts';
import { keepingImage } from './art-recipes.ts';
import { ArtCatalog } from './art-studio/catalog.ts';
import { normalAsk, reviewAsk, sheetAsk } from './art-studio/review.ts';
import {
  type ArtAsk,
  type ArtGroup,
  type ArtItem,
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
import { paintKitAsset } from './assets/wild-kit.ts';
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
  private loaded = false;
  /** Owner requests, one after another, behind any start-up painting. */
  private queue: Promise<void> = Promise.resolve();
  /** Requests waiting or painting, so tests and shutdown can wait for them. */
  readonly pending = new Set<Promise<void>>();
  /** Requests a limit stopped (the budget, today's clips), kept until resume() asks for them again. */
  private stopped: { request: PaintRequest; release: () => void }[] = [];

  constructor(private readonly options: ArtStudioOptions) {
    this.history = new ArtHistory(options.artDir, options.recipes);
    this.catalog = new ArtCatalog(options, this.history, this.redoneDir, () => this.manifest());
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
    const items = await this.catalog.items(shipped, painted);
    return {
      imageModel,
      videoModel,
      budget: this.options.budget.state(),
      jobs: this.options.jobs.list(),
      items,
      groups: groupsOf(items),
      walkers: await this.catalog.walkerViews(shipped, painted, this.catalog.pictureUsd('walks')),
      bodies: Object.values(BODY_TYPES).map((b) => ({ id: b.id, name: b.name })),
      sounds: (await this.options.sounds?.list()) ?? [],
      effectsModel: this.options.sounds?.models().effects ?? null,
      musicModel: this.options.sounds?.models().music ?? null,
      sheets: (await this.options.sheets?.overview()) ?? [],
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
      await this.options.recipes.record(`${id}-${kept.id.split('/')[1]}`, { at: Date.now(), steps: [await this.options.recipes.imageStep(label, provider, request, usd)] });
      handle.done(usd);
      // checked now, so the Art tab shows how it fared as soon as it can
      void this.options.sheets!.checked(look).catch(() => undefined);
    }, handle, { kind: 'sheet', look, ...(textures.length ? { textures } : {}), ...(note ? { note } : {}) });
    return { estimateUsd };
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
      }, handle, { kind: 'repaint', asset, note });
      return { estimateUsd };
    }
    if (!kit) throw new ArtRequestError('There is no picture by that name.');
    const shipped = (await this.options.shipped())[asset] ?? seaCaveBox(asset);
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
    const walker = this.catalog.walker(walkerId, body);
    const image = this.options.ai.image('walks');
    const video = this.options.ai.video();
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    if (!video) throw new ArtRequestError("Walks are made with Google's video model, which needs Google AI Studio as the image model and its key.");
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
    const walker = this.catalog.walker(walkerId, 'two-legged');
    const d = this.catalog.facing(direction);
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
  async paintWays(walkerId?: string): Promise<{ estimateUsd: number; count: number }> {
    this.refuseWhenSpent();
    const image = this.options.ai.image('walks');
    if (!image) throw new ArtRequestError('No image model is set. Choose one on the AI models tab first.');
    const todo = await this.catalog.waysToPaint(walkerId);
    if (!todo.length) throw new ArtRequestError('Every walker already has a standing picture for every isometric way.');
    const usd = estimateImageUsd(image.model);
    for (const walker of todo) {
      const handle = this.options.jobs.add(`${walker.id}-ways`, `${walker.name} standing in the four isometric ways`, 'picture', 'gods-view', usd);
      this.enqueue(() => this.options.walks.paintWays(walker, handle), handle, { kind: 'ways', walker: walker.id });
    }
    return { estimateUsd: usd * todo.length, count: todo.length };
  }

  /** Makes one direction's walk clip from the standing picture there now, and only that. */
  async makeClip(walkerId: string, body: string, direction: string, prompt?: string): Promise<{ estimateUsd: number }> {
    this.refuseWhenSpent();
    const walker = this.catalog.walker(walkerId, body);
    const d = this.catalog.facing(direction);
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
    const found = this.catalog.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restore(found, this.catalog.facing(direction), version))) throw new ArtRequestError('That earlier walk is not there any more.');
  }

  /** Puts an earlier standing picture back in one direction, for free; its walk clip is not made again. */
  async restoreView(walkerId: string, direction: string, version: string): Promise<void> {
    const found = this.catalog.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name that walks.');
    if (!(await this.options.walks.restoreView(found, this.catalog.facing(direction), version))) throw new ArtRequestError('That earlier picture is not there any more.');
  }

  /** Puts an earlier version of a sound back, for free. */
  async restoreSound(id: string, version: string): Promise<void> {
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
  }

  /** The painting log, newest first. */
  jobs(): ArtJob[] {
    return this.options.jobs.list();
  }

  /** Waits for every request so far (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
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
    if (request.kind === 'ways') return this.paintWays(request.walker);
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
      console.error("Painting from God's View failed:", (err as Error).message);
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
