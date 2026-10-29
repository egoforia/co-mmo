import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MAX_WORKSHOP_LINES,
  WISH_CATEGORIES,
  checkDraft,
  isPictured,
  cleanLocks,
  draftCost,
  draftFromDefinition,
  cleanDraftFields,
  mergeGodFields,
  placeholderArt,
  regionPictures,
  reviewPlan,
  wishSubcategory,
  worldLines,
  type ArtPreview,
  type BiomeId,
  type CheckedDraft,
  type PicturedWish,
  type SamplePreview,
  type DraftView,
  type PicturePreview,
  type PlayerInfo,
  type WishDefinition,
  type WishDraft,
  type WorkshopLine,
} from '@co-mmo/shared';
import type { ChatTurn } from './ai/chat.ts';
import { REFERENCE_NOTE } from './assets/gemini.ts';
import { FILL_REQUEST } from './god.ts';
import { buildPrompt } from './assets/style.ts';
import { readKitManifest, wildKit } from './assets/wild-kit.ts';
import { artRequest, estimateImageUsd } from './assets/wish-art.ts';
import { type Store } from './store.ts';
import { DEFAULT_WORKSHOP } from './settings.ts';
import type { AiServices } from './ai/services.ts';
import type { Budget } from './budget.ts';
import type { PaintedSample, Wishes } from './wishes.ts';
import type { World } from './world.ts';

export interface WorkshopOptions {
  /** Where approved anchors live; a preview lists only the references painting would find. */
  anchorDir: string;
  /** Where painted wish art is written (a biome kit painted once is not painted again). */
  artDir: string;
  now?: () => number;
  /** The image model samples are painted with. */
  ai: AiServices;
  /** Samples pause once the month's budget nears its end. */
  budget: Budget;
}

/**
 * The Wish Workshop (Wish Workshop design doc): a player shapes one wish at
 * a time by category, sees what it will make, cost and look like, and sends
 * it as the usual wish card. Previews are worked out here and cost nothing:
 * nothing is painted until a wish is granted.
 */
export class Workshop {
  private readonly now: () => number;
  /** Players whose sample is being painted, so one click paints one picture. */
  private readonly sampling = new Set<string>();

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

  /** Sends a player their draft, if they have one (on joining, and after it changes); `god` when the God changed it. */
  async greet(playerId: string, god = false): Promise<void> {
    const draft = this.store.draftOf(playerId, this.now());
    this.world.sendTo(playerId, { t: 'draft', view: draft ? await this.view(playerId, draft) : null, ...(god ? { god } : {}) });
  }

  /**
   * Starts a new draft in a subcategory, replacing any old one. With `carry`,
   * the talk from the Talk tab comes along and the God fills the draft in from it.
   */
  async start(player: PlayerInfo, category: string, sub: string, fields?: unknown, carry = false): Promise<void> {
    const kind = wishSubcategory(category, sub);
    if (!kind) return;
    const chat = carry ? talkLines(this.wishes.talkOf(player.id).conversation) : [];
    this.store.saveDraft(player.id, { category, sub, fields: cleanDraftFields(kind, fields), at: this.now(), ...(chat.length ? { chat } : {}) });
    if (carry && chat.length) return this.turn(player, 'Fill this in from what we talked about.', true);
    await this.greet(player.id, carry);
  }

  /**
   * "Shape this wish" in Talk: the wish on the player's open card becomes a
   * draft at once (no God turn needed). Without one, the player is asked to
   * pick a kind of wish, and the God fills it in from the talk.
   */
  async shape(player: PlayerInfo): Promise<void> {
    const talk = this.wishes.talkOf(player.id);
    const shaped = talk.wish?.definition && draftFromDefinition(talk.wish.definition);
    if (!shaped) {
      this.world.sendTo(player.id, { t: 'draft', view: null, pick: true });
      return;
    }
    const chat = [...talkLines(talk.conversation), { who: 'god' as const, text: 'Here is the wish as we spoke of it. Change anything you like, or ask me.' }];
    this.store.saveDraft(player.id, { ...shaped, at: this.now(), chat: chat.slice(-MAX_WORKSHOP_LINES) });
    await this.greet(player.id, true);
  }

