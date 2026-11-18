import {
  BAG_FULL,
  GOLD,
  ITEMS,
  PILE_JOIN,
  PILE_KIND,
  PILE_MS,
  PILE_STACKS,
  pileName,
  collides,
  isBlocking,
  tileAt,
  SEARCH_RANGE,
  addItem,
  type InventorySlot,
  type LootActionMessage,
  type LootView,
} from '@co-mmo/shared';
import type { Body, PlayerState, RegionState } from './state.ts';

/** How far beside the player a new pile lies, in tiles along each axis. */
const PILE_SIDE = 0.45;

/**
 * Bodies of defeated creatures, piles of dropped things, and their loot
 * windows: anyone may take what a body or pile holds, and everyone with its
 * window open sees it change.
 */
export class Bodies {
  constructor(
    private readonly s: RegionState,
  ) {}

  /**
   * Opens the loot window of the nearest body in reach with something on it;
   * false when there is none. An empty body only gets a word, so E still acts
   * on the land beside it (fishing). Anyone may take what a body holds.
   */
  search(p: PlayerState): boolean {
    const inReach = this.s.bodies
      .filter((b) => b.floor === p.floor)
      .map((b) => ({ b, d: Math.hypot(b.x - p.x, b.y - p.y) }))
      .filter((o) => o.d <= SEARCH_RANGE)
      .sort((a, c) => a.d - c.d)
      .map((o) => o.b);
    const body = inReach.find((b) => b.loot.length > 0);
    if (!body) {
      const near = inReach[0];
      if (near) this.s.notice(p, `You search the ${near.def.name}, but there is nothing more to find.`);
      return false;
    }
    p.looting = body.id;
    p.conn.send({ t: 'loot', loot: lootView(body) });
    return true;
  }

  /** Takes one thing or everything from the body whose window is open, or closes it. */
  take(p: PlayerState, m: LootActionMessage): void {
    if (m.action === 'close') {
      if (p.looting === m.body) p.looting = undefined;
      return;
    }
    const body = this.s.bodies.find((b) => b.id === m.body);
    if (!body || !this.lootable(p, m.body)) {
      this.closeLoot(p);
      return this.s.notice(p, body ? `You are too far from the ${body.def.name}. Step closer and press E.` : 'That body has faded away.');
    }
    if (p.character.hp <= 0) return;
    p.looting = body.id;
    let wanted: InventorySlot[];
    if (m.action === 'all') wanted = [...body.loot];
    else {
      // Someone may have taken something since this window was drawn: find the same thing again.
      const at = m.index !== undefined && body.loot[m.index]?.item === m.item ? m.index : body.loot.findIndex((s) => s.item === m.item);
      if (at < 0) {
        this.s.notice(p, 'Someone else took that already.');
        return this.showLoot(body);
      }
      wanted = [body.loot[at]!];
    }
    // As much as the bag holds comes away; the rest stays on the body.
    const taken: InventorySlot[] = [];
    for (const s of wanted) {
      const n = addItem(p.character, s.item, s.qty);
      if (!n) continue;
      taken.push({ item: s.item, qty: n });
      s.qty -= n;
    }
    body.loot = body.loot.filter((s) => s.qty > 0);
    const full = taken.length < wanted.length || wanted.some((s) => s.qty > 0);
    if (!taken.length) {
      this.s.notice(p, BAG_FULL);
      return this.showLoot(body);
    }
    p.dirty = true;
    this.s.owned(p, taken.map((s) => s.item), 'looted');
    const names = taken.map((s) => (s.item === GOLD ? `${s.qty} gold` : `${s.qty > 1 ? `${s.qty} × ` : 'a '}${ITEMS[s.item]?.name ?? s.item}`)).join(', ');
    this.s.notice(p, `You take ${names} from the ${body.def.name}.${full ? ` ${BAG_FULL} The rest stays on the body.` : ''}`);
    for (const id of body.finders) {
      if (id !== p.info.id) this.s.tell(id, `${p.info.name} took ${names} from the ${body.def.name} you defeated.`);
    }
    // The one who fell hears who took their things, wherever they are.
    if (body.owner && body.owner.id !== p.info.id) this.s.tellAnywhere(body.owner.id, `${p.info.name} took ${names} from your body.`);
    this.s.bodyChanged(body);
    this.showLoot(body);
  }

