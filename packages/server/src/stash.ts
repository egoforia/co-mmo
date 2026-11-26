import { putInStash, takeFromStash, type ServerMessage, type StashMessage } from '@co-mmo/shared';
import type { OpResult } from './character-ops.ts';
import type { Account, Store } from './store.ts';
import type { World } from './world.ts';

// The shared stash (docs/stash.md): one chest for every character on an
// account. It is kept with the saved world on the account's first record,
// while the character's bag is in whatever region (or region server) they
// stand in, so each move is two steps: the region changes the bag (and checks
// the player stands by a stash chest), then the store changes the stash.
// Changes for one account run one at a time, so the stash never changes
// between the two steps and nothing is copied or lost.

export interface StashOptions {
  store: Store;
  world: World;
  /** How many slots each stash holds (settings.ts stashSlots). */
  slots: () => number;
}

/** Answers `stash` messages from the game socket. */
export class Stashes {
  /** The last change queued per account (by the record that signs in). */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: StashOptions) {}

  /** Handles one message from a character in the world. */
  handle(account: Account, m: StashMessage): Promise<void> {
    const key = this.options.store.mainOf(account).id;
    const next = (this.queues.get(key) ?? Promise.resolve()).then(() => this.run(account, m)).catch((err) => console.error('Stash failed:', err));
    this.queues.set(key, next);
    void next.then(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private async run(account: Account, m: StashMessage): Promise<void> {
    const { store, world, slots } = this.options;
    const id = account.id;
    const size = slots();
    if (m.action === 'close') return;
    const stash = store.stashOf(account);
    const view = (): ServerMessage => ({ t: 'stash', open: true, slots: store.stashOf(account), size });
    const refused = (r: OpResult): boolean => {
      if (r.ok) return false;
      world.sendTo(id, r.why ? { t: 'notice', text: r.why } : { t: 'stash', open: false, slots: [], size });
      return true;
    };
    if (m.action === 'open') {
      if (!refused(await op(world, id, { op: 'stashNear' }))) world.sendTo(id, view());
      return;
    }
    if (m.action === 'in') {
      const r = await op(world, id, { op: 'stashIn', index: m.index ?? -1, ...(m.qty ? { qty: m.qty } : {}), stash, slots: size });
      if (refused(r) || !r.taken) return;
      putInStash(stash, r.taken.item, r.taken.qty, Number.MAX_SAFE_INTEGER);
      store.saveStash(account, stash);
      world.sendTo(id, view());
      return;
    }
    // Out: off the stash first, back on if the bag had no room.
    const taken = takeFromStash(stash, m.index ?? -1, m.qty);
    if (!taken) return;
    if (refused(await op(world, id, { op: 'stashOut', item: taken.item, qty: taken.qty }))) return;
    store.saveStash(account, stash);
    world.sendTo(id, view());
  }
}

/** A character change wherever the player is, as a promise. */
async function op(world: World, id: string, change: Parameters<World['change']>[1]): Promise<OpResult> {
  return world.change(id, change);
}