  /** Replaces the draft's fields (and locks) with what the player has written. */
  async edit(player: PlayerInfo, fields: unknown, locked?: unknown): Promise<void> {
    if (!this.write(player.id, fields, locked)) return;
    await this.greet(player.id);
  }

  /** The player says something to the God about the draft. */
  async ask(player: PlayerInfo, said: string, fields?: unknown, locked?: unknown): Promise<void> {
    const text = said.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (fields !== undefined) this.write(player.id, fields, locked);
    if (text) await this.turn(player, text, false);
  }

  /** "Ask the God to fill the rest": every empty field the player has not locked, in one turn. */
  async fill(player: PlayerInfo, fields?: unknown, locked?: unknown): Promise<void> {
    if (fields !== undefined) this.write(player.id, fields, locked);
    await this.turn(player, FILL_REQUEST, true);
  }

  /** Saves what the player typed; false when there is no draft. */
  private write(playerId: string, fields: unknown, locked: unknown): boolean {
    const draft = this.store.draftOf(playerId, this.now());
    const kind = draft && wishSubcategory(draft.category, draft.sub);
    if (!draft || !kind) return false;
    const { card: _c, ...rest } = draft;
    this.store.saveDraft(playerId, {
      ...rest,
      fields: fields === undefined ? draft.fields : cleanDraftFields(kind, fields),
      ...(locked === undefined ? {} : { locked: cleanLocks(kind, locked) }),
      at: this.now(),
    });
    return true;
  }

  /**
   * One God turn about the draft: the player's line shows at once, then the
   * God's answer, its field changes (never to locked fields) and quick answers.
   */
  private async turn(player: PlayerInfo, said: string, fill: boolean): Promise<void> {
    const id = player.id;
    const draft = this.store.draftOf(id, this.now());
    const category = draft && WISH_CATEGORIES.find((c) => c.id === draft.category);
    const sub = draft && wishSubcategory(draft.category, draft.sub);
    if (!draft || !category || !sub) return;
    const chat = addLine(draft.chat, { who: 'you', text: said });
    const { choices: _old, ...asked } = draft;
    this.store.saveDraft(id, { ...asked, chat, at: this.now() });
    await this.greet(id);

    const history: ChatTurn[] = chat.map((l) => ({ role: l.who === 'you' ? 'user' : 'assistant', content: l.text }));
    const locked = draft.locked ?? [];
    const result = await this.wishes.consult(player, { category, sub, fields: draft.fields, locked, fill }, history);

    // The player may have typed, dropped or restarted the draft while the God thought.
    const latest = this.store.draftOf(id, this.now());
    if (!latest || latest.category !== draft.category || latest.sub !== draft.sub) return;
    const reply = 'reply' in result ? result.reply : { say: result.refused, fields: {}, choices: [] };
    const merged = mergeGodFields(sub, latest.fields, reply.fields, latest.locked ?? []);
    const { card, choices: _c, ...rest } = latest;
    this.store.saveDraft(id, {
      ...rest,
      // A card made before the God changed the draft no longer matches it.
      ...(card && !merged.changed.length ? { card } : {}),
      fields: merged.fields,
      chat: addLine(latest.chat, { who: 'god', text: reply.say }),
      ...(reply.choices.length ? { choices: reply.choices } : {}),
      at: this.now(),
    });
    await this.greet(id, true);
  }

  /** Turns the draft into the usual wish card, offered in the Prayer window. */
  async send(player: PlayerInfo): Promise<void> {
    const draft = this.store.draftOf(player.id, this.now());
    const category = draft && WISH_CATEGORIES.find((c) => c.id === draft.category);
    const sub = draft && wishSubcategory(draft.category, draft.sub);
    if (!draft || !category || !sub) return;
    const checked = checkDraft(draft, player.name);
    if (checked.problems.length) {
      this.world.sendTo(player.id, { t: 'god', say: `Not yet: ${checked.problems[0]}` });
      return;
    }
    // Reviewers and the rule compiler read the brief first, then the talk that shaped it.
    const talk: ChatTurn[] = (draft.chat ?? []).map((l) => ({ role: l.who === 'you' ? 'user' : 'assistant', content: l.text }));
    const conversation = talk.length ? talk : [{ role: 'user' as const, content: `Shaped in the Wish Workshop: ${checked.title}. ${checked.summary}` }];
    const cardId = this.wishes.offer(
      player,
      { tier: checked.tier, title: checked.title, summary: checked.summary, definition: checked.definition },
      conversation,
      'Here is your wish, as you shaped it. Grant it when you are ready.',
      {
        shaped: { category: `${category.name}: ${sub.name}`, ...(checked.brief ? { brief: checked.brief } : {}) },
        ...(draft.sample ? { sample: paintedSample(player.id, draft.sample) } : {}),
        look: sub.makes === 'player' || sub.makes === 'calling',
      },
    );
    if (cardId) this.store.saveDraft(player.id, { ...draft, card: cardId });
  }

