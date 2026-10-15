import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BIOMES,
  ITEMS,
  WISH_COSTS,
  WishError,
  addItem,
  applyContent,
  contentTier,
  forgetVanished,
  regionFromWish,
  regionPictures,
  wishCost,
  lookFromWords,
  regionDef,
  removeContent,
  ruleItemId,
  validateDefinition,
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
import { createChatModel, type ChatModel, type ChatTurn } from './ai/chat.ts';
import { GeminiImageProvider, REFERENCE_NOTE } from './assets/gemini.ts';
import type { ImageProvider } from './assets/provider.ts';
import { imageUsd, paintWish } from './assets/wish-art.ts';
import { KIT_ART_PATH, paintKitAsset, readKitManifest, wildKit } from './assets/wild-kit.ts';
import { OfflineCompiler, compileRule } from './compiler.ts';
import { OfflineGod, askGod, type GodReply } from './god.ts';
import type { LiveRules } from './live-rules.ts';
import { testRule } from './rule-test.ts';
import type { ArtPromptRecord, ContentRecord, Settings, Store } from './store.ts';
import type { World } from './world.ts';

/** Turns of conversation the God remembers per player. */
const MEMORY_TURNS = 12;
/** Prayers a player may send per minute. */
const PRAYERS_PER_MINUTE = 6;
const MAX_PRAYER_LENGTH = 400;

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
}

export interface WishOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Where approved anchors live (style references for wished art). */
  anchorDir: string;
  /** Where painted wish art is written; served at /wished-art/. */
  artDir: string;
  /** Overrides model creation (tests). */
  chatModel?: (settings: Settings) => ChatModel[];
  /** Overrides the rule compiler's models (tests); the offline compiler is always last. */
  compilerModel?: (settings: Settings) => ChatModel[];
  /** Overrides image provider creation (tests). */
  imageProvider?: (settings: Settings) => ImageProvider | undefined;
}

/**
 * The God's side of the game: prayers, wish cards, granting and undoing
 * wishes, and the money they cost (design doc, The God; How wishes become
 * mechanics).
 */
