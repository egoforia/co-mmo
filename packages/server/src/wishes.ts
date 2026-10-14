import { randomBytes } from 'node:crypto';
import {
  BIOMES,
  ITEMS,
  WISH_COSTS,
  WishError,
  addItem,
  applyContent,
  regionDef,
  removeContent,
  ruleItemId,
  validateDefinition,
  wishArtKey,
  type BiomeId,
  type ContentEntry,
  type ItemWish,
  type PlayerInfo,
  type Role,
  type WishCard,
  type WishDefinition,
  type WishTier,
} from '@co-mmo/shared';
import { createChatModel, type ChatModel, type ChatTurn } from './ai/chat.ts';
import { GeminiImageProvider } from './assets/gemini.ts';
import type { ImageProvider } from './assets/provider.ts';
import { IMAGE_USD, paintWish } from './assets/wish-art.ts';
import { OfflineCompiler, compileRule } from './compiler.ts';
import { OfflineGod, askGod, type GodReply } from './god.ts';
import type { LiveRules } from './live-rules.ts';
import { testRule } from './rule-test.ts';
import type { ContentRecord, Settings, Store } from './store.ts';
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
      // Items are minor, creatures and people moderate, whatever the model said.
      if (definition) tier = definition.kind === 'item' ? 'minor' : 'moderate';
    }
    for (const [cardId, open] of this.cards) if (open.playerId === playerId) this.cards.delete(cardId);
    const instant = tier === 'minor' || tier === 'moderate';
    const card: WishCard = {
      id: randomBytes(6).toString('hex'),
      tier,
      title: wish.title,
      summary: wish.summary || definition?.description || wish.title,
      cost: WISH_COSTS[tier],
      where: !instant
        ? tier === 'engine' ? 'Set before the Owner for the next game update' : 'Set before the Stewards for review'
        : definition?.kind === 'item' ? 'In your bag' : `Beside you, in ${regionName}`,
      instant,
    };
    this.cards.set(card.id, { card, playerId, definition, conversation: [...conversation], usd });
    return { card };
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

    const record = this.record(player, open, 'granted', region.def.id, placements);
    applyContent(record);
    this.place(record);
    region.updateCharacter(player.id, (c) => {
      c.favor -= open.card.cost;
      if (def.kind === 'item') addItem(c, record.id);
    });
    this.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${player.name}'s wish: ${record.title}.`, at: this.now() });
    this.say(player.id, def.kind === 'item' ? 'It is done. Look in your bag.' : 'It is done. Look around you.');
    this.paint(record);
  }

  private record(
    player: PlayerInfo,
    open: OpenCard,
    status: ContentRecord['status'],
    regionId = this.world.regionOf(player.id)?.def.id ?? this.world.home.def.id,
    placements?: { x: number; y: number }[],
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
      conversation: open.conversation,
      usd: open.usd,
    };
    this.store.addContent(record);
    if (status !== 'granted') this.broadcast(record);
    return record;
  }

  // --- Undo, review, art -------------------------------------------------------

  /** Undoes a granted wish everywhere (God's View, content log). */
  rollback(id: string): ContentRecord | undefined {
    const record = this.store.contentById(id);
    if (!record || record.status !== 'granted') return undefined;
    this.store.updateContent(id, { status: 'rolled-back' });
    removeContent(record);
    this.rules.stop(id);
    for (const region of this.world.regions.values()) {
      region.removeWish(id);
      for (const playerId of region.playerIds()) {
        if (region.character(playerId)?.inventory.some((s) => !ITEMS[s.item])) {
          region.updateCharacter(playerId, (c) => {
            c.inventory = c.inventory.filter((s) => ITEMS[s.item]);
          });
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
    if (!record || record.status !== 'pending') return { error: 'not_pending', message: 'This wish is not waiting for review.' };
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
        ? `Your wish "${record.title}" was approved. It will be built for the world.`
        : `Your wish "${record.title}" was not approved this time.`,
    });
    return { record };
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
      this.notifyStewards(done.test?.passed
        ? `A scripted rule waits for your review: "${record.title}". Open God's View.`
        : `The God's rule for "${record.title}" did not pass its test run. Open God's View to revise or reject it.`);
      return done;
    } catch (err) {
      console.error(`Drafting ${id} failed:`, err);
      this.store.updateContent(id, { draft: { state: 'failed', at: this.now(), message: (err as Error).message } });
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
    if (!record.definition || record.status !== 'granted') return undefined;
    const provider = this.imageProvider();
    if (!provider) return undefined;
    if (!force && this.budget().over) return undefined;
    const def = record.definition;
    const biome = (regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    const pictures: { id: string; def: WishDefinition }[] = def.kind === 'rule'
      ? Object.entries(def.items).map(([key, item]) => ({ id: ruleItemId(record.id, key), def: { kind: 'item', ...item } as ItemWish }))
      : [{ id: record.id, def }];
    const job = (async () => {
      for (const picture of pictures) {
        if (!force && this.budget().over) break;
        try {
          await paintWish(picture.id, picture.def, biome, provider, this.options.anchorDir, this.options.artDir);
        } catch (err) {
          console.error(`Painting ${picture.id} failed:`, (err as Error).message);
          continue;
        }
        this.store.recordSpend({ at: this.now(), usd: IMAGE_USD, kind: 'image', provider: provider.id, model: provider.model, playerId: record.wisher.id });
        const current = this.store.contentById(record.id);
        if (!current) return;
        const url = `/wished-art/${picture.id}.png?v=${this.now().toString(36)}`;
        const updated = this.store.updateContent(record.id, def.kind === 'rule'
          ? { itemArt: { ...current.itemArt, [picture.id]: url }, usd: current.usd + IMAGE_USD }
          : { art: url, usd: current.usd + IMAGE_USD });
        if (updated) this.broadcast(updated);
      }
    })().finally(() => this.painting.delete(job));
    this.painting.add(job);
    return job;
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

  private imageProvider(): ImageProvider | undefined {
    const settings = this.store.settings;
    if (this.options.imageProvider) return this.options.imageProvider(settings);
    if (settings.ai.image.provider !== 'gemini' || !this.env.GEMINI_API_KEY) return undefined;
    return new GeminiImageProvider(this.env.GEMINI_API_KEY, settings.ai.image.model || undefined);
  }

  private place(record: ContentEntry): void {
    const def = record.definition;
    const region = this.world.region(record.regionId);
    if (!def || !region || !record.placements) return;
    if (def.kind === 'creature') region.addCreatures(record.id, record.placements, record.wisher.id);
    if (def.kind === 'npc') {
      const at = record.placements[0]!;
      region.addNpc({ id: record.id, name: def.name, asset: wishArtKey(record.id), x: at.x, y: at.y });
    }
  }

  private broadcast(record: ContentRecord): void {
    this.world.broadcast({ t: 'content', entries: [publicEntry(record)], replace: false });
  }

  private say(playerId: string, say: string): void {
    this.world.sendTo(playerId, { t: 'god', say });
  }
}

/** A content record without what only God's View sees (the conversation, cost, and a rule's script). */
export function publicEntry(record: ContentRecord): ContentEntry {
  const { conversation: _c, usd: _u, draft: _d, test: _t, rule: _r, ...entry } = record;
  if (entry.definition?.kind === 'rule') {
    const { script: _s, ...definition } = entry.definition;
    return { ...entry, definition };
  }
  return entry;
}