  /**
   * Paints one sample of the draft's picture for Favor, when the Owner has
   * switched samples on and the month's spending is under the warning line.
   * A sample painted from the prompt the wish is sent with becomes its art.
   */
  async sample(player: PlayerInfo): Promise<void> {
    const id = player.id;
    const draft = this.store.draftOf(id, this.now());
    if (!draft || this.sampling.has(id)) return;
    const checked = checkDraft(draft, player.name);
    const region = this.world.regionOf(id);
    const biome = (region?.def.biome ?? 'sanctum') as BiomeId;
    const blocked = this.sampleBlocked(id, draft, checked);
    const def = checked.definition;
    const favor = this.sampleFavor();
    if (blocked || !def || !region || !pictured(def)) return this.tell(id, blocked ?? 'There is nothing to paint yet.');

    this.sampling.add(id);
    void this.world.change(id, { op: 'favor', amount: -favor });
    let painted: PaintedSample | undefined;
    try {
      painted = await this.wishes.paintSample(id, def, biome);
    } catch (err) {
      console.error('Sample failed:', (err as Error).message);
    } finally {
      this.sampling.delete(id);
    }
    if (!painted) {
      void this.world.change(id, { op: 'favor', amount: favor });
      return this.tell(id, 'The paint would not take. Your Favor is returned; try again later.');
    }
    const latest = this.store.draftOf(id, this.now()) ?? draft;
    const { prompt, references, note, provider, model, usd } = painted.record;
    this.store.saveDraft(id, {
      ...latest,
      sample: { prompt, references, ...(note ? { note } : {}), provider, model, usd, url: `/wished-art/samples/${id}.png?v=${this.now().toString(36)}`, at: this.now() },
      chat: addLine(latest.chat, { who: 'god', text: 'Here is a sample. If you send the wish as it is, this picture becomes its art.' }),
      at: this.now(),
    });
    await this.greet(id, true);
  }

  /** Why a sample cannot be painted for this draft now, in plain words; undefined when it can. */
  private sampleBlocked(playerId: string, draft: WishDraft, checked: CheckedDraft): string | undefined {
    const settings = this.store.settings.workshop ?? DEFAULT_WORKSHOP;
    if (!settings.samples) return 'Samples are switched off in this world.';
    if (draft.sample) return 'Each draft gets one sample, and this one has had it.';
    if (checked.problems.length || !checked.definition) return 'Finish the wish first, then a sample can be painted.';
    if (!this.options.ai.image('wishes')) return 'No image model is chosen in God\'s View, so nothing can be painted.';
    if (this.options.budget.state().warn) return 'This month\'s art budget is nearly spent, so samples are paused.';
    const favor = this.world.regionOf(playerId)?.character(playerId)?.favor ?? 0;
    if (favor < settings.sampleFavor) return `A sample costs ${settings.sampleFavor} Favor, and you hold ${favor}.`;
    return undefined;
  }

  private sampleFavor(): number {
    return (this.store.settings.workshop ?? DEFAULT_WORKSHOP).sampleFavor;
  }

  /** A line from the God in the Workshop talk. */
  private async tell(playerId: string, text: string): Promise<void> {
    const draft = this.store.draftOf(playerId, this.now());
    if (draft) this.store.saveDraft(playerId, { ...draft, chat: addLine(draft.chat, { who: 'god', text }), at: this.now() });
    await this.greet(playerId, true);
  }

  /** Throws the draft away. */
  async drop(player: PlayerInfo): Promise<void> {
    this.store.saveDraft(player.id, null);
    await this.greet(player.id);
  }

