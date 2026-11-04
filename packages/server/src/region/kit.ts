import {
  ABILITIES,
  ITEMS,
  RECIPES,
  SHOPS,
  buy,
  craft,
  crafted,
  shopMade,
  copyWords,
  bindOnWear,
  CRAFTS,
  MAX_CRAFT_LEVEL,
  craftLevel,
  isCraft,
  master,
  practise,
  type CraftId,
  equip,
  readScroll,
  sell,
  spendPoint,
  STAT_NAMES,
  train,
  unequip,
  TALK_RANGE,
  itemCount,
  keyWords,
  maxHp,
  setHotbar,
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
      // A unique piece binds to whoever first wears it.
      const was = ITEMS[item];
      const why = equip(p.character, item, (id) => bindOnWear(p.character, id));
      if (why) return this.s.notice(p, why);
      const bound = was?.unique && !was.copy?.bound && was.copy;
      this.s.notice(p, `You put on the ${was!.name}.${bound ? ' It binds to you.' : ''}`);
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

  /** Arranges keys 1 to 6 from the spellbook; the server checks every ability is known. */
  arrangeHotbar(p: PlayerState, slots: string[]): void {
    const why = setHotbar(p.character, slots);
    if (why) return this.s.notice(p, why);
    p.dirty = true;
  }

  /** Makes a recipe from what is in the bag; the craft grows and the tool may wear out. */
  craft(p: PlayerState, recipe: string, lean?: keyof Stats): void {
    const before = new Set(p.character.inventory.map((s) => s.item));
    const why = craft(p.character, recipe, crafted(p.character, p.info.name, recipe, this.s.random, lean));
    if (why) return this.s.notice(p, why);
    const r = RECIPES[recipe]!;
    // A crafted piece of gear says how well it came out.
    const copy = p.character.inventory.find((s) => !before.has(s.item) && ITEMS[s.item]?.copy);
    const done = practise(p.character, recipe, this.s.random);
    const grew = done.craft && done.level ? ` Your ${CRAFTS[done.craft].name} rises to level ${done.level}.` : '';
    const broke = done.broke ? ` Your ${done.broke} wore out.` : '';
    this.s.notice(p, `You made ${r.result.qty > 1 ? `${r.result.qty} × ` : 'a '}${ITEMS[r.result.item]!.name}.${copy ? ` ${copyWords(ITEMS[copy.item])}` : ''}${grew}${broke}`);
    this.s.credit(recipe, p, 'craft');
    p.dirty = true;
  }

  /** Taking up a mastery, or changing one, with the craft's master. */
  private master(p: PlayerState, m: ShopMessage): void {
    const ch = p.character;
    if (!isCraft(m.id) || (m.replace !== undefined && !isCraft(m.replace))) return;
    const replace = m.replace as CraftId | undefined;
    const why = master(ch, m.npc, m.id, replace);
    if (why) return this.s.notice(p, why);
    this.s.notice(p, `${npcName(m.npc)} names you a master of ${CRAFTS[m.id].name}. You can now rise to level ${MAX_CRAFT_LEVEL} and work the rarest materials.${replace ? ` Your ${CRAFTS[replace].name} drops back to level ${craftLevel(ch, replace)}.` : ''}`);
    p.dirty = true;
  }

  /** Buying, selling and lessons, only while standing by the shopkeeper. */
  shop(p: PlayerState, m: ShopMessage): void {
    const keeper = this.s.townsfolk.find((n) => n.id === m.npc);
    if (!keeper || !SHOPS[m.npc] || keeper.floor !== p.floor || Math.hypot(keeper.x - p.x, keeper.y - p.y) > TALK_RANGE + 1) {
      return this.s.notice(p, `Walk up to ${npcName(m.npc)} to trade.`);
    }
    if (m.action === 'master') return this.master(p, m);
    const ch = p.character;
    const before = ch.gold;
    const why = m.action === 'buy' ? buy(ch, m.npc, m.id, shopMade(npcName(m.npc), this.s.random, m.npc)) : m.action === 'sell' ? sell(ch, m.npc, m.id, m.qty ?? 1) : train(ch, m.npc, m.id);
    if (why) return this.s.notice(p, why);
    const name = m.action === 'learn' ? ABILITIES[m.id]!.name : ITEMS[m.id]?.name ?? m.id;
    this.s.notice(p, m.action === 'buy'
      ? `You bought a ${name} for ${before - ch.gold} gold.`
      : m.action === 'sell'
        ? `You sold ${m.qty && m.qty > 1 ? `${m.qty} × ` : 'a '}${name} for ${ch.gold - before} gold.`
        : `${npcName(m.npc)} teaches you ${name}. ${keyWords(ch, m.id)}`);
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
      this.s.notice(p, `You read the scroll and learn ${ABILITIES[def.teaches]!.name}. ${keyWords(ch, def.teaches)}`);
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
