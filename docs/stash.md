# The shared stash

Every account has one shared stash: a chest of stacks that all its
characters open (docs/characters.md). It is how gear, materials and coins
pass from one character to another. Decided by egoforia on 2026-11-26:
opened only at stash chests in safe areas, coins may go in, 40 slots set by
the Owner, free.

## For players

- Stand by a stash chest and press **E**. The Shared stash window opens
  beside the bag.
- **Shift-click** a thing in the bag (or choose it and press **T**) to put
  the whole stack in. Click a thing in the stash to take it out.
- Bound things (the Bible) cannot go in. Coins can, so a new character can be
  given starting gold.
- Nothing in the stash is lost when a character falls; only what they carry
  is at risk.
- Walking away from the chest closes the window.

## For the Owner and Stewards

- The world editor's **Stash chest** tool (Furnish) stands one, 2 by 1 tiles,
  on open ground in a safe area only. The chest shows once its picture
  (`stash-chest`, a set piece) is painted in the Art tab.
- God's View > Players sets the slots in each stash (1 to 200, 40 by
  default). A smaller size keeps what is already in a stash; it only stops
  more going in.
- Who holds an item (`/api/admin/holders`) lists stash stacks with
  `place: 'stash'`, under the account's first character.

## How it is built

- Rules both sides use: shared `rpg/stash.ts` (room, putting in, taking out,
  `nearStashChest`).
- The stash is kept on the account's first record (`Account.stash`,
  `store.ts`), so it moves with the sign-in if that character is deleted
  (`store-roster.ts`).
- `stash.ts` answers the `stash` message at the game socket. Each move is a
  character change in the player's region (`character-ops.ts`: `stashNear`,
  `stashIn`, `stashOut`, which check the player stands by a chest and is not
  Fallen) and a change to the saved stash. Moves for one account run one at a
  time, so nothing is copied or lost, also with region servers.
- The chest is a world edit kind (`world-edits/kinds/stash.ts`) laying a
  `stash-chest` landmark.
- Browser: `stash-ui.ts`, docked beside the bag (`inventory/docking.ts`).
