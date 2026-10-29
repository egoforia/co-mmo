import { randomBytes } from 'node:crypto';
import {
  CREATURES,
  WISH_COSTS,
  WishError,
  contentTier,
  validateDefinition,
  callingChangeProblem,
  validateCallingWish,
  validateLookWish,
  validateSkillLookWish,
  skillName,
  wishCost,
  type PlayerInfo,
  type Role,
  type Side,
  type WishCard,
  type WishDefinition,
} from '@co-mmo/shared';
import type { ChatTurn } from '../ai/chat.ts';
import type { GodReply } from '../god.ts';
import type { ContentRecord, Store } from '../store.ts';
import type { World } from '../world.ts';
import type { RuleDrafts } from './drafting.ts';
import type { Granting } from './granting.ts';
import { newWishId, type WishNews } from './news.ts';
import type { PaintedSample, WishPainter } from './painter.ts';

/** A wish card offered to a player and not yet answered. */
export interface OpenCard {
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

/** What the Workshop adds to a wish it offers. */
export interface ShapedWish {
  shaped: NonNullable<ContentRecord['shaped']>;
  sample?: PaintedSample;
  /** A new look for the player: allowed only from the Workshop, never from a prayer. */
  look?: boolean;
}

/**
 * Wish cards: what the God offers a player (its tier, cost and where it
 * appears), and what happens when the player says yes: granted at once,
 * or written down for the Stewards or the Owner.
 */
export class WishCards {
  private readonly cards = new Map<string, OpenCard>();
  /** Told when a confirmed card became a wish (granted or sent for review), so its Workshop draft can go. */
  onCardUsed?: (playerId: string, cardId: string) => void;

  constructor(
    private readonly store: Store,
    private readonly world: World,
    private readonly granting: Granting,
    private readonly painter: WishPainter,
    private readonly drafts: RuleDrafts,
    private readonly news: WishNews,
    private readonly now: () => number,
  ) {}

  /** The player's open card from Talk, if any (not an appointment). */
  openOf(playerId: string): OpenCard | undefined {
    return [...this.cards.values()].find((c) => c.playerId === playerId && !c.appoint);
  }

