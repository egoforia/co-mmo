// Art catalog discovery: assembling items, wished items, walkers, recipes,
// prompts and disk file paths for God's View's Art tab.

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  BODY_TYPES,
  BUILDING_STYLES,
  FACINGS,
  ISO_WAYS,
  WALK_CYCLE_SECONDS,
  WALK_FRAMES,
  isFacing,
  regionPictures,
  ruleItemId,
  walkArt,
  wishArtKey,
  type ArtManifest,
  type BiomeId,
  type Facing,
  type IsoWay,
  type ItemWish,
  type PicturedWish,
} from '@co-mmo/shared';
import type { ArtHistory } from '../art-history.ts';
import { buildingPlace, landName, shippedPlace, wishedPlace, type ArtPlace } from '../art-places.ts';
import type { Recipe } from '../art-recipes.ts';
import { ANCHORS } from '../assets/anchors.ts';
import { buildingArtJobs } from '../assets/building-art.ts';
import type { KitAsset } from '../assets/kit.ts';
import { pictureName } from '../assets/names.ts';
import { kitPieces } from '../assets/sea-cave-kit.ts';
import { wildKit } from '../assets/wild-kit.ts';
import { artRequest, estimateImageUsd } from '../assets/wish-art.ts';
import { normalMapId } from '../normal-painter.ts';
import type { ArtUse } from '../settings.ts';
import type { ContentRecord } from '../store.ts';
import { estimateClipUsd, type ViewSource, type Walker } from '../walk-painter.ts';
import {
  type ArtItem,
  ArtRequestError,
  type ArtSource,
  type ArtStudioOptions,
  type WalkerView,
  groupsOf,
  repaintableKit,
  slash,
  useOf,
  viewSources,
} from './types.ts';

export class ArtCatalog {
  constructor(
    private readonly options: ArtStudioOptions,
    private readonly history: ArtHistory,
    private readonly redoneDir: string,
    private readonly getRedone: () => Promise<ArtManifest>,
  ) {}

  /** About what one picture of this kind costs with its model. */
  pictureUsd(use: ArtUse): number {
    return estimateImageUsd(this.options.ai.image(use)?.model ?? '');
  }

