import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BIOMES,
  CREATURES,
  isPictured,
  ITEMS,
  WISH_COSTS,
  WishError,
  applyContent,
  contentTier,
  regionFromWish,
  regionPictures,
  wishCost,
  lookFromWords,
  regionDef,
  removeContent,
  ruleItemId,
  validateDefinition,
  validateLookWish,
  validateLoot,
  wishProgress,
  wishArtKey,
  type BiomeId,
  type ContentEntry,
  type ItemWish,
  type PicturedWish,
  type PlayerInfo,
  type RegionWish,
  type Role,
  type Side,
  type WishCard,
  type WishDefinition,
  type WishTier,
} from '@co-mmo/shared';
import type { ChatModel, ChatResult, ChatTurn } from './ai/chat.ts';
import type { AiServices, ServiceOverrides } from './ai/services.ts';
import type { Budget } from './budget.ts';
import { REFERENCE_NOTE } from './assets/gemini.ts';
import type { ImageProvider } from './assets/provider.ts';
import { artRequest, estimateImageUsd, imageUsd, paintWish, type PaintedWish } from './assets/wish-art.ts';
import { confirmReuse, lookLine, reuseCandidates, type LibraryPicture } from './assets/reuse.ts';
import { freeChecks, judgePicture, retryNote } from './assets/style-check.ts';
import type { ArtJobHandle, ArtJobs } from './art-jobs.ts';
import { Previewed, dryImage, type Recipe, type RecipeBook } from './art-recipes.ts';
import { pictureName } from './assets/names.ts';
import { watched } from './paint-queue.ts';
import type { PaintRequest, PaintRequests } from './paint-requests.ts';
import { KIT_ART_PATH, paintKitAsset, readKitManifest, wildKit } from './assets/wild-kit.ts';
import { compileRule } from './compiler.ts';
import { askGod, askWorkshopGod, type GodReply, type PrayerContext, type WorkshopContext, type WorkshopReply } from './god.ts';
import type { LiveRules } from './live-rules.ts';
import { testRule } from './rule-test.ts';
import { type ArtPromptRecord, type ContentRecord, type Store } from './store.ts';
import { styleCheckSettings } from './settings.ts';
import type { World } from './world.ts';

/** Turns of conversation the God remembers per player. */
const MEMORY_TURNS = 12;
/** Prayers a player may send per minute. */
const PRAYERS_PER_MINUTE = 6;
const MAX_PRAYER_LENGTH = 400;
/** What the God says when no model answered. */
const CLOUDED = 'The heavens are clouded; I cannot hear you clearly. Try again soon.';

interface OpenCard {
  card: WishCard;
  playerId: string;
  definition?: WishDefinition;
  /** The Owner naming (or un-naming) a Steward. */
  appoint?: { id: string; name: string; role: Role };
  /** A region wish: the grid square beyond the edge it grows from. */
  edge?: { side: Side; cell: { x: number; y: number } };
  conversation: ChatTurn[];
  usd: number;
  /** Shaped in the Wish Workshop: its subcategory and brief. */
  shaped?: ContentRecord['shaped'];
  /** A sample painted in the Workshop, used as the final art if its prompt still matches. */
  sample?: PaintedSample;
}

/** A sample picture painted for a Workshop draft, and how it was asked for. */
export interface PaintedSample {
  /** The player whose sample it is (the file is samples/<player id>.png in the art directory). */
  playerId: string;
  record: ArtPromptRecord;
}

/** What the Workshop adds to a wish it offers. */
export interface ShapedWish {
  shaped: NonNullable<ContentRecord['shaped']>;
  sample?: PaintedSample;
  /** A new look for the player: allowed only from the Workshop, never from a prayer. */
  look?: boolean;
}

/** What wishes need from the rest of the server. */
export interface WishServices {
  ai: AiServices;
  budget: Budget;
  /** The painting log God's View shows. */
  artJobs?: ArtJobs;
  /** Wish paintings kept across a restart until they are done. */
  paintRequests?: PaintRequests;
  /** Keeps what was sent to make each picture, for God's View. */
  recipes?: RecipeBook;
}

/** Where wish art lives, plus test stand-ins for the AI services (passed on to AiServices). */
export interface WishOptions extends Pick<ServiceOverrides, 'chatModel' | 'compilerModel' | 'imageProvider' | 'judgeModel'> {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Where approved anchors live (style references for wished art). */
  anchorDir: string;
  /** Where painted wish art is written; served at /wished-art/. */
  artDir: string;
}