  /** Offers a card for what the God shaped, replacing the player's older one. */
  makeCard(
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
    const raw = wish.definition as { kind?: unknown } | undefined;
    // A Calling Wish answers to the wisher's own character; a refusal is said, never sent to the Stewards.
    if (raw?.kind === 'skill' && tier !== 'major' && tier !== 'engine') {
      const character = this.world.regionOf(playerId)?.character(playerId);
      if (!character) return undefined;
      try {
        definition = validateSkillLookWish(raw, character);
        tier = 'minor';
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
        return { note: err.message };
      }
    } else if (tier === 'minor' || tier === 'moderate') {
      try {
        // A new look is painted as one of the player's people.
        const race = this.world.regionOf(playerId)?.character(playerId)?.race;
        definition = look && raw?.kind === 'player' ? validateLookWish({ ...raw, ...(race ? { race } : {}) })
          : look && raw?.kind === 'calling' ? validateCallingWish(raw) : validateDefinition(raw);
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
        : definition?.kind === 'calling' ? 'You yourself: your attributes, and your look for a new people'
        : definition?.kind === 'skill' ? 'Your own skill, with your Calling Wish: its name and look change, nothing else'
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
    if (!confirm) return this.news.say(player.id, 'As you wish. It stays a dream, for now.');
    if (open.appoint) return this.appoint(player, open.appoint);
    if (!open.card.instant) {
      const record = this.record(player, open, 'pending');
      if (record.tier === 'major') void this.drafts.draft(record.id);
      return this.news.say(player.id, 'It is written. The Stewards will weigh your wish, and you will hear when it is decided.');
    }
    const region = this.world.regionOf(player.id);
    const character = region?.character(player.id);
    const at = region?.position(player.id);
    if (!region || !character || !at || !open.definition) return;
    if (character.favor < open.card.cost) {
      return this.news.say(player.id, `This wish needs ${open.card.cost} Favor, and you hold ${character.favor}. Help others, finish quests, and return.`);
    }
    const def = open.definition;
    let placements: { x: number; y: number }[] | undefined;
    if (def.kind === 'creature') placements = region.findSpots(at.x, at.y, def.count);
    if (def.kind === 'npc') placements = region.findSpots(at.x, at.y, 1, 1.2, 2);
    if (placements && placements.length === 0) return this.news.say(player.id, 'There is no room here. Find open ground and ask again.');
    // The people before the wish: changing it repaints the look.
    const race = character.race;
    if (def.kind === 'calling') {
      const why = callingChangeProblem(character, def.race, def.calling);
      if (why) return this.news.say(player.id, why);
    }
    if (def.kind === 'skill') {
      try {
        validateSkillLookWish(def, character);
      } catch (err) {
        if (!(err instanceof WishError)) throw err;
        return this.news.say(player.id, err.message);
      }
    }
    const reshaped = def.kind === 'skill' ? skillName(character, def.skill) : undefined;
    if (def.kind === 'loot' && !CREATURES[def.creature]) return this.news.say(player.id, 'That creature is no longer in the world. Choose another and ask again.');
    if (def.kind === 'region' && (!open.edge || !this.world.cellFree(open.edge.cell))) {
      return this.news.say(player.id, 'Another land has grown there since you asked. Find an open edge of the world and wish again.');
    }

    const record = this.record(player, open, 'granted', region.def.id, placements, open.edge?.cell);
    this.granting.apply(record);
    this.granting.place(record);
    void this.world.change(player.id, { op: 'favor', amount: -open.card.cost });
    if (def.kind === 'item' || def.kind === 'ability') void this.world.change(player.id, { op: 'give', item: record.id, qty: 1 });
    if (def.kind === 'skill') void this.world.change(player.id, { op: 'skillLook', skill: def.skill, name: def.name, description: def.description, wish: record.id });
    if (def.kind === 'calling') {
      void this.world.change(player.id, { op: 'calling', ...(def.race ? { race: def.race } : {}), ...(def.calling ? { calling: def.calling } : {}) });
      if (def.race && def.race !== race) this.granting.repaintLook(player, def.race);
    }
    this.news.broadcast(record);
    this.world.broadcast({ t: 'system', text: `✦ The God granted ${player.name}'s wish: ${record.title}.`, at: this.now() });
    this.news.say(player.id, def.kind === 'item' || def.kind === 'ability' ? 'It is done. Look in your bag.'
      : def.kind === 'recipe' ? 'It is done. Anyone can make it now: press C to open the crafting book.'
        : def.kind === 'region' ? `It is done. A road now leads ${open.edge!.side} to ${def.name}.`
          : def.kind === 'player' ? 'It is done. Everyone will see your new look.'
          : def.kind === 'skill' ? `It is done. Your ${reshaped} is ${def.name} now. Only its look and name have changed; it strikes as it always did.`
          : def.kind === 'calling' ? `It is done. ${def.calling ? 'Your free points are back for you to place: open your bag (I) to place them.' : 'Your new people will be painted soon.'}`
            : def.kind === 'loot' ? `It is done. Defeat a ${CREATURES[def.creature]?.name ?? 'creature'} and press E beside its body to see.`
            : 'It is done. Look around you.');
    if (!open.sample) this.painter.paint(record);
    else void this.painter.track(this.painter.useSample(record, open.sample).then((used) => (used ? undefined : this.painter.paint(record))));
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
      id: newWishId(this.now()),
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
    if (status !== 'granted') this.news.broadcast(record);
    this.onCardUsed?.(player.id, open.card.id);
    return record;
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
    this.news.say(owner.id, steward ? `It is done. ${appoint.name} is a Steward now.` : `It is done. ${appoint.name} rests from their duties.`);
  }

}