  /** Every picture, where it sits, and what made it. */
  async items(shipped: ArtManifest, painted: ArtManifest): Promise<ArtItem[]> {
    const redone = await this.getRedone();
    const url = (id: string): { url?: string; source: ArtSource } => {
      if (redone[id]) return { url: `/${redone[id]!.file}`, source: 'redone' };
      if (painted[id]?.redone) return { url: slash(painted[id]!.file), source: 'redone' };
      if (shipped[id]) return { url: slash(shipped[id]!.file), source: 'shipped' };
      if (painted[id]) return { url: slash(painted[id]!.file), source: 'painted' };
      return { source: 'missing' };
    };
    const items: ArtItem[] = [];
    for (const a of kitPieces().filter(repaintableKit)) {
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
      const normal = redone[normalMapId(item.id)];
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
  wishedItems(picture: number): ArtItem[] {
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
  walkerList(): (Walker & { kind: string; url?: string; place: ArtPlace })[] {
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

  async walkerViews(shipped: ArtManifest, painted: ArtManifest, picture: number): Promise<WalkerView[]> {
    const clip = estimateClipUsd(this.options.ai.video()?.model ?? '');
    const views: WalkerView[] = [];
    for (const w of this.walkerList()) {
      const walks: WalkerView['walks'] = {};
      const runs: WalkerView['runs'] = {};
      const attacks: WalkerView['attacks'] = {};
      const lost: WalkerView['lost'] = {};
      for (const d of FACINGS) {
        const id = walkArt(w.id, d);
        const entry = painted[id] ?? shipped[id];
        const versions = await this.options.walks.versions(w.id, d);
        if (entry) {
          const recipe = painted[id] ? await this.options.recipes.current(id) : undefined;
          walks[d] = { url: slash(entry.file), frames: entry.frames ?? WALK_FRAMES, width: entry.width, height: entry.height, cycleSeconds: entry.cycleSeconds ?? WALK_CYCLE_SECONDS, ...(recipe ? { recipe } : {}), versions };
        } else if (versions.length) {
          lost[d] = versions;
        }

        const runId = `${w.id}-run-${d}`;
        const runEntry = painted[runId] ?? shipped[runId];
        if (runEntry) {
          runs[d] = { url: slash(runEntry.file), frames: runEntry.frames ?? 10, width: runEntry.width, height: runEntry.height, cycleSeconds: runEntry.cycleSeconds ?? 0.67, versions: [] };
        }

        const attackId = `${w.id}-attack-${d}`;
        const attackEntry = painted[attackId] ?? shipped[attackId];
        if (attackEntry) {
          attacks[d] = { url: slash(attackEntry.file), frames: attackEntry.frames ?? 12, width: attackEntry.width, height: attackEntry.height, cycleSeconds: attackEntry.cycleSeconds ?? 0.8, versions: [] };
        }
      }
      const standing = {} as WalkerView['standing'];
      for (const d of FACINGS) standing[d] = await this.options.walks.standing(w, d, w.url);
      // What its isometric ways still need: one sheet for the missing pictures, and a clip for each way that does not walk.
      const sheet = ISO_WAYS.some((d) => !standing[d].url) ? picture : 0;
      const estimateUsd = sheet + ISO_WAYS.filter((d) => !walks[d]).length * clip;
      views.push({ id: w.id, name: w.name, kind: w.kind, ...(w.url ? { url: w.url } : {}), place: w.place, walks, runs, attacks, lost, standing, estimateUsd, clipUsd: clip, viewUsd: picture });
    }
    return views;
  }

  /** One group's pictures that can be painted again; refused when there are none. */
  async group(groupId: string): Promise<{ title: string; items: ArtItem[] }> {
    const painted: ArtManifest = { ...(await this.options.wishes.kitManifest()), ...this.options.buildings.manifest() };
    const group = groupsOf(await this.items(await this.options.shipped(), painted)).find((g) => g.id === groupId);
    if (!group) throw new ArtRequestError('There is no group of pictures by that name.');
    const items = group.items.filter((i) => i.repaintable && i.source !== 'missing');
    if (!items.length) throw new ArtRequestError('Nothing in that group can be painted again.');
    return { title: group.title, items };
  }

  /** A walker by id, with the body type chosen. */
  walker(walkerId: string, body: string): Walker {
    const found = this.walkerList().find((w) => w.id === walkerId);
    if (!found) throw new ArtRequestError('There is nothing by that name to make walk.');
    if (!BODY_TYPES[body]) throw new ArtRequestError('That body type is unknown.');
    return { ...found, body };
  }

  /** A way a walk painted before can face: a top-down direction or an isometric way. */
  facing(facing: string): Facing {
    if (!isFacing(facing)) throw new ArtRequestError('That is not a direction.');
    return facing;
  }

  /** A way a walker is painted facing now: one of the four isometric ways. */
  way(facing: string): IsoWay {
    if (!(ISO_WAYS as readonly string[]).includes(facing)) throw new ArtRequestError('Walkers are painted facing one of the four isometric ways.');
    return facing as IsoWay;
  }

  /** The walkers whose four ways a ways sheet paints: the one named, or every walker missing a way. */
  async waysToPaint(walkerId?: string): Promise<Walker[]> {
    if (walkerId) return [this.walker(walkerId, 'two-legged')];
    const out: Walker[] = [];
    for (const walker of this.walkerList()) {
      for (const way of ISO_WAYS) {
        if ((await this.options.walks.standing(walker, way)).url) continue;
        out.push(walker);
        break;
      }
    }
    return out;
  }

  /**
   * What a standing picture is painted from: the pictures chosen, or the
   * approved picture and the other isometric ways already painted, so it
   * matches them.
   */
  async sourcesFor(walker: Walker, direction: IsoWay, from: string[] | undefined): Promise<ViewSource[] | undefined> {
    return viewSources(from) ?? this.otherWays(walker, direction);
  }

  /** The approved picture, and the painted standing pictures of the other isometric ways. */
  private async otherWays(walker: Walker, way: IsoWay): Promise<ViewSource[]> {
    const from: ViewSource[] = ['approved'];
    for (const other of ISO_WAYS) {
      if (other === way) continue;
      const view = await this.options.walks.standing(walker, other);
      if (view.url && !view.approved) from.push(other);
    }
    return from;
  }

  /** A shipped scenery piece, character or item that can be painted again. */
  kitAsset(asset: string): KitAsset | undefined {
    return [...kitPieces().filter(repaintableKit), ...ANCHORS.filter((a) => a.kind !== 'effect')].find((a) => a.id === asset) as KitAsset | undefined;
  }

  /** A picture's name, for a review's title. */
  async nameOf(asset: string): Promise<string> {
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

  /** The prompt a wish's picture was last painted with, or would be. */
  promptOf(record: ContentRecord, pictureId: string): string {
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

  /**
   * What made the picture shown now: kept when it was painted, or for
   * pictures from before recipes were kept, what is known about them.
   */
  async recipeOf(asset: string, shipped = false): Promise<Recipe | undefined> {
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
  async shippedRecipe(asset: string): Promise<Recipe | undefined> {
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

  /** Where the picture the game shows now is loaded from, for the game's own pictures. */
  async pictureFile(asset: string): Promise<string | undefined> {
    const redone = await this.getRedone();
    const painted = this.options.buildings.manifest();
    const shipped = await this.options.shipped();
    return redone[asset]?.file ?? (painted[asset]?.redone ? painted[asset]!.file : undefined) ?? shipped[asset]?.file ?? painted[asset]?.file;
  }

  /**
   * The file on disk a picture is shown from, when it was painted here:
   * a wish's picture, a building picture, or shipped art painted again.
   * Wished lands' scenery is shared by every region of the land and has no history.
   */
  async currentFile(asset: string): Promise<string | undefined> {
    const [wishId, pictureId] = asset.includes(':') ? asset.split(':', 2) : [];
    if (wishId && pictureId) {
      const record = this.options.store.contentById(wishId);
      const def = record?.definition;
      if (def?.kind === 'region' && wildKit(def.biome).some((a) => a.id === pictureId)) return undefined;
      return resolve(this.options.artDir, `${pictureId}.png`);
    }
    const redone = await this.getRedone();
    if (redone[asset]) return resolve(this.redoneDir, basename(redone[asset]!.file.split('?')[0]!));
    return this.options.buildings.fileOf(asset);
  }

  /** Which image model paints a picture's things. */
  useFor(asset: string): ArtUse {
    if (Object.values(BUILDING_STYLES).some((s) => asset.startsWith(`${s.id}-`))) return 'buildings';
    const kit = this.kitAsset(asset);
    return kit ? useOf(kit) : 'wishes';
  }
}