  /**
   * Drops `qty` from the stack in bag cell `index` (all of it when missing)
   * at the player's feet: it joins a pile close by, or starts one, which
   * anyone may take for PILE_MS. Bound things stay in the bag.
   */
  drop(p: PlayerState, index: number, qty?: number): void {
    const c = p.character;
    const slot = c.inventory[index];
    if (!slot || c.hp <= 0) return;
    const def = ITEMS[slot.item];
    if (def?.bound) return this.s.notice(p, `The ${def.name} stays with you; it cannot be dropped.`);
    const n = Math.min(qty ?? slot.qty, slot.qty);
    slot.qty -= n;
    if (slot.qty === 0) c.inventory.splice(index, 1);
    p.dirty = true;
    const now = this.s.now();
    const floor = p.floor ?? 0;
    let pile = this.s.bodies.find((b) => b.kind === PILE_KIND && b.floor === floor && b.loot.length < PILE_STACKS && Math.hypot(b.x - p.x, b.y - p.y) <= PILE_JOIN);
    if (!pile) {
      const at = this.beside(p.x, p.y, floor);
      pile = { id: `pile-${p.info.id}-${now}-${this.s.bodyCount++}`, kind: PILE_KIND, def: { name: '', art: '' }, x: at.x, y: at.y, floor, until: 0, finders: [], loot: [] };
      this.s.bodies.push(pile);
    }
    const same = pile.loot.find((s) => s.item === slot.item);
    if (same) same.qty += n;
    else pile.loot.push({ item: slot.item, qty: n });
    // Each drop starts its ten minutes again; the pile's look is the first thing on it.
    pile.until = now + PILE_MS;
    pile.def = { name: pileName(pile.loot), art: ITEMS[pile.loot[0]!.item]?.art ?? '' };
    const what = slot.item === GOLD ? `${n} gold` : `${n > 1 ? `${n} × ` : 'the '}${def?.name ?? slot.item}`;
    this.s.notice(p, `You drop ${what}. Anyone may take it for ten minutes.`);
    this.showLoot(pile);
  }

  /**
   * Where a new pile lies: a step to the player's right on screen (half a
   * tile along x, back along y, at the same depth), so it doesn't stand in
   * front of them; at their feet when that spot is in a wall.
   */
  private beside(x: number, y: number, floor: number): { x: number; y: number } {
    const to = { x: x + PILE_SIDE, y: y - PILE_SIDE };
    const map = this.s.map;
    const open = !isBlocking(tileAt(map, Math.floor(to.x), Math.floor(to.y), floor)) && !collides(map, to.x, to.y, floor);
    return open ? to : { x, y };
  }

  /** Shows a body's loot again to everyone who has its window open, closing it once nothing is left. */
  private showLoot(body: Body): void {
    for (const viewer of this.s.players.values()) {
      if (viewer.looting !== body.id) continue;
      if (body.loot.length) viewer.conn.send({ t: 'loot', loot: lootView(body) });
      else this.closeLoot(viewer);
    }
  }

  /** Shuts a player's loot window. */
  closeLoot(p: PlayerState): void {
    p.looting = undefined;
    p.conn.send({ t: 'loot', loot: null });
  }

  /** True while this body lies here and the player is close enough to take from it. */
  lootable(p: PlayerState, bodyId: string): boolean {
    const b = this.s.bodies.find((x) => x.id === bodyId);
    // A little slack, so a step while choosing does not shut the window.
    return !!b && p.character.hp > 0 && b.floor === p.floor && Math.hypot(b.x - p.x, b.y - p.y) <= SEARCH_RANGE + 1;
  }

}

/** What a body's loot window shows. */
function lootView(b: Body): LootView {
  return { id: b.id, name: b.def.name, asset: b.def.art, items: b.loot.map((s) => ({ ...s })) };
}
