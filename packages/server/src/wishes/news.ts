import { randomBytes } from 'node:crypto';
import { engineModId, wishProgress, type ContentEntry } from '@co-mmo/shared';
import type { ContentRecord, Store } from '../store.ts';
import type { World } from '../world.ts';

/**
 * Telling people about wishes: every client when a wish changes, the
 * wisher, and the Stewards. Every part of the wish module shares one.
 */
export class WishNews {
  constructor(
    private readonly store: Store,
    private readonly world: World,
  ) {}

  /** Tells every client a wish changed. */
  broadcast(record: ContentRecord): void {
    this.world.broadcast({ t: 'content', entries: [publicEntry(record)], replace: false });
  }

  /** Tells every client a wish's progress changed (drafting, a test run, a pause). */
  changed(id: string): void {
    const record = this.store.contentById(id);
    if (record) this.broadcast(record);
  }

  /** A line to the wisher, if they are online. */
  tellWisher(record: ContentRecord, text: string): void {
    if (this.world.has(record.wisher.id)) this.world.sendTo(record.wisher.id, { t: 'notice', text: `✦ ${text}` });
  }

  /** A line for every Steward and the Owner who is online. */
  notifyStewards(text: string): void {
    for (const account of this.store.accounts) {
      if (account.role !== 'player' && this.world.has(account.id)) this.world.sendTo(account.id, { t: 'notice', text: `✦ ${text}` });
    }
  }

  /** The God speaks to one player. */
  say(playerId: string, say: string): void {
    this.world.sendTo(playerId, { t: 'god', say });
  }
}

/** A content record without what only God's View sees (the conversation, cost, image prompts, and a rule's script). */
export function publicEntry(record: ContentRecord): ContentEntry {
  const { conversation: _c, usd: _u, draft: _d, test: _t, rule: _r, build: _b, artPrompts: _p, shaped: _s, ...rest } = record;
  const entry: ContentEntry = { ...rest, progress: wishProgress(record), ...(record.build?.issue ? { mod: engineModId(record.build.issue.number) } : {}) };
  if (entry.definition?.kind === 'rule') {
    const { script: _s, ...definition } = entry.definition;
    return { ...entry, definition };
  }
  return entry;
}

/** A new wish's id: when it was made, and a little chance. */
export function newWishId(now: number): string {
  return `w${now.toString(36)}${randomBytes(2).toString('hex')}`;
}