export class Wishes {
  private readonly conversations = new Map<string, ChatTurn[]>();
  private readonly cards = new Map<string, OpenCard>();
  private readonly busy = new Set<string>();
  private readonly prayerTimes = new Map<string, number[]>();
  private readonly offline = new OfflineGod();
  private readonly offlineCompiler = new OfflineCompiler();
  /** Major wishes whose rule is being drafted. */
  private readonly drafting = new Set<string>();
  /** Drafts in flight, so tests and shutdown can wait for them. */
  readonly drafts = new Set<Promise<unknown>>();
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  /** Art being painted, so tests and shutdown can wait for it. */
  readonly painting = new Set<Promise<void>>();
  /** Told when a confirmed card became a wish (granted or sent for review), so its Workshop draft can go. */
  onCardUsed?: (playerId: string, cardId: string) => void;

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly rules: LiveRules,
    private readonly options: WishOptions,
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
  }

  /** Puts every granted wish back into the world (at start-up). */
  restore(): void {
    for (const record of this.store.content) {
      applyContent(record);
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
    const character = region?.character(id);
    if (!region || !character) return;
    if (this.busy.has(id)) return this.say(id, 'Patience. I am still listening to your last prayer.');
    const now = this.now();
    const times = (this.prayerTimes.get(id) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= PRAYERS_PER_MINUTE) return this.say(id, 'Breathe, child. Speak again in a moment.');
    times.push(now);
    this.prayerTimes.set(id, times);

    const history = [...(this.conversations.get(id) ?? []), { role: 'user' as const, content: text }].slice(-MEMORY_TURNS);
    this.busy.add(id);
    let usd = 0;
    try {
      const { reply } = await askGod(
        this.models(),
        {
          playerName: player.name,
          role: player.role,
          favor: character.favor,
          regionName: region.def.name,
          biome: BIOMES[region.def.biome as BiomeId]?.name ?? region.def.biome,
          nearby: region.nearby(id),
          edge: this.edgeLine(id),
          recentWishes: this.store.content
            .filter((c) => c.status === 'granted')
            .slice(-8)
            .reverse()
            .map((c) => `${c.title} (wished by ${c.wisher.name})`),
        },
        history,
        (result, model) => {
          usd += result.usd;
          this.store.recordSpend({ at: this.now(), usd: result.usd, kind: 'chat', provider: model.provider, model: model.model, playerId: id });
        },
      );
      history.push({ role: 'assistant', content: reply.say });
      this.conversations.set(id, history.slice(-MEMORY_TURNS));
      const card = reply.wish && this.makeCard(id, reply.wish, region.def.name, history, usd);
      if (card?.note) {
        history.push({ role: 'assistant', content: card.note });
        this.conversations.set(id, history.slice(-MEMORY_TURNS));
      }
      this.world.sendTo(id, { t: 'god', say: card?.note ?? reply.say, ...(card?.card ? { card: card.card } : {}) });
    } catch (err) {
      console.error('Prayer failed:', err);
      this.say(id, 'The heavens are clouded; I cannot hear you clearly. Try again soon.');
    } finally {
      this.busy.delete(id);
    }
  }

  private makeCard(
    playerId: string,
    wish: NonNullable<GodReply['wish']>,
    regionName: string,
    conversation: ChatTurn[],
    usd: number,
  ): { card?: WishCard; note?: string } | undefined {
    if (wish.tier === 'refused') return undefined;
    if (wish.appoint) return this.appointCard(playerId, wish.appoint, conversation);
    const made = this.cardFor(playerId, wish, regionName);
    if (!made || 'note' in made) return made;
    for (const [cardId, open] of this.cards) if (open.playerId === playerId) this.cards.delete(cardId);
    const card: WishCard = { id: randomBytes(6).toString('hex'), ...made.card };
    this.cards.set(card.id, { card, playerId, definition: made.definition, conversation: [...conversation], usd, ...(made.edge ? { edge: made.edge } : {}) });
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
  ): { card: Omit<WishCard, 'id'>; definition?: WishDefinition; edge?: OpenCard['edge'] } | { note: string } | undefined {
    if (wish.tier === 'refused') return undefined;
    let definition: WishDefinition | undefined;
    let tier = wish.tier;
    if (tier === 'minor' || tier === 'moderate') {
      try {
        definition = validateDefinition(wish.definition);
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
        : definition?.kind === 'item' ? 'In your bag'
          : definition?.kind === 'ability' ? 'A scroll in your bag'
            : definition?.kind === 'recipe' ? 'Known to everyone, in the crafting book (C)'
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
  ): string | undefined {
    const region = this.world.regionOf(player.id);
    if (!region) return undefined;
    const made = this.makeCard(player.id, wish, region.def.name, conversation, 0);
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
    if (def.kind === 'region' && (!open.edge || !this.world.cellFree(open.edge.cell))) {
      return this.say(player.id, 'Another land has grown there since you asked. Find an open edge of the world and wish again.');
    }

    const record = this.record(player, open, 'granted', region.def.id, placements, open.edge?.cell);
    applyContent(record);
    this.place(record);
    region.updateCharacter(player.id, (c) => {
      c.favor -= open.card.cost;
      if (def.kind === 'item' || def.kind === 'ability') addItem(c, record.id);
    });
    this.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${player.name}'s wish: ${record.title}.`, at: this.now() });
    this.say(player.id, def.kind === 'item' || def.kind === 'ability' ? 'It is done. Look in your bag.'
      : def.kind === 'recipe' ? 'It is done. Anyone can make it now: press C to open the crafting book.'
        : def.kind === 'region' ? `It is done. A road now leads ${open.edge!.side} to ${def.name}.`
          : 'It is done. Look around you.');
    this.paint(record);
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
    return this.store.content.find((c) => c.definition?.kind === 'player' && c.wisher.id === playerId && c.status === 'granted');
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

  // --- Undo, review, art -------------------------------------------------------

  /** Undoes a granted wish everywhere (God's View, content log). */
  rollback(id: string): ContentRecord | undefined {
    const record = this.store.contentById(id);
    // A code change is undone by reverting its pull request, not from here.
    if (!record || record.status !== 'granted' || record.build) return undefined;
    this.store.updateContent(id, { status: 'rolled-back' });
    removeContent(record);
    this.rules.stop(id);
    if (record.definition?.kind === 'region') this.world.removeRegion(id);
    for (const region of this.world.regions.values()) {
      region.removeWish(id);
      for (const playerId of region.playerIds()) {
        const c = region.character(playerId);
        if (c && (c.inventory.some((s) => !ITEMS[s.item]) || Object.values(c.equipment).some((i) => i && !ITEMS[i]) || c.abilities.includes(id))) {
          region.updateCharacter(playerId, forgetVanished);
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
    applyContent(record);
    try {
      await this.rules.start(record);
    } catch (err) {
      this.store.updateContent(record.id, { status: 'pending', summary, test: { ...record.test!, passed: false, errors: [(err as Error).message] } });
      removeContent(record);
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
          this.compilerModels(),
          { title: record.title, summary: record.summary, conversation: record.conversation, ...(note || previous ? { revise: { note: note ?? '', previous, problems } } : {}) },
          (r, model) => {
            usd += r.usd;
            this.store.recordSpend({ at: this.now(), usd: r.usd, kind: 'chat', provider: model.provider, model: model.model, playerId: record.wisher.id });
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
  paint(record: ContentRecord, force = false): Promise<void> | undefined {
    if (!record.definition || record.status !== 'granted' || record.definition.kind === 'recipe') return undefined;
    const provider = this.imageProvider();
    if (!provider) return undefined;
    if (!force && this.budget().over) return undefined;
    const def = record.definition;
    if (def.kind === 'region') return this.track(this.paintRegion(record, def, provider, force));
    const biome = (regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    const pictures: { id: string; def: PicturedWish }[] = def.kind === 'rule'
      ? Object.entries(def.items).map(([key, item]) => ({ id: ruleItemId(record.id, key), def: { kind: 'item', ...item } as ItemWish }))
      : [{ id: record.id, def }];
    const job = (async () => {
      for (const picture of pictures) {
        if (!force && this.budget().over) break;
        let painted;
        try {
          painted = await paintWish(picture.id, picture.def, biome, provider, this.options.anchorDir, this.options.artDir);
        } catch (err) {
          console.error(`Painting ${picture.id} failed:`, (err as Error).message);
          continue;
        }
        const usd = imageUsd(provider.model, painted.image);
        this.store.recordSpend({ at: this.now(), usd, kind: 'image', provider: provider.id, model: provider.model, playerId: record.wisher.id });
        const current = this.store.contentById(record.id);
        if (!current) return;
        const url = `/wished-art/${picture.id}.png?v=${this.now().toString(36)}`;
        const artPrompts = { ...current.artPrompts, [picture.id]: this.promptRecord(provider, painted.request.prompt, painted.request.references, usd) };
        const updated = this.store.updateContent(record.id, def.kind === 'rule'
          ? { itemArt: { ...current.itemArt, [picture.id]: url }, usd: current.usd + usd, artPrompts }
          : { art: url, usd: current.usd + usd, artPrompts });
        if (updated) this.broadcast(updated);
      }
    })().finally(() => this.painting.delete(job));
    this.painting.add(job);
    return job;
  }

  /**
   * Paints a wished region: its biome's kit the first time that biome is
   * wished (ground, water, two trees and a rock, about five pictures, kept
   * for every later region of the biome), then its new creatures and person.
   */
  private async paintRegion(record: ContentRecord, def: RegionWish, provider: ImageProvider, force: boolean): Promise<void> {
    const dir = resolve(this.options.artDir, 'biomes');
    const kit = await readKitManifest(dir);
    const kitUrl = (id: string) => kit[id] && `/${KIT_ART_PATH}/${kit[id]!.file}`;
    const update = (patch: Partial<ContentRecord>) => {
      const updated = this.store.updateContent(record.id, patch);
      if (updated) this.broadcast(updated);
      return updated;
    };
    // The Owner's Repaint paints the biome's kit again too.
    for (const asset of wildKit(def.biome)) {
      if (kit[asset.id] && !force) continue;
      if (!force && this.budget().over) return;
      try {
        const { image, entry, prompt, references } = await paintKitAsset(asset, provider, this.options.anchorDir, dir);
        const usd = imageUsd(provider.model, image);
        this.store.recordSpend({ at: this.now(), usd, kind: 'image', provider: provider.id, model: provider.model, playerId: record.wisher.id });
        kit[asset.id] = { ...entry, file: `${entry.file}?v=${this.now().toString(36)}` };
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, 'manifest.json'), JSON.stringify(kit, null, 2));
        const current = this.store.contentById(record.id);
        if (current) update({ usd: current.usd + usd, artPrompts: { ...current.artPrompts, [asset.id]: this.promptRecord(provider, prompt, references, usd) } });
      } catch (err) {
        console.error(`Painting ${asset.id} failed:`, (err as Error).message);
      }
    }
    // Every region of this biome shows the kit, including ones wished before it was painted.
    const kitArt = Object.fromEntries(wildKit(def.biome).flatMap((a) => (kitUrl(a.id) ? [[a.id, kitUrl(a.id)!]] : [])));
    if (Object.keys(kitArt).length) {
      for (const other of this.store.content) {
        if (other.status === 'granted' && other.definition?.kind === 'region' && other.definition.biome === def.biome) {
          const updated = this.store.updateContent(other.id, { kitArt });
          if (updated) this.broadcast(updated);
        }
      }
    }
    for (const picture of regionPictures(record.id, def)) {
      if (!force && this.budget().over) return;
      let painted;
      try {
        painted = await paintWish(picture.id, picture.def, def.biome, provider, this.options.anchorDir, this.options.artDir);
      } catch (err) {
        console.error(`Painting ${picture.id} failed:`, (err as Error).message);
        continue;
      }
      const usd = imageUsd(provider.model, painted.image);
      this.store.recordSpend({ at: this.now(), usd, kind: 'image', provider: provider.id, model: provider.model, playerId: record.wisher.id });
      const current = this.store.contentById(record.id);
      if (!current) return;
      update({
        itemArt: { ...current.itemArt, [picture.id]: `/wished-art/${picture.id}.png?v=${this.now().toString(36)}` },
        usd: current.usd + usd,
        artPrompts: { ...current.artPrompts, [picture.id]: this.promptRecord(provider, painted.request.prompt, painted.request.references, usd) },
      });
    }
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

  budget(): { spentUsd: number; monthlyUsd: number; warnUsd: number; over: boolean; warn: boolean } {
    const spentUsd = this.store.spendThisMonth(this.now()).reduce((sum, s) => sum + s.usd, 0);
    const { monthlyUsd, warnUsd } = this.store.settings.budget;
    return { spentUsd, monthlyUsd, warnUsd, over: spentUsd >= monthlyUsd, warn: spentUsd >= warnUsd };
  }

  // --- Plumbing --------------------------------------------------------------

  /** The God model, its fallback, and the offline God last; offline only once over budget. */
  models(settings = this.store.settings): ChatModel[] {
    if (this.budget().over) return [this.offline];
    if (this.options.chatModel) return [...this.options.chatModel(settings), this.offline];
    const models: ChatModel[] = [];
    for (const choice of [settings.ai.god, settings.ai.fallback]) {
      if (!choice) continue;
      const model = createChatModel(choice.provider, choice.model, this.env, () => this.offline);
      if (model && !models.includes(model)) models.push(model);
    }
    if (!models.includes(this.offline)) models.push(this.offline);
    return models;
  }

  /** The rule compiler's model, the fallback, and the offline compiler last. */
  compilerModels(settings = this.store.settings): ChatModel[] {
    if (this.budget().over) return [this.offlineCompiler];
    if (this.options.compilerModel) return [...this.options.compilerModel(settings), this.offlineCompiler];
    if (this.options.chatModel) return [this.offlineCompiler];
    const models: ChatModel[] = [];
    for (const choice of [settings.ai.compiler ?? settings.ai.god, settings.ai.fallback]) {
      if (!choice || choice.provider === 'offline') continue;
      const model = createChatModel(choice.provider, choice.model, this.env, () => this.offlineCompiler);
      if (model) models.push(model);
    }
    models.push(this.offlineCompiler);
    return models;
  }

  /** The image model chosen in God's View, when it has a key. */
  imageProvider(): ImageProvider | undefined {
    const settings = this.store.settings;
    if (this.options.imageProvider) return this.options.imageProvider(settings);
    if (settings.ai.image.provider !== 'gemini' || !this.env.GEMINI_API_KEY) return undefined;
    return new GeminiImageProvider(this.env.GEMINI_API_KEY, settings.ai.image.model || undefined);
  }

  private place(record: ContentEntry): void {
    const def = record.definition;
    if (def?.kind === 'region') {
      const land = regionFromWish(record);
      if (land && !this.world.addRegion(land)) console.error(`Region ${record.id} could not be placed: its square is taken.`);
      return;
    }
    const region = this.world.region(record.regionId);
    if (!def || !region || !record.placements) return;
    if (def.kind === 'creature') region.addCreatures(record.id, record.placements);
    if (def.kind === 'npc') {
      const at = record.placements[0]!;
      region.addNpc({ id: record.id, name: def.name, asset: wishArtKey(record.id), x: at.x, y: at.y });
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
  const { conversation: _c, usd: _u, draft: _d, test: _t, rule: _r, build: _b, artPrompts: _p, ...rest } = record;
  const entry: ContentEntry = { ...rest, progress: wishProgress(record) };
  if (entry.definition?.kind === 'rule') {
    const { script: _s, ...definition } = entry.definition;
    return { ...entry, definition };
  }
  return entry;
}
