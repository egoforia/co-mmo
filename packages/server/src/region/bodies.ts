import {
  ITEMS,
  SEARCH_RANGE,
  addItem,
  type InventorySlot,
  type LootActionMessage,
  type LootView,
} from '@co-mmo/shared';
import type { Body, PlayerState, RegionState } from './state.ts';

/**
 * Bodies of defeated creatures and their loot windows: anyone may take what
 * a body holds, and everyone with its window open sees it change.
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
    let taken: InventorySlot[];
    if (m.action === 'all') taken = body.loot.splice(0);
    else {
      // Someone may have taken something since this window was drawn: find the same thing again.
      const at = m.index !== undefined && body.loot[m.index]?.item === m.item ? m.index : body.loot.findIndex((s) => s.item === m.item);
      if (at < 0) {
        this.s.notice(p, 'Someone else took that already.');
        return this.showLoot(body);
      }
      taken = body.loot.splice(at, 1);
    }
    for (const s of taken) addItem(p.character, s.item, s.qty);
    p.dirty = true;
    const names = taken.map((s) => `${s.qty > 1 ? `${s.qty} × ` : 'a '}${ITEMS[s.item]?.name ?? s.item}`).join(', ');
    this.s.notice(p, `You take ${names} from the ${body.def.name}.`);
    for (const id of body.finders) {
      if (id !== p.info.id) this.s.tell(id, `${p.info.name} took ${names} from the ${body.def.name} you defeated.`);
    }
    this.showLoot(body);
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
    return !!b && p.character.hp > 0 && Math.hypot(b.x - p.x, b.y - p.y) <= SEARCH_RANGE + 1;
  }

}

/** What a body's loot window shows. */
function lootView(b: Body): LootView {
  return { id: b.id, name: b.def.name, asset: b.def.art, items: b.loot.map((s) => ({ ...s })) };
}
