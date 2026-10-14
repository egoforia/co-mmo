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
  validateDefinition,
  wishArtKey,
  type BiomeId,
  type ContentEntry,
  type PlayerInfo,
  type WishCard,
  type WishDefinition,
  type WishTier,
} from '@co-mmo/shared';
import { createChatModel, type ChatModel, type ChatTurn } from './ai/chat.ts';
import { GeminiImageProvider } from './assets/gemini.ts';
import type { ImageProvider } from './assets/provider.ts';
import { IMAGE_USD, paintWish } from './assets/wish-art.ts';
import { OfflineGod, askGod } from './god.ts';
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
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  /** Art being painted, so tests and shutdown can wait for it. */
  readonly painting = new Set<Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly options: WishOptions,
  ) {
    this.env = options.env ?? process.env;
    this.now = options.now ?? Date.now;
  }

  /** Puts every granted wish back into the world (at start-up). */
  restore(): void {
    for (const record of this.store.content) {
      applyContent(record);
      if (record.status === 'granted') this.place(record);
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
    wish: { tier: WishTier; title: string; summary: string; definition?: unknown },
    regionName: string,
    conversation: ChatTurn[],
    usd: number,
  ): { card?: WishCard; note?: string } | undefined {
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
    if (!open.card.instant) {
      this.record(player, open, 'pending');
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
    for (const region of this.world.regions.values()) {
      region.removeWish(id);
      for (const playerId of region.playerIds()) {
        if (region.character(playerId)?.inventory.some((s) => s.item === id)) {
          region.updateCharacter(playerId, (c) => {
            c.inventory = c.inventory.filter((s) => ITEMS[s.item]);
          });
        }
      }
    }
    this.broadcast(record);
    return record;
  }

  /** A Steward or the Owner decided a major or engine wish. */
  review(id: string, approve: boolean): ContentRecord | undefined {
    const record = this.store.contentById(id);
    if (!record || record.status !== 'pending') return undefined;
    this.store.updateContent(id, { status: approve ? 'approved' : 'rejected' });
    this.broadcast(record);
    this.world.sendTo(record.wisher.id, {
      t: 'god',
      say: approve
        ? `Your wish "${record.title}" was approved. It will be built for the world.`
        : `Your wish "${record.title}" was not approved this time.`,
    });
    return record;
  }

  /** Paints a granted wish's art when a provider is set and the budget allows. */
  paint(record: ContentRecord, force = false): Promise<void> | undefined {
    if (!record.definition || record.status !== 'granted') return undefined;
    const provider = this.imageProvider();
    if (!provider) return undefined;
    if (!force && this.budget().over) return undefined;
    const def = record.definition;
    const biome = (regionDef(record.regionId)?.biome ?? 'sanctum') as BiomeId;
    const job = paintWish(record.id, def, biome, provider, this.options.anchorDir, this.options.artDir)
      .then(() => {
        this.store.recordSpend({ at: this.now(), usd: IMAGE_USD, kind: 'image', provider: provider.id, model: provider.model, playerId: record.wisher.id });
        const updated = this.store.updateContent(record.id, { art: `/wished-art/${record.id}.png?v=${this.now().toString(36)}`, usd: record.usd + IMAGE_USD });
        if (updated) this.broadcast(updated);
      })
      .catch((err) => console.error(`Painting ${record.id} failed:`, (err as Error).message))
      .finally(() => this.painting.delete(job));
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

/** A content record without what only God's View sees. */
export function publicEntry(record: ContentRecord): ContentEntry {
  const { conversation: _c, usd: _u, ...entry } = record;
  return entry;
}
