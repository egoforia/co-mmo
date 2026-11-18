import { MAX_HISTORY_ASK, makesCopies, ITEMS, type Character, type OwnerEntry } from '@co-mmo/shared';

/** How each owner came by a piece, in the words its card uses. */
const HOW: Record<OwnerEntry['how'], string> = { crafted: 'made by', bought: 'bought by', looted: 'looted by', given: 'given to', found: 'found by' };

/**
 * Owner histories of pieces of gear, as the server told them. Each piece is
 * asked about once while it is held; a piece that leaves and comes back is
 * asked about again, since it has a new owner since.
 */
export class GearHistories {
  private readonly histories = new Map<string, OwnerEntry[]>();
  private readonly asked = new Set<string>();

  /** Keeps the histories the server sent. */
  set(histories: Record<string, OwnerEntry[]>): void {
    for (const [id, list] of Object.entries(histories)) this.histories.set(id, list);
  }

  /** Asks (through `ask`) about held gear whose history is not known yet. */
  askFor(c: Pick<Character, 'inventory' | 'equipment'>, ask: ((items: string[]) => void) | undefined): void {
    const held = [...c.inventory.map((s) => s.item), ...Object.values(c.equipment).filter((id): id is string => !!id)];
    for (const id of this.asked) if (!held.includes(id)) this.asked.delete(id);
    const gear = held.filter((id) => makesCopies(ITEMS[id]) && !this.asked.has(id));
    if (!gear.length || !ask) return;
    for (const id of gear) this.asked.add(id);
    ask(gear.slice(0, MAX_HISTORY_ASK));
  }

  /** A piece's owners in plain words for its card, or '' when none are known yet. */
  words(id: string): string {
    const list = this.histories.get(id);
    if (!list?.length) return '';
    const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return ` Owners: ${list.map((o) => `${HOW[o.how]} ${o.name} (${day(o.at)})`).join(', ')}.`;
  }
}
