# Several characters on one account

A player may have more than one character on the same account: 5 unless the
Owner sets another number (God's View > Players, 1 to 20).

## For players

- After signing in, an account with two or more characters sees the
  character screen: each character's picture, people, Calling, level and
  land, with Play and Delete. An account with one character goes straight in,
  as before.
- Account > Switch character opens the screen from inside the game, where
  "New character" makes another: a name, a people and Calling, and a look
  (their first wish, free, as at sign-up). They start in the Sanctum at level 1.
- Each character keeps everything of their own: Favor, coins, the bag, gear,
  their look, level, Path, crafts, wishes and Workshop draft. Things pass
  between them through the account's shared stash (`docs/stash.md`).
- One character is in the world at a time. Entering with another in a second
  window takes the first one out.
- Deleting asks for the character's name and cannot be undone. The last
  character on an account cannot be deleted.

## For Stewards and the Owner

- A Steward appointment and a suspension count for the whole account: every
  character on it, including ones made later.
- The Players tab lists every character; a second or later one says whose
  account it is on. Nobody can suspend their own account through another of
  its characters.

## How it is built

- Every character is an `Account` record of its own (`store.ts`), so
  everything keyed by player id (the world, Favor, looks, wishes, parties,
  the `characters` and `holdings` tables) stays per character with no change.
- The first character's record holds the sign-in: session tokens, email,
  Google and GitHub. Later characters point back with `mainId` and hold no
  sign-in. `playing` on the first record remembers the character chosen last.
  When the first character is deleted, the next oldest takes the sign-in over
  (`store-roster.ts`), so the same token, email and logins keep working.
- `character-routes.ts`: `GET /api/characters` (the screen's list), `POST
  /api/characters` (a new one), `POST /api/characters/:id/play` (choose),
  `DELETE /api/characters/:id` with `{ name }` to confirm.
- The game socket's `hello` may name a `character`; without one it enters as
  the character chosen last. It keeps one connection per account
  (`game-socket.ts`).
- In the browser: `character-select.ts` is the screen; `main.ts` shows it on
  sign-in when there is a choice, and once a tab has chosen, a reload or
  reconnect goes straight back in.
- Existing accounts need no migration: each is its own first character.
