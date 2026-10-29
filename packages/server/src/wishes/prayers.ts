import { BIOMES, callingWishesLeft, skillName, standing, type BiomeId, type PlayerInfo, type WishDefinition, type WishTier } from '@co-mmo/shared';
import type { ChatModel, ChatResult, ChatTurn } from '../ai/chat.ts';
import type { AiServices } from '../ai/services.ts';
import type { Budget } from '../budget.ts';
import { askGod, askWorkshopGod, type PrayerContext, type WorkshopContext, type WorkshopReply } from '../god.ts';
import type { Store } from '../store.ts';
import type { World } from '../world.ts';
import type { WishCards } from './cards.ts';
import type { WishNews } from './news.ts';

/** Turns of conversation the God remembers per player. */
const MEMORY_TURNS = 12;
/** Prayers a player may send per minute. */
const PRAYERS_PER_MINUTE = 6;
const MAX_PRAYER_LENGTH = 400;
/** What the God says when no model answered. */
const CLOUDED = 'The heavens are clouded; I cannot hear you clearly. Try again soon.';

/**
 * Talking to the God (design doc, The God): prayers and Workshop turns, what
 * the God is told about the player, how often they may ask, and what it
 * costs.
 */
export class Prayers {
  private readonly conversations = new Map<string, ChatTurn[]>();
  private readonly busy = new Set<string>();
  private readonly prayerTimes = new Map<string, number[]>();

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly ai: AiServices,
    private readonly budget: Budget,
    private readonly cards: WishCards,
    private readonly news: WishNews,
    private readonly now: () => number,
  ) {}

  /** A player speaks to the God; a wish in the answer comes as a card. */
  async pray(player: PlayerInfo, raw: string): Promise<void> {
    const id = player.id;
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PRAYER_LENGTH);
    if (!text) return;
    const region = this.world.regionOf(id);
    const ctx = await this.prayerContext(player);
    if (!region || !ctx) return;
    const refused = this.admit(id);
    if (refused) return this.news.say(id, refused);

    const history = [...(this.conversations.get(id) ?? []), { role: 'user' as const, content: text }].slice(-MEMORY_TURNS);
    this.busy.add(id);
    const spent = { usd: 0 };
    try {
      const { reply } = await askGod(this.ai.godModels(), ctx, history, this.chatSpend(id, spent));
      history.push({ role: 'assistant', content: reply.say });
      this.conversations.set(id, history.slice(-MEMORY_TURNS));
      const card = reply.wish && this.cards.makeCard(id, reply.wish, region.def.name, history, spent.usd);
      if (card?.note) {
        history.push({ role: 'assistant', content: card.note });
        this.conversations.set(id, history.slice(-MEMORY_TURNS));
      }
      this.world.sendTo(id, { t: 'god', say: card?.note ?? reply.say, ...(card?.card ? { card: card.card } : {}) });
    } catch (err) {
      console.error('Prayer failed:', err);
      this.news.say(id, CLOUDED);
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
    const open = this.cards.openOf(playerId);
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
        .filter(standing)
        .slice(-8)
        .reverse()
        .map((c) => `${c.title} (wished by ${c.wisher.name})`),
      ...(callingWishesLeft(character) > 0
        ? { callingWish: `${player.name} holds ${callingWishesLeft(character) === 1 ? 'a Calling Wish' : `${callingWishesLeft(character)} Calling Wishes`}. Their skills: ${character.abilities.map((a) => `${skillName(character, a)} (${a})`).join(', ') || 'none yet'}.` }
        : {}),
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


  /** A line for the God about where the world can grow from here. */
  private edgeLine(playerId: string): string {
    const open = this.world.openEdge(playerId);
    if (!open) return "Every edge of this region meets another land; a new region can only be wished at the world's edge.";
    return `This region is at the world's edge: a new region wished here would lie beyond its ${open.side} edge.`;
  }

}