/**
 * The God's side of the game: prayers, wish cards, granting and undoing
 * wishes, and painting what was wished (design doc, The God; How wishes
 * become mechanics). Models come from AiServices and money from Budget.
 */
export class Wishes {
  private readonly conversations = new Map<string, ChatTurn[]>();
  private readonly cards = new Map<string, OpenCard>();
  private readonly busy = new Set<string>();
  private readonly prayerTimes = new Map<string, number[]>();
  /** Major wishes whose rule is being drafted. */
  private readonly drafting = new Set<string>();
  /** Drafts in flight, so tests and shutdown can wait for them. */
  readonly drafts = new Set<Promise<unknown>>();
  private readonly now: () => number;
  /** The God's, the compiler's, the judge's and the image models. */
  private readonly ai: AiServices;
  /** Spending against the month's budget and today's cap. */
  private readonly budget: Budget;
  /** Art being painted, so tests and shutdown can wait for it. */
  readonly painting = new Set<Promise<void>>();
  private readonly artJobs?: ArtJobs;
  private readonly paintRequests?: PaintRequests;
  private readonly recipes?: RecipeBook;
  /** Told when a confirmed card became a wish (granted or sent for review), so its Workshop draft can go. */
  onCardUsed?: (playerId: string, cardId: string) => void;

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly rules: LiveRules,
    private readonly options: WishOptions,
    services: WishServices,
  ) {
    this.ai = services.ai;
    this.budget = services.budget;
    this.artJobs = services.artJobs;
    this.paintRequests = services.paintRequests;
    this.recipes = services.recipes;
    this.now = options.now ?? Date.now;
  }

  /** Puts every granted wish back into the world (at start-up). */
  restore(): void {
    for (const record of this.store.content) {
      this.apply(record);
      if (record.status !== 'granted') continue;
      this.place(record);
      if (record.definition?.kind === 'rule') {
        this.rules.start(record).catch((err) => console.error(`Rule ${record.id} did not load:`, (err as Error).message));
      }
    }
    // A draft interrupted by a restart can be asked for again.
    for (const record of this.store.content) {
      if (record.draft?.state === 'drafting') this.store.updateContent(record.id, { draft: { ...record.draft, state: 'failed', message: 'The server restarted while drafting. Ask the God to revise.' } });
    }
  }

  /** The content log as players see it. */
  entries(): ContentEntry[] {
    return this.store.content.map(publicEntry);
  }

  // --- Prayer --------------------------------------------------------------

  async pray(player: PlayerInfo, raw: string): Promise<void> {
    const id = player.id;
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PRAYER_LENGTH);
    if (!text) return;
    const region = this.world.regionOf(id);
    const ctx = await this.prayerContext(player);
    if (!region || !ctx) return;
    const refused = this.admit(id);
    if (refused) return this.say(id, refused);

    const history = [...(this.conversations.get(id) ?? []), { role: 'user' as const, content: text }].slice(-MEMORY_TURNS);
    this.busy.add(id);
    const spent = { usd: 0 };
    try {
      const { reply } = await askGod(this.ai.godModels(), ctx, history, this.chatSpend(id, spent));
      history.push({ role: 'assistant', content: reply.say });
      this.conversations.set(id, history.slice(-MEMORY_TURNS));
      const card = reply.wish && this.makeCard(id, reply.wish, region.def.name, history, spent.usd);
      if (card?.note) {
        history.push({ role: 'assistant', content: card.note });
        this.conversations.set(id, history.slice(-MEMORY_TURNS));
      }
      this.world.sendTo(id, { t: 'god', say: card?.note ?? reply.say, ...(card?.card ? { card: card.card } : {}) });
    } catch (err) {
      console.error('Prayer failed:', err);
      this.say(id, CLOUDED);
    } finally {
      this.busy.delete(id);
    }
  }

  /**
   * One God turn about a Workshop draft, under the same limits and budget as
   * prayers. Returns the God's answer, or what to tell the player instead.
   */
  async consult(player: PlayerInfo, w: WorkshopContext, history: ChatTurn[]): Promise<{ reply: WorkshopReply } | { refused: string }> {
    const id = player.id;
    const ctx = await this.prayerContext(player);
    if (!ctx) return { refused: CLOUDED };
    const refused = this.admit(id);
    if (refused) return { refused };
    this.busy.add(id);
    try {
      return { reply: await askWorkshopGod(this.ai.godModels(), ctx, w, history.slice(-MEMORY_TURNS), this.chatSpend(id, { usd: 0 })) };
    } catch (err) {
      console.error('Workshop turn failed:', err);
      return { refused: CLOUDED };
    } finally {
      this.busy.delete(id);
    }
  }

  /** The player's open wish card from Talk and the talk that led to it, for the Workshop to carry on with. */
  talkOf(playerId: string): { wish?: { tier: WishTier; definition?: WishDefinition }; conversation: ChatTurn[] } {
    const open = [...this.cards.values()].find((c) => c.playerId === playerId && !c.appoint);
    return {
      ...(open ? { wish: { tier: open.card.tier, ...(open.definition ? { definition: open.definition } : {}) } } : {}),
      conversation: [...(this.conversations.get(playerId) ?? [])],
    };
  }

  /** What the God is told about where and who the player is, or undefined when they are not in the world. */
  private async prayerContext(player: PlayerInfo): Promise<PrayerContext | undefined> {
    const region = this.world.regionOf(player.id);
    const character = region?.character(player.id);
    if (!region || !character) return undefined;
    const nearby = await region.nearby(player.id);
    return {
      playerName: player.name,
      role: player.role,
      favor: character.favor,
      regionName: region.def.name,
      biome: BIOMES[region.def.biome as BiomeId]?.name ?? region.def.biome,
      nearby,
      edge: this.edgeLine(player.id),
      recentWishes: this.store.content
        .filter((c) => c.status === 'granted')
        .slice(-8)
        .reverse()
        .map((c) => `${c.title} (wished by ${c.wisher.name})`),
    };
  }

  /** Lets a God turn start, or says why not: one at a time, a few a minute (prayers and Workshop turns alike). */
  private admit(id: string): string | undefined {
    if (this.busy.has(id)) return 'Patience. I am still listening to your last prayer.';
    const now = this.now();
    const times = (this.prayerTimes.get(id) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= PRAYERS_PER_MINUTE) return 'Breathe, child. Speak again in a moment.';
    times.push(now);
    this.prayerTimes.set(id, times);
    return undefined;
  }

  /** Records what a God turn cost, as chat spend for this player. */
  private chatSpend(playerId: string, spent: { usd: number }): (result: ChatResult, model: ChatModel) => void {
    return (result, model) => {
      spent.usd += result.usd;
      this.budget.spend('chat', model, result.usd, playerId);
    };
  }

  private makeCard(
    playerId: string,
    wish: NonNullable<GodReply['wish']>,
    regionName: string,
    conversation: ChatTurn[],
    usd: number,
    extra?: ShapedWish,
  ): { card?: WishCard; note?: string } | undefined {
    if (wish.tier === 'refused') return undefined;
    if (wish.appoint) return this.appointCard(playerId, wish.appoint, conversation);
    const made = this.cardFor(playerId, wish, regionName, extra?.look);
    if (!made || 'note' in made) return made;
    for (const [cardId, open] of this.cards) if (open.playerId === playerId) this.cards.delete(cardId);
    const card: WishCard = { id: randomBytes(6).toString('hex'), ...made.card };
    this.cards.set(card.id, {
      card, playerId, definition: made.definition, conversation: [...conversation], usd,
      ...(made.edge ? { edge: made.edge } : {}),
      ...(extra ? { shaped: extra.shaped, ...(extra.sample ? { sample: extra.sample } : {}) } : {}),
    });
    return { card };
  }

  /**
   * The card a wish would make, without offering it: its tier, cost and
   * where it appears, or why it cannot be made here. The Workshop's preview
   * shows this before a wish is sent.
   */
  cardFor(
    playerId: string,
    wish: Pick<NonNullable<GodReply['wish']>, 'tier' | 'title' | 'summary' | 'definition'>,
    regionName: string,
    look = false,
  ): { card: Omit<WishCard, 'id'>; definition?: WishDefinition; edge?: OpenCard['edge'] } | { note: string } | undefined {
    if (wish.tier === 'refused') return undefined;
    let definition: WishDefinition | undefined;
    let tier = wish.tier;
    if (tier === 'minor' || tier === 'moderate') {
      try {
        const raw = wish.definition as { kind?: unknown } | undefined;
        definition = look && raw?.kind === 'player' ? validateLookWish(raw) : validateDefinition(raw);
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
        // Not buildable as content: a person will have to build it.
        tier = 'major';
      }
      // Things for your bag are minor; creatures, people and abilities moderate, whatever the model said.
      if (definition) tier = contentTier(definition);
    }
    // A new region grows beyond the open edge of this one nearest the player.
    let edge: OpenCard['edge'];
    if (definition?.kind === 'region') {
      const open = this.world.openEdge(playerId);
      if (!open) return { note: `Every edge of ${regionName} already meets another land. New regions grow at the world's edge: travel outward and ask me there.` };
      edge = { side: open.side, cell: open.cell };
    }
    const instant = tier === 'minor' || tier === 'moderate';
    const card: Omit<WishCard, 'id'> = {
      tier,
      title: wish.title,
      summary: wish.summary || definition?.description || wish.title,
      cost: definition && instant ? wishCost(definition) : WISH_COSTS[tier],
      where: !instant
        ? tier === 'engine' ? 'Set before the Owner for the next game update' : 'Set before the Stewards for review'
        : definition?.kind === 'player' ? 'Your look, painted for everyone to see'
        : definition?.kind === 'item' ? 'In your bag'
          : definition?.kind === 'ability' ? 'A scroll in your bag'
            : definition?.kind === 'recipe' ? 'Known to everyone, in the crafting book (C)'
              : definition?.kind === 'loot' ? `On every ${CREATURES[definition.creature]?.name ?? 'creature of its kind'} that is defeated`
              : edge ? `Beyond the ${edge.side} edge of ${regionName}`
                : `Beside you, in ${regionName}`,
      instant,
    };
    return { card, ...(definition ? { definition } : {}), ...(edge ? { edge } : {}) };
  }

  /**
   * Offers a wish shaped somewhere other than a prayer (the Workshop) as the
   * usual card, in the Prayer window. Returns the card's id when one was made.
   */
  offer(
    player: PlayerInfo,
    wish: Pick<NonNullable<GodReply['wish']>, 'tier' | 'title' | 'summary' | 'definition'>,
    conversation: ChatTurn[],
    say: string,
    extra?: ShapedWish,
  ): string | undefined {
    const region = this.world.regionOf(player.id);
    if (!region) return undefined;
    const made = this.makeCard(player.id, wish, region.def.name, conversation, 0, extra);
    this.world.sendTo(player.id, { t: 'god', say: made?.note ?? say, ...(made?.card ? { card: made.card } : {}) });
    return made?.card?.id;
  }

  /** The player confirmed or turned down a wish card. */
  answer(player: PlayerInfo, cardId: string, confirm: boolean): void {
    const open = this.cards.get(cardId);
    if (!open || open.playerId !== player.id) return;
    this.cards.delete(cardId);
    if (!confirm) return this.say(player.id, 'As you wish. It stays a dream, for now.');
    if (open.appoint) return this.appoint(player, open.appoint);
    if (!open.card.instant) {
      const record = this.record(player, open, 'pending');
      if (record.tier === 'major') void this.draft(record.id);
      return this.say(player.id, 'It is written. The Stewards will weigh your wish, and you will hear when it is decided.');
    }
    const region = this.world.regionOf(player.id);
    const character = region?.character(player.id);
    const at = region?.position(player.id);
    if (!region || !character || !at || !open.definition) return;
    if (character.favor < open.card.cost) {
      return this.say(player.id, `This wish needs ${open.card.cost} Favor, and you hold ${character.favor}. Help others, finish quests, and return.`);
    }
    const def = open.definition;
    let placements: { x: number; y: number }[] | undefined;
    if (def.kind === 'creature') placements = region.findSpots(at.x, at.y, def.count);
    if (def.kind === 'npc') placements = region.findSpots(at.x, at.y, 1, 1.2, 2);
    if (placements && placements.length === 0) return this.say(player.id, 'There is no room here. Find open ground and ask again.');
    if (def.kind === 'loot' && !CREATURES[def.creature]) return this.say(player.id, 'That creature is no longer in the world. Choose another and ask again.');
    if (def.kind === 'region' && (!open.edge || !this.world.cellFree(open.edge.cell))) {
      return this.say(player.id, 'Another land has grown there since you asked. Find an open edge of the world and wish again.');
    }

    const record = this.record(player, open, 'granted', region.def.id, placements, open.edge?.cell);
    this.apply(record);
    this.place(record);
    void this.world.change(player.id, { op: 'favor', amount: -open.card.cost });
    if (def.kind === 'item' || def.kind === 'ability') void this.world.change(player.id, { op: 'give', item: record.id, qty: 1 });
    this.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${player.name}'s wish: ${record.title}.`, at: this.now() });
    this.say(player.id, def.kind === 'item' || def.kind === 'ability' ? 'It is done. Look in your bag.'
      : def.kind === 'recipe' ? 'It is done. Anyone can make it now: press C to open the crafting book.'
        : def.kind === 'region' ? `It is done. A road now leads ${open.edge!.side} to ${def.name}.`
          : def.kind === 'player' ? 'It is done. Everyone will see your new look.'
            : def.kind === 'loot' ? `It is done. Defeat a ${CREATURES[def.creature]?.name ?? 'creature'} and press E beside its body to see.`
            : 'It is done. Look around you.');
    if (!open.sample) this.paint(record);
    else void this.track(this.useSample(record, open.sample).then((used) => (used ? undefined : this.paint(record))));
  }

  /**
   * Uses a Workshop sample as a granted wish's art when it was painted from
   * exactly the prompt the wish would be painted from now. True if used.
   */
  private async useSample(record: ContentRecord, sample: PaintedSample): Promise<boolean> {
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
    if (updated) this.broadcast(updated);
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

  private record(
    player: PlayerInfo,
    open: OpenCard,
    status: ContentRecord['status'],
    regionId = this.world.regionOf(player.id)?.def.id ?? this.world.home.def.id,
    placements?: { x: number; y: number }[],
    cell?: { x: number; y: number },
  ): ContentRecord {
    const record: ContentRecord = {
      id: `w${this.now().toString(36)}${randomBytes(2).toString('hex')}`,
      wisher: { id: player.id, name: player.name },
      regionId,
      at: this.now(),
      tier: open.card.tier,
      title: open.card.title,
      summary: open.card.summary,
      status,
      favor: status === 'granted' ? open.card.cost : 0,
      ...(open.definition ? { definition: open.definition } : {}),
      ...(placements ? { placements } : {}),
      ...(cell ? { cell } : {}),
      conversation: open.conversation,
      ...(open.shaped ? { shaped: open.shaped } : {}),
      usd: open.usd,
    };
    this.store.addContent(record);
    if (status !== 'granted') this.broadcast(record);
    this.onCardUsed?.(player.id, open.card.id);
    return record;
  }

  // --- A player's look ------------------------------------------------------------

  /** The player's look wish, while it stands. */
  lookOf(playerId: string): ContentRecord | undefined {
    // A look changed in the Workshop replaces the older one; rolling it back brings the older one back.
    return [...this.store.content].reverse().find((c) => c.definition?.kind === 'player' && c.wisher.id === playerId && c.status === 'granted');
  }

  /**
   * A new player describes how they look: their first wish, free, granted at
   * once and painted like any wished thing. A Steward can roll it back, and
   * then the player may describe themself again. Throws a WishError.
   */
  grantLook(player: { id: string; name: string }, words: string): ContentRecord {
    if (this.lookOf(player.id)) throw new WishError('Your look is already chosen. Changing it later will be a wish of its own.');
    const definition = lookFromWords(player.name, words);
    const record: ContentRecord = {
      id: `w${this.now().toString(36)}${randomBytes(2).toString('hex')}`,
      wisher: { id: player.id, name: player.name },
      regionId: this.world.home.def.id,
      at: this.now(),
      tier: 'minor',
      title: `${player.name}'s look`,
      summary: definition.description,
      status: 'granted',
      favor: 0,
      definition,
      conversation: [{ role: 'user', content: words }],
      usd: 0,
    };
    this.store.addContent(record);
    this.broadcast(record);
    this.paint(record);
    return record;
  }

  /**
   * Sets a creature's whole loot from God's View. It is kept as a content
   * entry like a wish, made by `by`, so it is saved, reaches every region
   * server and can be rolled back. Throws a WishError.
   */
  setLoot(by: { id: string; name: string }, raw: unknown): ContentRecord {
    const definition = validateLoot(raw, true);
    const record: ContentRecord = {
      id: `w${this.now().toString(36)}${randomBytes(2).toString('hex')}`,
      wisher: { id: by.id, name: by.name },
      regionId: this.world.home.def.id,
      at: this.now(),
      tier: 'minor',
      title: definition.name,
      summary: definition.description,
      status: 'granted',
      favor: 0,
      definition,
      godsView: true,
      conversation: [],
      usd: 0,
    };
    this.store.addContent(record);
    this.apply(record);
    this.broadcast(record);
    return record;
  }

  // --- Undo, review, art -------------------------------------------------------

  /** Undoes a granted wish everywhere (God's View, content log). */
  rollback(id: string): ContentRecord | undefined {
    const record = this.store.contentById(id);
    // A code change is undone by reverting its pull request, not from here.
    if (!record || record.status !== 'granted' || record.build) return undefined;
    this.store.updateContent(id, { status: 'rolled-back' });
    this.unapply(record);
    this.rules.stop(id);
    if (record.definition?.kind === 'region') this.world.removeRegion(id);
    this.world.unplace(id);
    for (const region of this.world.regions.values()) {
      for (const playerId of region.playerIds()) {
        const c = region.character(playerId);
        if (c && (c.inventory.some((s) => !ITEMS[s.item]) || Object.values(c.equipment).some((i) => i && !ITEMS[i]) || c.abilities.includes(id))) {
          void region.change(playerId, { op: 'forget' });
        }
      }
    }
    this.broadcast(record);
    return record;
  }

  /**
   * A Steward or the Owner decided a major or engine wish. Approving a Major
   * wish with a drafted rule that passed its test run puts the rule into the
   * world at once; other approved wishes wait for people to build them.
   */
  async review(id: string, approve: boolean): Promise<{ record: ContentRecord } | { error: string; message: string }> {
    const record = this.store.contentById(id);
    // A build that failed can still be given up on.
    const failedBuild = record?.status === 'approved' && record.build?.state === 'failed' && !approve;
    if (!record || (record.status !== 'pending' && !failedBuild)) return { error: 'not_pending', message: 'This wish is not waiting for review.' };
    if (approve && record.definition?.kind === 'rule') {
      if (this.drafting.has(id)) return { error: 'drafting', message: 'The God is still drafting this rule.' };
      if (!record.test?.passed) return { error: 'untested', message: 'This rule has not passed its test run. Ask the God to revise it, or reject it.' };
      return this.grantRule(record);
    }
    this.store.updateContent(id, { status: approve ? 'approved' : 'rejected' });
    this.broadcast(record);
    this.world.sendTo(record.wisher.id, {
      t: 'god',
      say: approve
        ? record.tier === 'engine'
          ? `Your wish "${record.title}" was approved. It will be built into the game, and you will hear when it is live.`
          : `Your wish "${record.title}" was approved. It will be built for the world.`
        : `Your wish "${record.title}" was not approved this time.`,
    });
    return { record };
  }

  /**
   * One step of a wish too big for one code change, recorded as its own
   * Engine wish for the Owner to approve.
   */
  addStep(from: ContentRecord, title: string, summary: string): ContentRecord {
    const record: ContentRecord = {
      id: `w${this.now().toString(36)}${randomBytes(2).toString('hex')}`,
      wisher: from.wisher,
      regionId: from.regionId,
      at: this.now(),
      tier: 'engine',
      title: title.slice(0, 80),
      summary,
      status: 'pending',
      favor: 0,
      conversation: from.conversation,
      usd: 0,
    };
    this.store.addContent(record);
    this.broadcast(record);
    return record;
  }

  private async grantRule(record: ContentRecord): Promise<{ record: ContentRecord } | { error: string; message: string }> {
    const def = record.definition;
    if (def?.kind !== 'rule') return { error: 'not_rule', message: 'This wish has no rule.' };
    const summary = record.summary;
    // The Chronicle shows what was made, not the words of the wish.
    this.store.updateContent(record.id, { status: 'granted', summary: def.description || summary, rule: { paused: false } });
    this.apply(record);
    try {
      await this.rules.start(record);
    } catch (err) {
      this.store.updateContent(record.id, { status: 'pending', summary, test: { ...record.test!, passed: false, errors: [(err as Error).message] } });
      this.unapply(record);
      this.changed(record.id);
      return { error: 'load_failed', message: `The rule did not load: ${(err as Error).message}` };
    }
    this.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${record.wisher.name}'s wish: ${def.name}. ${def.howTo}`, at: this.now() });
    this.world.sendTo(record.wisher.id, { t: 'god', say: `Your wish "${record.title}" is now part of the world. ${def.howTo}` });
    this.rules.greet(record.id);
    this.paint(record);
    return { record };
  }

  /**
   * Asks the God's compiler to draft a scripted rule for a Major wish, runs
   * it through the automated test, and tries once more with the problems if
   * the test fails. A Steward's note asks for a revision.
   */
  draft(id: string, note?: string): Promise<ContentRecord | undefined> {
    const record = this.store.contentById(id);
    if (!record || record.status !== 'pending' || record.tier !== 'major' || this.drafting.has(id)) return Promise.resolve(undefined);
    this.drafting.add(id);
    const job = this.runDraft(record, note?.trim().slice(0, 500) || undefined).finally(() => {
      this.drafting.delete(id);
      this.drafts.delete(job);
    });
    this.drafts.add(job);
    return job;
  }

  private async runDraft(record: ContentRecord, note: string | undefined): Promise<ContentRecord | undefined> {
    const id = record.id;
    this.store.updateContent(id, { draft: { state: 'drafting', at: this.now(), ...(note ? { note } : {}) } });
    this.changed(id);
    let previous = record.definition?.kind === 'rule' ? record.definition : undefined;
    let problems = record.test && !record.test.passed ? [...record.test.errors, ...record.test.summary] : undefined;
    let usd = 0;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await compileRule(
          this.ai.compilerModels(),
          { title: record.title, summary: record.summary, conversation: record.conversation, ...(record.shaped?.brief ? { brief: record.shaped.brief } : {}), ...(note || previous ? { revise: { note: note ?? '', previous, problems } } : {}) },
          (r, model) => {
            usd += r.usd;
            this.budget.spend('chat', model, r.usd, record.wisher.id);
          },
        );
        if (!result.ok) {
          this.store.updateContent(id, {
            usd: record.usd + usd,
            draft: { state: result.impossible ? 'impossible' : 'failed', at: this.now(), message: result.reason, ...(result.model ? { model: `${result.model.provider}/${result.model.model}` } : {}), ...(note ? { note } : {}) },
          });
          this.notifyStewards(`The God could not draft a rule for "${record.title}": ${result.reason}`);
          this.tellWisher(record, `The God could not finish your wish "${record.title}" yet. The Stewards will decide what happens next.`);
          this.changed(id);
          return this.store.contentById(id);
        }
        const test = await testRule(id, result.definition, this.now());
        // Only the latest draft counts; a review may have happened meanwhile.
        if (this.store.contentById(id)?.status !== 'pending') return undefined;
        this.store.updateContent(id, {
          definition: result.definition,
          test,
          usd: record.usd + usd,
          draft: { state: 'ready', at: this.now(), model: `${result.model.provider}/${result.model.model}`, ...(note ? { note } : {}) },
        });
        if (test.passed) break;
        previous = result.definition;
        problems = [...test.errors, ...test.summary];
        note = note ?? 'The automated test run did not pass; fix the problems.';
      }
      const done = this.store.contentById(id)!;
      this.changed(id);
      if (!done.test?.passed) this.tellWisher(done, `The God's first try at your wish "${record.title}" did not pass its test run. The Stewards can ask for another.`);
      this.notifyStewards(done.test?.passed
        ? `A scripted rule waits for your review: "${record.title}". Open God's View.`
        : `The God's rule for "${record.title}" did not pass its test run. Open God's View to revise or reject it.`);
      return done;
    } catch (err) {
      console.error(`Drafting ${id} failed:`, err);
      this.store.updateContent(id, { draft: { state: 'failed', at: this.now(), message: (err as Error).message } });
      this.changed(id);
      return this.store.contentById(id);
    }
  }

  /** A line for every Steward and the Owner who is online. */
  notifyStewards(text: string): void {
    for (const account of this.store.accounts) {
      if (account.role !== 'player' && this.world.has(account.id)) this.world.sendTo(account.id, { t: 'notice', text: `✦ ${text}` });
    }
  }

  // --- Stewards, named by the Owner through the God ------------------------------

  private appointCard(playerId: string, appoint: { name: string; role: 'steward' | 'player' }, conversation: ChatTurn[]): { card?: WishCard; note?: string } {
    const asker = this.store.accountById(playerId);
    if (asker?.role !== 'owner') return { note: 'Only the Owner of this world may name its Stewards. Ask them, and they will ask me.' };
    const target = this.store.accountByName(appoint.name);
    if (!target) return { note: `I know no one called ${appoint.name}. Invite them first, and ask again once they have arrived.` };
    if (target.role === 'owner') return { note: 'You are the Owner already; no title I give could be higher.' };
    if (target.role === appoint.role) {
      return { note: appoint.role === 'steward' ? `${target.name} is a Steward already.` : `${target.name} is not a Steward.` };
    }
    for (const [cardId, open] of this.cards) if (open.playerId === playerId) this.cards.delete(cardId);
    const steward = appoint.role === 'steward';
    const card: WishCard = {
      id: randomBytes(6).toString('hex'),
      tier: 'minor',
      title: steward ? `Make ${target.name} a Steward` : `${target.name} steps down as Steward`,
      summary: steward
        ? `${target.name} will review large wishes, roll back creations, read reports and keep the peace.`
        : `${target.name} goes back to being a player.`,
      cost: 0,
      where: 'Across the whole world',
      instant: true,
    };
    this.cards.set(card.id, { card, playerId, appoint: { id: target.id, name: target.name, role: appoint.role }, conversation: [...conversation], usd: 0 });
    return { card };
  }

  private appoint(owner: PlayerInfo, appoint: { id: string; name: string; role: Role }): void {
    if (this.store.accountById(owner.id)?.role !== 'owner') return;
    this.store.setRole(appoint.id, appoint.role);
    const steward = appoint.role === 'steward';
    this.world.sendTo(appoint.id, {
      t: 'god',
      say: steward ? 'You are named a Steward of this world. Keep it kind.' : 'You are no longer a Steward. Thank you for your care.',
    });
    if (steward) this.world.broadcast({ t: 'system', text: `✦ The God named ${appoint.name} a Steward of the world.`, at: this.now() });
    this.say(owner.id, steward ? `It is done. ${appoint.name} is a Steward now.` : `It is done. ${appoint.name} rests from their duties.`);
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
        if (updated) this.broadcast(updated);
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
    if (updated) this.broadcast(updated);
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
      if (updated) this.broadcast(updated);
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
        if (updated) this.broadcast(updated);
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
    if (!pass) this.notifyStewards(`The style check was not happy with the picture of ${picture.def.name} after ${tries} tries: ${kept.why}. It is shown for now; the Art tab in God's View can paint it again.`);
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
  private track(work: Promise<void>): Promise<void> {
    const job = work.catch((err) => console.error('Painting failed:', (err as Error).message)).finally(() => this.painting.delete(job));
    this.painting.add(job);
    return job;
  }

  /** A line for the God about where the world can grow from here. */
  private edgeLine(playerId: string): string {
    const open = this.world.openEdge(playerId);
    if (!open) return "Every edge of this region meets another land; a new region can only be wished at the world's edge.";
    return `This region is at the world's edge: a new region wished here would lie beyond its ${open.side} edge.`;
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
      if (record.status === 'granted' && record.definition) this.paint(record);
    }
  }

  // --- Plumbing --------------------------------------------------------------

  /** Makes a wish's things exist here and on every region server, before anything is placed. */
  private apply(record: ContentRecord): void {
    applyContent(record);
    this.world.contentChanged([publicEntry(record)]);
  }

  private unapply(record: ContentRecord): void {
    removeContent(record);
    this.world.contentChanged([publicEntry(record)]);
  }

  private place(record: ContentEntry): void {
    const def = record.definition;
    if (def?.kind === 'region') {
      const land = regionFromWish(record);
      if (land && !this.world.addRegion(land)) console.error(`Region ${record.id} could not be placed: its square is taken.`);
      return;
    }
    if (!def || !record.placements) return;
    if (def.kind === 'creature') this.world.placeCreatures(record.regionId, record.id, record.placements);
    if (def.kind === 'npc') {
      const at = record.placements[0]!;
      this.world.placeNpc(record.regionId, { id: record.id, name: def.name, asset: wishArtKey(record.id), x: at.x, y: at.y });
    }
  }

  /** Tells every client a wish's progress changed (drafting, a test run, a pause). */
  changed(id: string): void {
    const record = this.store.contentById(id);
    if (record) this.broadcast(record);
  }

  /** A line to the wisher, if they are online. */
  tellWisher(record: ContentRecord, text: string): void {
    if (this.world.has(record.wisher.id)) this.world.sendTo(record.wisher.id, { t: 'notice', text: `✦ ${text}` });
  }

  private broadcast(record: ContentRecord): void {
    this.world.broadcast({ t: 'content', entries: [publicEntry(record)], replace: false });
  }

  private say(playerId: string, say: string): void {
    this.world.sendTo(playerId, { t: 'god', say });
  }
}

/** A content record without what only God's View sees (the conversation, cost, image prompts, and a rule's script). */
export function publicEntry(record: ContentRecord): ContentEntry {
  const { conversation: _c, usd: _u, draft: _d, test: _t, rule: _r, build: _b, artPrompts: _p, shaped: _s, ...rest } = record;
  const entry: ContentEntry = { ...rest, progress: wishProgress(record) };
  if (entry.definition?.kind === 'rule') {
    const { script: _s, ...definition } = entry.definition;
    return { ...entry, definition };
  }
  return entry;
}

/** True when a wish's picture was painted already. */
function hasArt(record: ContentRecord, pictureId: string): boolean {
  return pictureId === record.id ? Boolean(record.art) : Boolean(record.itemArt?.[pictureId]);
}

/** A dry run stops at the request; anything else is a real failure. */
function onlyPreviewed(err: unknown): void {
  if (!(err instanceof Previewed)) throw err;
}
