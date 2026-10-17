import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isPictured,
  standing,
  regionDef,
  regionPictures,
  ruleItemId,
  type BiomeId,
  type ItemWish,
  type PicturedWish,
  type RegionWish,
} from '@co-mmo/shared';
import type { AiServices } from '../ai/services.ts';
import type { Budget } from '../budget.ts';
import { REFERENCE_NOTE } from '../assets/gemini.ts';
import type { ImageProvider } from '../assets/provider.ts';
import { artRequest, estimateImageUsd, imageUsd, paintWish, type PaintedWish } from '../assets/wish-art.ts';
import { confirmReuse, lookLine, reuseCandidates, type LibraryPicture } from '../assets/reuse.ts';
import { freeChecks, judgePicture, retryNote } from '../assets/style-check.ts';
import type { ArtJobHandle, ArtJobs } from '../art-jobs.ts';
import { Previewed, dryImage, type Recipe, type RecipeBook } from '../art-recipes.ts';
import { pictureName } from '../assets/names.ts';
import { watched } from '../paint-queue.ts';
import type { PaintRequest, PaintRequests } from '../paint-requests.ts';
import { KIT_ART_PATH, paintKitAsset, readKitManifest, wildKit } from '../assets/wild-kit.ts';
import type { ArtPromptRecord, ContentRecord, Store } from '../store.ts';
import { styleCheckSettings } from '../settings.ts';
import type { WishNews } from './news.ts';

/** A sample picture painted for a Workshop draft, and how it was asked for. */
export interface PaintedSample {
  /** The player whose sample it is (the file is samples/<player id>.png in the art directory). */
  playerId: string;
  record: ArtPromptRecord;
}

/** What the wish painter needs: where art lives, the models, the money and the logs. */
export interface WishPainterParts {
  store: Store;
  ai: AiServices;
  budget: Budget;
  news: WishNews;
  now: () => number;
  /** Where approved anchors live (style references) and where painted wish art is written. */
  options: { anchorDir: string; artDir: string };
  /** The painting log God's View shows. */
  artJobs?: ArtJobs;
  /** Wish paintings kept across a restart until they are done. */
  paintRequests?: PaintRequests;
  /** Keeps what was sent to make each picture, for God's View. */
  recipes?: RecipeBook;
}

/**
 * Paints what was wished (design doc, Art style): one picture for an item,
 * creature or person, one per item for a rule, a region's people and its
 * biome's kit. Every painting is queued, budgeted, style-checked and
 * reviewable before it is sent.
 */
export class WishPainter {
  /** Art being painted, so tests and shutdown can wait for it. */
  readonly painting = new Set<Promise<void>>();
  private readonly store: Store;
  private readonly ai: AiServices;
  private readonly budget: Budget;
  private readonly news: WishNews;
  private readonly now: () => number;
  private readonly options: { anchorDir: string; artDir: string };
  private readonly artJobs?: ArtJobs;
  private readonly paintRequests?: PaintRequests;
  private readonly recipes?: RecipeBook;

  constructor(parts: WishPainterParts) {
    this.store = parts.store;
    this.ai = parts.ai;
    this.budget = parts.budget;
    this.news = parts.news;
    this.now = parts.now;
    this.options = parts.options;
    this.artJobs = parts.artJobs;
    this.paintRequests = parts.paintRequests;
    this.recipes = parts.recipes;
  }

