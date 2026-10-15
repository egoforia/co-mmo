import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkDraft,
  draftCost,
  cleanDraftFields,
  placeholderArt,
  regionPictures,
  reviewPlan,
  wishSubcategory,
  worldLines,
  type ArtPreview,
  type BiomeId,
  type DraftView,
  type PicturePreview,
  type PlayerInfo,
  type WishDefinition,
  type WishDraft,
} from '@co-mmo/shared';
import { REFERENCE_NOTE } from './assets/gemini.ts';
import { buildPrompt } from './assets/style.ts';
import { readKitManifest, wildKit } from './assets/wild-kit.ts';
import { artRequest, estimateImageUsd } from './assets/wish-art.ts';
import type { Store } from './store.ts';
import type { Wishes } from './wishes.ts';
import type { World } from './world.ts';

export interface WorkshopOptions {
  /** Where approved anchors live; a preview lists only the references painting would find. */
  anchorDir: string;
  /** Where painted wish art is written (a biome kit painted once is not painted again). */
  artDir: string;
  now?: () => number;
}

/**
 * The Wish Workshop (Wish Workshop design doc): a player shapes one wish at
 * a time by category, sees what it will make, cost and look like, and sends
 * it as the usual wish card. Previews are worked out here and cost nothing:
 * nothing is painted until a wish is granted.
 */
