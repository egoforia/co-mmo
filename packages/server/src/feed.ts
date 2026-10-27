import { regionDef, type AwayMessage } from '@co-mmo/shared';
import type { Account, Store } from './store.ts';

/** Lines shown at most; the rest are counted. */
export const FEED_LINES = 12;

/**
 * The "While you were away" feed (design doc, Persistence and playing at
 * different times): wishes other players made and notable moments from the
 * journal since this player was last in the world. Undefined on a first
 * visit or when nothing happened.
 */
export function awayFeed(store: Store, account: Account): AwayMessage | undefined {
  const since = account.lastSeen;
  if (since === undefined) return undefined;
  const items: { at: number; text: string }[] = [];
  for (const c of store.content) {
    if (c.at <= since || c.wisher.id === account.id || c.definition?.kind === 'player' || c.definition?.kind === 'calling') continue;
    const where = c.placements ? regionDef(c.regionId)?.name : undefined;
    if (c.status === 'granted') items.push({ at: c.at, text: `${c.wisher.name} wished for "${c.title}"${where ? ` in ${where}` : ''}.` });
    else if (c.status === 'pending') items.push({ at: c.at, text: `${c.wisher.name} made a big wish, "${c.title}". It waits for the Stewards.` });
  }
  for (const j of store.journalSince(since)) {
    if (j.playerId !== account.id) items.push({ at: j.at, text: j.text });
  }
  if (!items.length) return undefined;
  items.sort((a, b) => a.at - b.at);
  const shown = items.slice(-FEED_LINES);
  return { t: 'away', since, items: shown, more: items.length - shown.length };
}