  /** The draft as the Workshop shows it: what is missing, the card, the numbers and the art. */
  async view(playerId: string, draft: WishDraft): Promise<DraftView> {
    const checked = checkDraft(draft, this.store.accountById(playerId)?.name);
    const region = this.world.regionOf(playerId);
    const problems = [...checked.problems];
    // An unfinished draft has no definition yet, so its card shows only the tier and price it will have.
    const made = region && !checked.problems.length && checked.tier !== 'refused'
      ? this.wishes.cardFor(playerId, { tier: checked.tier, title: checked.title, summary: checked.summary, definition: checked.definition }, region.def.name, checked.makes === 'player' || checked.makes === 'calling')
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
        ...(checked.definition && checked.definition.kind !== 'recipe' && checked.definition.kind !== 'loot' && checked.definition.kind !== 'calling' && checked.definition.kind !== 'skill' ? { art: await this.art(playerId, checked.definition, biome, draft, checked) } : {}),
      },
    };
  }

  /** What the image model would be asked for, built by the same code that paints. */
  private async art(playerId: string, def: Exclude<WishDefinition, { kind: 'recipe' | 'loot' | 'calling' | 'skill' }>, biome: BiomeId, draft: WishDraft, checked: CheckedDraft): Promise<ArtPreview> {
    const provider = this.options.ai.image('wishes');
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
    const budget = this.options.budget.state();
    const notice = !provider
      ? 'No image model is chosen in God\'s View, so it keeps the picture below.'
      : budget.over ? 'This month\'s art budget is spent, so it keeps the picture below for now.'
        : budget.overToday ? 'Today\'s art spending is used up, so it keeps the picture below until tomorrow.' : undefined;
    return {
      model: provider?.model ?? null,
      ...(provider ? { usdEach: estimateImageUsd(provider.model) } : {}),
      ...(notice ? { notice } : {}),
      placeholder: placeholderArt(def),
      pictures,
      mine: playerWords(draft),
      ...this.samplePreview(playerId, draft, checked, pictured(def) ? pictures[0]?.prompt : undefined),
    };
  }

  /** The sample part of the art preview: shown when samples are on, or when one was painted. */
  private samplePreview(playerId: string, draft: WishDraft, checked: CheckedDraft, prompt: string | undefined): { sample?: SamplePreview } {
    const on = (this.store.settings.workshop ?? DEFAULT_WORKSHOP).samples;
    if (!prompt || (!on && !draft.sample)) return {};
    const blocked = this.sampleBlocked(playerId, draft, checked);
    return {
      sample: {
        favor: this.sampleFavor(),
        ...(blocked ? { blocked } : {}),
        ...(draft.sample ? { url: draft.sample.url, current: draft.sample.prompt === prompt } : {}),
      },
    };
  }
}

/** Wishes with one picture of their own, which a sample can stand in for. */
function pictured(def: WishDefinition): def is PicturedWish {
  return isPictured(def);
}

/** A draft's sample as the wish's record will keep it. */
function paintedSample(playerId: string, s: NonNullable<WishDraft['sample']>): PaintedSample {
  return { playerId, record: { prompt: s.prompt, references: s.references, ...(s.note ? { note: s.note } : {}), provider: s.provider, model: s.model, at: s.at, usd: s.usd } };
}

/** Adds a line to a draft's talk, keeping the latest few. */
function addLine(chat: WorkshopLine[] | undefined, line: WorkshopLine): WorkshopLine[] {
  return [...(chat ?? []), { ...line, text: line.text.slice(0, 600) }].slice(-MAX_WORKSHOP_LINES);
}

/** The latest Talk turns as Workshop talk. */
function talkLines(conversation: ChatTurn[]): WorkshopLine[] {
  return conversation.slice(-6).map((t) => ({ who: t.role === 'user' ? 'you' : 'god', text: t.content.slice(0, 600) }));
}

/** The player's own words in a draft, longest first, so the client can mark them in the prompt. */
function playerWords(draft: WishDraft): string[] {
  const words = Object.values(draft.fields).filter((v): v is string => typeof v === 'string' && v.trim().length > 2);
  return [...new Set(words.map((w) => w.trim()))].sort((a, b) => b.length - a.length);
}