export class Workshop {
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly wishes: Wishes,
    private readonly options: WorkshopOptions,
  ) {
    this.now = options.now ?? Date.now;
    // A draft goes once the card it became is confirmed.
    wishes.onCardUsed = (playerId, cardId) => {
      if (this.store.draftOf(playerId)?.card === cardId) this.store.saveDraft(playerId, null);
      void this.greet(playerId);
    };
  }

  /** Sends a player their draft, if they have one (on joining, and after it changes). */
  async greet(playerId: string): Promise<void> {
    const draft = this.store.draftOf(playerId, this.now());
    this.world.sendTo(playerId, { t: 'draft', view: draft ? await this.view(playerId, draft) : null });
  }

  /** Starts a new draft in a subcategory, replacing any old one. */
  async start(player: PlayerInfo, category: string, sub: string, fields?: unknown): Promise<void> {
    const kind = wishSubcategory(category, sub);
    if (!kind) return;
    this.store.saveDraft(player.id, { category, sub, fields: cleanDraftFields(kind, fields), at: this.now() });
    await this.greet(player.id);
  }

  /** Replaces the draft's fields with what the player has written. */
  async edit(player: PlayerInfo, fields: unknown): Promise<void> {
    const draft = this.store.draftOf(player.id, this.now());
    const kind = draft && wishSubcategory(draft.category, draft.sub);
    if (!draft || !kind) return;
    const { card: _c, ...rest } = draft;
    this.store.saveDraft(player.id, { ...rest, fields: cleanDraftFields(kind, fields), at: this.now() });
    await this.greet(player.id);
  }

  /** Turns the draft into the usual wish card, offered in the Prayer window. */
  async send(player: PlayerInfo): Promise<void> {
    const draft = this.store.draftOf(player.id, this.now());
    if (!draft) return;
    const checked = checkDraft(draft);
    if (checked.problems.length) {
      this.world.sendTo(player.id, { t: 'god', say: `Not yet: ${checked.problems[0]}` });
      return;
    }
    // The brief (or a plain account of the shaped wish) is what reviewers and the rule compiler read.
    const words = checked.brief?.join('\n') ?? `Shaped in the Wish Workshop: ${checked.title}. ${checked.summary}`;
    const cardId = this.wishes.offer(
      player,
      { tier: checked.tier, title: checked.title, summary: checked.summary, definition: checked.definition },
      [{ role: 'user', content: words }],
      'Here is your wish, as you shaped it. Grant it when you are ready.',
    );
    if (cardId) this.store.saveDraft(player.id, { ...draft, card: cardId });
  }

  /** Throws the draft away. */
  async drop(player: PlayerInfo): Promise<void> {
    this.store.saveDraft(player.id, null);
    await this.greet(player.id);
  }

  /** The draft as the Workshop shows it: what is missing, the card, the numbers and the art. */
  async view(playerId: string, draft: WishDraft): Promise<DraftView> {
    const checked = checkDraft(draft);
    const region = this.world.regionOf(playerId);
    const problems = [...checked.problems];
    // An unfinished draft has no definition yet, so its card shows only the tier and price it will have.
    const made = region && !checked.problems.length && checked.tier !== 'refused'
      ? this.wishes.cardFor(playerId, { tier: checked.tier, title: checked.title, summary: checked.summary, definition: checked.definition }, region.def.name)
      : undefined;
    if (made && 'note' in made) problems.push(made.note);
    const instant = checked.tier === 'minor' || checked.tier === 'moderate';
    const card = made && 'card' in made ? made.card : { tier: checked.tier, title: checked.title, summary: checked.summary, cost: draftCost(checked), where: '', instant };
    // Living things are painted in the biome they appear in: where the player stands.
    const biome = (region?.def.biome ?? 'sanctum') as BiomeId;
    return {
      draft,
      problems,
      preview: {
        card,
        world: checked.definition ? worldLines(checked.definition) : [],
        ...(checked.brief ? { plan: reviewPlan(checked.tier) } : {}),
        ...(checked.definition && checked.definition.kind !== 'recipe' ? { art: await this.art(checked.definition, biome, draft) } : {}),
      },
    };
  }

  /** What the image model would be asked for, built by the same code that paints. */
  private async art(def: Exclude<WishDefinition, { kind: 'recipe' }>, biome: BiomeId, draft: WishDraft): Promise<ArtPreview> {
    const provider = this.wishes.imageProvider();
    const pictures: PicturePreview[] = [];
    const picture = (label: string, prompt: string, wanted: string[], withRaw = false): void => {
      const references = wanted.filter((ref) => existsSync(resolve(this.options.anchorDir, `${ref}.png`)) || (withRaw && existsSync(resolve(this.options.anchorDir, 'raw', `${ref}.png`))));
      const note = provider?.id === 'gemini' && references.length ? REFERENCE_NOTE : undefined;
      pictures.push({ label, prompt, references, ...(note ? { note } : {}) });
    };
    if (def.kind === 'region') {
      // A biome's kit is painted once, the first time a region of it is wished.
      const kit = await readKitManifest(resolve(this.options.artDir, 'biomes'));
      for (const asset of wildKit(def.biome)) {
        if (!kit[asset.id]) picture(`${asset.name} (painted once for every region of this land)`, buildPrompt(asset), asset.references ?? [], true);
      }
      for (const p of regionPictures('preview', def)) {
        const req = artRequest(p.def, def.biome);
        picture(p.def.name, req.prompt, req.references);
      }
    } else {
      const req = artRequest(def, biome);
      picture(def.kind === 'ability' ? `Scroll of ${def.name}` : def.name, req.prompt, req.references);
    }
    const budget = this.wishes.budget();
    const notice = !provider
      ? 'No image model is chosen in God\'s View, so it keeps the picture below.'
      : budget.over ? 'This month\'s art budget is spent, so it keeps the picture below for now.' : undefined;
    return {
      model: provider?.model ?? null,
      ...(provider ? { usdEach: estimateImageUsd(provider.model) } : {}),
      ...(notice ? { notice } : {}),
      placeholder: placeholderArt(def),
      pictures,
      mine: playerWords(draft),
    };
  }
}

/** The player's own words in a draft, longest first, so the client can mark them in the prompt. */
function playerWords(draft: WishDraft): string[] {
  const words = Object.values(draft.fields).filter((v): v is string => typeof v === 'string' && v.trim().length > 2);
  return [...new Set(words.map((w) => w.trim()))].sort((a, b) => b.length - a.length);
}
