import {
  ABILITIES,
  ITEMS,
  RECIPES,
  SHOPS,
  buy,
  craft,
  equip,
  readScroll,
  sell,
  spendPoint,
  STAT_NAMES,
  train,
  unequip,
  TALK_RANGE,
  itemCount,
  maxHp,
  npcName,
  takeItem,
  type EquipSlot,
  type ShopMessage,
  type Stats,
} from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

/**
 * The Adventurer's kit: wearing gear, using items and scrolls, crafting,
 * and shops (buying, selling and lessons).
 */
export class Kit {
  constructor(
    private readonly s: RegionState,
  ) {}

  /** Wears an item from the bag, or takes off what is in a slot. */
  wear(p: PlayerState, item?: string, slot?: EquipSlot): void {
    if (item) {
      const why = equip(p.character, item);
      if (why) return this.s.notice(p, why);
      this.s.notice(p, `You put on the ${ITEMS[item]!.name}.`);
      this.s.credit(item, p, 'equip');
    } else if (slot && !unequip(p.character, slot)) {
      return;
    }
    p.dirty = true;
  }

  /** Places a free attribute point; the server checks there is one to place. */
  placePoint(p: PlayerState, stat: keyof Stats): void {
    const why = spendPoint(p.character, stat);
    if (why) return this.s.notice(p, why);
    this.s.notice(p, `${STAT_NAMES[stat]} rises to ${p.character.stats[stat]}.`);
    p.dirty = true;
  }

  /** Makes a recipe from what is in the bag. */
  craft(p: PlayerState, recipe: string): void {
    const why = craft(p.character, recipe);
    if (why) return this.s.notice(p, why);
    const r = RECIPES[recipe]!;
    this.s.notice(p, `You made ${r.result.qty > 1 ? `${r.result.qty} × ` : 'a '}${ITEMS[r.result.item]!.name}.`);
    this.s.credit(recipe, p, 'craft');
    p.dirty = true;
  }

  /** Buying, selling and lessons, only while standing by the shopkeeper. */
  shop(p: PlayerState, m: ShopMessage): void {
    const keeper = this.s.townsfolk.find((n) => n.id === m.npc);
    if (!keeper || !SHOPS[m.npc] || keeper.floor !== p.floor || Math.hypot(keeper.x - p.x, keeper.y - p.y) > TALK_RANGE + 1) {
      return this.s.notice(p, `Walk up to ${npcName(m.npc)} to trade.`);
    }
    const ch = p.character;
    const before = ch.gold;
    const why = m.action === 'buy' ? buy(ch, m.npc, m.id) : m.action === 'sell' ? sell(ch, m.npc, m.id, m.qty ?? 1) : train(ch, m.npc, m.id);
    if (why) return this.s.notice(p, why);
    const name = m.action === 'learn' ? ABILITIES[m.id]!.name : ITEMS[m.id]?.name ?? m.id;
    this.s.notice(p, m.action === 'buy'
      ? `You bought a ${name} for ${before - ch.gold} gold.`
      : m.action === 'sell'
        ? `You sold ${m.qty && m.qty > 1 ? `${m.qty} × ` : 'a '}${name} for ${ch.gold - before} gold.`
        : `${npcName(m.npc)} teaches you ${name}. It is on the ${ch.abilities.length} key.`);
    p.dirty = true;
  }

  /** Uses a thing from the bag: wears gear, reads a scroll, drinks a potion, or tells scripted rules. */
  useItem(p: PlayerState, item: string): void {
    const def = ITEMS[item];
    const ch = p.character;
    if (!def || itemCount(ch, item) === 0 || ch.hp <= 0) return;
    if (def.slot) return this.wear(p, item);
    if (def.teaches) {
      const why = readScroll(ch, item);
      if (why) return this.s.notice(p, why);
      this.s.notice(p, `You read the scroll and learn ${ABILITIES[def.teaches]!.name}. It is on the ${ch.abilities.length} key.`);
      this.s.credit(item, p, 'learn');
      p.dirty = true;
      return;
    }
    // Items without a built-in use are for scripted rules (a fishing rod).
    if (!def.heal) {
      if (def.kind !== 'book') {
        this.s.hooks.event?.('use', p.info.id, { item });
        this.s.credit(item, p, 'use');
      }
      return;
    }
    const max = maxHp(ch);
    if (ch.hp >= max) return this.s.notice(p, 'You are already at full health.');
    takeItem(ch, item);
    ch.hp = Math.min(max, ch.hp + def.heal);
    this.s.notice(p, `You drink a ${def.name}.`);
    this.s.credit(item, p, 'use');
    p.dirty = true;
  }
}
