import type { Account } from './store.ts';

// Several characters on one account. Every character is an Account record of
// its own, so everything the game keys by player id (Favor, the bag, a look,
// wishes, parties, where they stand) stays with that character. The first
// character holds the sign-in (session tokens, email, Google and GitHub);
// every later one points back to it with `mainId`. The role and a
// suspension belong to the whole account, so they are kept the same on all of
// its characters. These are plain functions over the store's accounts; the
// store calls them and saves.

/** Fields that belong to signing in, kept only on the account's main record. */
const SIGN_IN = ['tokenHash', 'sessions', 'email', 'logins', 'playing'] as const;

/** The record that signs in for this character: itself, or the one its `mainId` names. */
export function mainOf(accounts: readonly Account[], account: Account): Account {
  if (!account.mainId) return account;
  return accounts.find((a) => a.id === account.mainId) ?? account;
}

/** Every character of the account `main` signs in for, oldest first, `main` among them. */
export function charactersOf(accounts: readonly Account[], main: Account): Account[] {
  return accounts.filter((a) => a.id === main.id || a.mainId === main.id).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The character a signed-in account plays: `wanted` when it is one of theirs,
 * else the one they chose last, else the first.
 */
export function playingOf(accounts: readonly Account[], main: Account, wanted?: string): Account {
  const mine = charactersOf(accounts, main);
  return mine.find((a) => a.id === wanted) ?? mine.find((a) => a.id === main.playing) ?? main;
}

/**
 * Takes a character out of `accounts` (changed in place). When it is the
 * main record, the next oldest character takes over the sign-in, and the rest
 * point to it. Returns the main record afterwards.
 */
export function removeCharacter(accounts: Account[], main: Account, id: string): Account {
  const mine = charactersOf(accounts, main);
  const gone = mine.find((a) => a.id === id);
  if (!gone) return main;
  let next = main;
  if (gone.id === main.id) {
    next = mine.find((a) => a.id !== id)!;
    delete next.mainId;
    for (const field of SIGN_IN) {
      if (main[field] !== undefined) (next as unknown as Record<string, unknown>)[field] = main[field];
    }
    for (const a of mine) if (a.mainId === main.id) a.mainId = next.id;
  }
  if (next.playing === id) delete next.playing;
  accounts.splice(accounts.indexOf(gone), 1);
  return next;
}