  /**
   * Uses a Workshop sample as a granted wish's art when it was painted from
   * exactly the prompt the wish would be painted from now. True if used.
   */
  async useSample(record: ContentRecord, sample: PaintedSample): Promise<boolean> {
    const def = record.definition;
    if (!def || !isPictured(def)) return false;
    const biome = (regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    if (artRequest(def, biome).prompt !== sample.record.prompt) return false;
    try {
      await copyFile(resolve(this.options.artDir, 'samples', `${sample.playerId}.png`), resolve(this.options.artDir, `${record.id}.png`));
    } catch {
      return false;
    }
    const current = this.store.contentById(record.id);
    if (!current) return true;
    const updated = this.store.updateContent(record.id, {
      art: `/wished-art/${record.id}.png?v=${this.now().toString(36)}`,
      usd: current.usd + sample.record.usd,
      artPrompts: { [record.id]: { ...sample.record, at: this.now() } },
    });
    if (updated) this.news.broadcast(updated);
    return true;
  }

  /**
   * Paints a Workshop sample of a draft's picture for a player, recorded as
   * sample spend. The Workshop checks the switch, the budget and the Favor.
   */
  async paintSample(playerId: string, def: PicturedWish, biome: BiomeId): Promise<PaintedSample | undefined> {
    const provider = this.ai.image('wishes');
    if (!provider) return undefined;
    const painted = await paintWish(playerId, def, biome, provider, this.options.anchorDir, resolve(this.options.artDir, 'samples'));
    const usd = imageUsd(provider.model, painted.image);
    this.budget.spend('image', { provider: provider.id, model: provider.model }, usd, playerId, { sample: true });
    return { playerId, record: this.promptRecord(provider, painted.request.prompt, painted.request.references, usd) };
  }


  /**
   * Paints a granted wish's art when a provider is set and the budget allows:
   * one picture for an item, creature or person, one per item for a rule.
   */
  paint(record: ContentRecord, force = false, prompts: Record<string, string> = {}, only?: string): Promise<void> | undefined {
    if (!record.definition || record.status !== 'granted' || record.definition.kind === 'recipe' || record.definition.kind === 'loot') return undefined;
    const provider = this.ai.image('wishes');
    if (!provider) return undefined;
    if (!force && this.budget.state().paused) return undefined;
    const def = record.definition;
    if (def.kind === 'region') return this.keep({ record, force, only, prompts }, this.track(this.paintRegion(record, def, provider, force, only, prompts)));
    const biome = (regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    const pictures: { id: string; def: PicturedWish }[] = def.kind === 'rule'
      ? Object.entries(def.items).map(([key, item]) => ({ id: ruleItemId(record.id, key), def: { kind: 'item', ...item } as ItemWish }))
      : [{ id: record.id, def }];
    const chosen = pictures.filter((p) => (only ? p.id === only : force || !hasArt(record, p.id)));
    const handles = chosen.map((p) => this.queueArt(p.id, p.def.name, force, provider));
    const job = (async () => {
      for (const [i, picture] of chosen.entries()) {
        const handle = handles[i];
        if (!force && this.budget.state().paused) {
          for (const left of handles.slice(i)) left?.skip(this.budget.state().why ?? "The budget is spent.");
          break;
        }
        let painted;
        try {
          painted = await this.paintPicture(picture, biome, provider, handle, record, { prompt: prompts[picture.id], reuse: !force });
        } catch {
          continue;
        }
        const { usd } = painted;
        const current = this.store.contentById(record.id);
        if (!current) return;
        const url = `/wished-art/${picture.id}.png?v=${this.now().toString(36)}`;
        const artPrompts = { ...current.artPrompts, [picture.id]: painted.record };
        const updated = this.store.updateContent(record.id, def.kind === 'rule'
          ? { itemArt: { ...current.itemArt, [picture.id]: url }, usd: current.usd + usd, artPrompts }
          : { art: url, usd: current.usd + usd, artPrompts });
        if (updated) this.news.broadcast(updated);
      }
    })().finally(() => this.painting.delete(job));
    this.painting.add(job);
    return this.keep({ record, force, only, prompts }, job);
  }

  /**
   * Tells players a wish's picture file changed on disk (an earlier version
   * was put back), so browsers load it afresh. False when it has no such picture.
   */
  touchArt(recordId: string, pictureId: string): boolean {
    const record = this.store.contentById(recordId);
    if (!record || !hasArt(record, pictureId)) return false;
    const url = `/wished-art/${pictureId}.png?v=${this.now().toString(36)}`;
    const updated = this.store.updateContent(record.id, pictureId === record.id ? { art: url } : { itemArt: { ...record.itemArt, [pictureId]: url } });
    if (updated) this.news.broadcast(updated);
    return true;
  }

  /** Paints a wish's pictures again after a restart cut their painting short. */
  resumePaint(request: Extract<PaintRequest, { kind: 'wish' }>): void {
    const record = this.store.contentById(request.record);
    if (record) this.paint(record, request.force, request.prompts, request.only);
  }

  /** Keeps a wish's painting until it is done, so a restart asks for it again. */
  private keep(asked: { record: ContentRecord; force: boolean; only?: string; prompts: Record<string, string> }, job: Promise<void>): Promise<void> {
    const prompts = Object.keys(asked.prompts).length ? { prompts: asked.prompts } : {};
    this.paintRequests?.hold({ kind: 'wish', record: asked.record.id, force: asked.force, ...(asked.only ? { only: asked.only } : {}), ...prompts }, job);
    return job;
  }

  /**
   * Paints a wished region: its biome's kit the first time that biome is
   * wished (ground, water, two trees and a rock, about five pictures, kept
   * for every later region of the biome), then its new creatures and person.
   */
  private async paintRegion(record: ContentRecord, def: RegionWish, provider: ImageProvider, force: boolean, only?: string, prompts: Record<string, string> = {}): Promise<void> {
    const dir = resolve(this.options.artDir, 'biomes');
    const kit = await readKitManifest(dir);
    const kitUrl = (id: string) => kit[id] && `/${KIT_ART_PATH}/${kit[id]!.file}`;
    const update = (patch: Partial<ContentRecord>) => {
      const updated = this.store.updateContent(record.id, patch);
      if (updated) this.news.broadcast(updated);
      return updated;
    };
    // The Owner's Repaint paints the biome's kit again too.
    const kitAssets = wildKit(def.biome).filter((a) => (only ? a.id === only : !kit[a.id] || force));
    const pictures = regionPictures(record.id, def).filter((p) => (only ? p.id === only : force || !hasArt(record, p.id)));
    // Scenery can have its own image model (AI models tab).
    const scenery = this.ai.image('scenery') ?? provider;
    const kitJobs = kitAssets.map((a) => this.queueArt(a.id, a.name, force, scenery));
    const pictureJobs = pictures.map((p) => this.queueArt(p.id, p.def.name, force, provider));
    const skipAll = () => {
      for (const left of [...kitJobs, ...pictureJobs]) left?.skip(this.budget.state().why ?? "The budget is spent.");
    };
    for (const [i, asset] of kitAssets.entries()) {
      if (!force && this.budget.state().paused) return skipAll();
      kitJobs[i]?.start();
      try {
        const { image, entry, prompt, references } = await paintKitAsset(asset, watched(scenery, kitJobs[i]), this.options.anchorDir, dir, prompts[asset.id] ? { prompt: prompts[asset.id] } : {});
        const usd = imageUsd(scenery.model, image);
        kitJobs[i]?.done(usd);
        this.budget.spend('image', { provider: scenery.id, model: scenery.model }, usd, record.wisher.id);
        kit[asset.id] = { ...entry, file: `${entry.file}?v=${this.now().toString(36)}` };
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(kit, null, 2));
        const current = this.store.contentById(record.id);
        if (current) update({ usd: current.usd + usd, artPrompts: { ...current.artPrompts, [asset.id]: this.promptRecord(scenery, prompt, references, usd) } });
      } catch (err) {
        console.error(`Painting ${asset.id} failed:`, (err as Error).message);
        kitJobs[i]?.fail((err as Error).message);
      }
    }
    // Every region of this biome shows the kit, including ones wished before it was painted.
    this.showKit(def.biome, kitUrl);
    for (const [i, picture] of pictures.entries()) {
      if (!force && this.budget.state().paused) return skipAll();
      let painted;
      try {
        painted = await this.paintPicture(picture, def.biome, provider, pictureJobs[i], record, { prompt: prompts[picture.id], reuse: !force });
      } catch {
        continue;
      }
      const current = this.store.contentById(record.id);
      if (!current) return;
      update({
        itemArt: { ...current.itemArt, [picture.id]: `/wished-art/${picture.id}.png?v=${this.now().toString(36)}` },
        usd: current.usd + painted.usd,
        artPrompts: { ...current.artPrompts, [picture.id]: painted.record },
      });
    }
  }

  /** Points every granted region of a biome at its painted kit. */
  private showKit(biome: string, kitUrl: (id: string) => string | undefined): void {
    const kitArt = Object.fromEntries(wildKit(biome as BiomeId).flatMap((a) => (kitUrl(a.id) ? [[a.id, kitUrl(a.id)!]] : [])));
    if (!Object.keys(kitArt).length) return;
    for (const other of this.store.content) {
      if (other.status === 'granted' && other.definition?.kind === 'region' && other.definition.biome === biome) {
        const updated = this.store.updateContent(other.id, { kitArt });
        if (updated) this.news.broadcast(updated);
      }
    }
  }

  /**
   * Exactly what painting one of a granted wish's pictures again would send,
   * without painting it; `prompt` is the Owner's wording in place of the
   * built one. As the Owner's repaint, it borrows no existing picture.
   */
  async preview(record: ContentRecord, pictureId: string, prompt?: string): Promise<Recipe> {
    const def = record.definition;
    if (!def || record.status !== 'granted' || def.kind === 'recipe' || def.kind === 'loot') throw new Error('That wish has no picture to paint.');
    const recipes = this.recipes!;
    const kit = def.kind === 'region' ? wildKit(def.biome).find((a) => a.id === pictureId) : undefined;
    if (kit) {
      const scenery = this.ai.image('scenery') ?? this.ai.image('wishes');
      if (!scenery) throw new Error('No image model is set. Choose one on the AI models tab first.');
      const dry = dryImage(scenery);
      await paintKitAsset(kit, dry, this.options.anchorDir, resolve(this.options.artDir, 'biomes'), prompt ? { prompt } : {}).catch(onlyPreviewed);
      return { at: this.now(), steps: [await recipes.imageStep(kit.name ?? kit.id, scenery, dry.sent!, estimateImageUsd(scenery.model))] };
    }
    const provider = this.ai.image('wishes');
    if (!provider) throw new Error('No image model is set. Choose one on the AI models tab first.');
    const biome = (def.kind === 'region' ? def.biome : regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    const pictures: { id: string; def: PicturedWish }[] = def.kind === 'region' ? regionPictures(record.id, def)
      : def.kind === 'rule' ? Object.entries(def.items).map(([key, item]) => ({ id: ruleItemId(record.id, key), def: { kind: 'item', ...item } as ItemWish }))
      : [{ id: record.id, def }];
    const picture = pictures.find((p) => p.id === pictureId);
    if (!picture) throw new Error('That wish has no picture by that name.');
    const dry = dryImage(provider);
    await paintWish(picture.id, picture.def, biome, dry, this.options.anchorDir, this.options.artDir, prompt).catch(onlyPreviewed);
    const each = estimateImageUsd(provider.model);
    const { retries } = styleCheckSettings(this.store.settings);
    const notes = [
      this.ai.judgeModel() ? 'The style check looks at the result for well under a cent.' : 'The free style checks look at the result.',
      ...(retries ? [`If it is not happy, the picture is painted again with what went wrong added to the prompt, up to ${retries} more ${retries === 1 ? 'time' : 'times'} for about $${each.toFixed(3)} each.`] : []),
    ];
    return { at: this.now(), steps: [await recipes.imageStep(picture.def.name, provider, dry.sent!, each)], notes };
  }

  /** Adds a wished picture to the painting log as waiting its turn. */
  private queueArt(id: string, name: string, force: boolean, provider: ImageProvider): ArtJobHandle | undefined {
    return this.artJobs?.add(id, name, 'picture', force ? 'gods-view' : 'wish', estimateImageUsd(provider.model));
  }

  /**
   * Paints one wished picture (design doc, Art style). A new wish first looks
   * for an existing picture that fits and shows it for nearly nothing. Else it
   * is painted and style-checked, and painted again with what went wrong, up
   * to the retries set in God's View. A picture that never passes keeps its
   * best attempt and the Stewards are told. Spending is recorded as it
   * happens; a painting that fails outright throws after logging.
   */
  private async paintPicture(
    picture: { id: string; def: PicturedWish },
    biome: BiomeId,
    provider: ImageProvider,
    handle: ArtJobHandle | undefined,
    wish: ContentRecord,
    { prompt, reuse }: { prompt?: string; reuse: boolean },
  ): Promise<{ record: ArtPromptRecord; usd: number }> {
    const wisherId = wish.wisher.id;
    const key = `${wish.id}:${picture.id}`;
    const settings = styleCheckSettings(this.store.settings);
    const judge = this.ai.judgeModel();
    const file = resolve(this.options.artDir, `${picture.id}.png`);
    let usd = 0;
    const spendChat = (cost: number) => {
      usd += cost;
      if (cost > 0 && judge) this.budget.spend('chat', judge, cost, wisherId);
    };
    handle?.start();
    if (reuse && settings.reuse && judge && !prompt) {
      const found = await confirmReuse(judge, picture.def, reuseCandidates(picture.def, this.library(picture.id)));
      spendChat(found.usd);
      if (found.picture) {
        const copied = await mkdir(this.options.artDir, { recursive: true }).then(() => copyFile(resolve(this.options.artDir, `${found.picture!.id}.png`), file)).then(() => true, () => false);
        if (copied) {
          handle?.done(usd);
          await this.recipes?.forget(key);
          const base = this.promptRecord(provider, artRequest(picture.def, biome).prompt, [], usd);
          return { record: { ...base, provider: judge.provider, model: judge.model, reused: { from: found.picture.id, name: found.picture.def.name } }, usd };
        }
      }
    }
    const asked = prompt ?? artRequest(picture.def, biome).prompt;
    let best: { painted: PaintedWish; rank: number; why?: string } | undefined;
    let last: PaintedWish | undefined;
    let tries = 0;
    for (let attempt = 0; attempt <= settings.retries; attempt++) {
      if (attempt > 0 && this.budget.state().paused) break;
      try {
        last = await paintWish(picture.id, picture.def, biome, watched(provider, handle), this.options.anchorDir, this.options.artDir, best?.why ? `${asked}\n${retryNote(best.why)}` : prompt);
      } catch (err) {
        console.error(`Painting ${picture.id} failed:`, (err as Error).message);
        if (best) break;
        handle?.fail((err as Error).message);
        throw err;
      }
      tries++;
      const cost = imageUsd(provider.model, last.image);
      usd += cost;
      this.budget.spend('image', { provider: provider.id, model: provider.model }, cost, wisherId);
      let verdict = await freeChecks(last.cutOut, last.plainBackground);
      const free = verdict.pass;
      if (free && judge) {
        const judged = await judgePicture(judge, last.fitted, last.referenceImages, lookLine(picture.def));
        spendChat(judged.usd);
        verdict = judged;
      }
      // A picture the judge passed beats one that only passed the free checks, which beats a broken one; ties go to the later try.
      const rank = verdict.pass ? 2 : free ? 1 : 0;
      if (!best || rank >= best.rank) best = { painted: last, rank, ...(verdict.why ? { why: verdict.why } : {}) };
      if (verdict.pass) break;
    }
    const kept = best!;
    if (kept.painted !== last) await writeFile(file, kept.painted.fitted);
    handle?.done(usd);
    const pass = kept.rank === 2 || (kept.rank === 1 && !judge);
    if (!pass) this.news.notifyStewards(`The style check was not happy with the picture of ${picture.def.name} after ${tries} tries: ${kept.why}. It is shown for now; the Art tab in God's View can paint it again.`);
    const record = this.promptRecord(provider, asked, kept.painted.request.references, usd);
    if (this.recipes) {
      const request = { prompt: kept.painted.request.prompt, references: kept.painted.referenceImages.map((data) => ({ mimeType: 'image/png', data })), labels: kept.painted.request.references.map(pictureName) };
      const step = await this.recipes.imageStep(picture.def.name, provider, request, usd);
      const checked = pass ? `The style check passed${tries > 1 ? ` on try ${tries}` : ''}.` : `The style check was not happy after ${tries} ${tries === 1 ? 'try' : 'tries'}: ${kept.why}`;
      // Every try is paid for; the cost shown is all of them, the prompt the kept one's.
      await this.recipes.record(key, { at: this.now(), steps: [step], notes: [checked] });
    }
    return { record: { ...record, check: { pass, ...(pass ? {} : { why: kept.why }), tries } }, usd };
  }

  /** Painted wished pictures a new one might borrow, leaving out the picture being painted. */
  private library(except: string): LibraryPicture[] {
    const pictures: LibraryPicture[] = [];
    for (const record of this.store.content) {
      const def = record.definition;
      if (record.status !== 'granted' || !def || def.kind === 'recipe' || def.kind === 'loot') continue;
      const all: LibraryPicture[] = def.kind === 'region' ? regionPictures(record.id, def)
        : def.kind === 'rule' ? Object.entries(def.items).map(([key, item]) => ({ id: ruleItemId(record.id, key), def: { kind: 'item', ...item } as ItemWish }))
        : [{ id: record.id, def }];
      // Reused pictures are copies: borrowing the original keeps one source.
      for (const p of all) if (p.id !== except && hasArt(record, p.id) && !record.artPrompts?.[p.id]?.reused) pictures.push(p);
    }
    return pictures;
  }

  /** What one painting asked of the image model, as God's View shows it. */
  private promptRecord(provider: ImageProvider, prompt: string, references: string[], usd: number): ArtPromptRecord {
    const note = provider.id === 'gemini' && references.length ? REFERENCE_NOTE : undefined;
    return { prompt, references, ...(note ? { note } : {}), provider: provider.id, model: provider.model, at: this.now(), usd };
  }

  /** Keeps a painting job where tests and shutdown can wait for it. */
  track(work: Promise<void>): Promise<void> {
    const job = work.catch((err) => console.error('Painting failed:', (err as Error).message)).finally(() => this.painting.delete(job));
    this.painting.add(job);
    return job;
  }


  /** Painted kit art for every biome painted so far, for clients to load at start. */
  async kitManifest(): Promise<Record<string, { file: string; kind: string; width: number; height: number }>> {
    const kit = await readKitManifest(resolve(this.options.artDir, 'biomes'));
    return Object.fromEntries(Object.entries(kit).map(([id, e]) => [id, { ...e, file: `/${KIT_ART_PATH}/${e.file}` }]));
  }

  /**
   * Paints whatever granted wishes still lack (say, what today's cap held
   * back), now that the budget allows; pictures already painted are kept.
   */
  paintMissing(): void {
    if (this.budget.state().paused) return;
    for (const record of this.store.content) {
      if (standing(record) && record.definition) this.paint(record);
    }
  }
}

/** True when a wish's picture was painted already. */
function hasArt(record: ContentRecord, pictureId: string): boolean {
  return pictureId === record.id ? Boolean(record.art) : Boolean(record.itemArt?.[pictureId]);
}

/** A dry run stops at the request; anything else is a real failure. */
function onlyPreviewed(err: unknown): void {
  if (!(err instanceof Previewed)) throw err;
}
