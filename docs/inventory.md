# The bag (Character window)

How the bag works for players, where its code lives, and how a wish adds a
new kind of thing to it. Built in the inventory refactor (PRs #260 to #268,
plan: https://claude.ai/artifact/X3SgZ4ECgYeRo9vQZjqMvf).

## What players see

**I** opens one window with two tabs.

- **Bag** (opens first):
  - **If you fall here**: one line saying what a death costs right now (the
    XP, all the gold carried, 15% for each worn piece and for the bag with all
    in it), or "Safe here" in a safe area. **Why?** opens the Bible.
  - **The doll**: the player's standing picture with Head, Body, Weapon and
    Feet down the left, Charm, Cloak and Off hand down the right, and a Bag
    slot that only shows the bag's 15% chance to drop.
  - **The grid**: all 20 cells, five across, empty ones dashed, so a full bag
    looks full. Better things show their rarity on the cell's edge.
  - Coins and "n of 20 slots" in the header; **Sort** above the grid.
- **Sheet**: attributes, the numbers they make, the Path and Creator level.
  Abilities are in the spellbook (K).

Hovering or choosing any item, in the bag, a loot window or a shop, shows its
**item card**: name in its rarity colour, kind, bonus, description, and for
gear in the bag, **If you wear it**: each bonus gained (green) or lost (red)
against what is worn, counting the off hand a two-handed weapon takes off.

| To | Mouse | Keys | Touch |
| --- | --- | --- | --- |
| Use, drink, wear, read | Click | Enter on the chosen cell | Tap |
| Take off | Click a worn slot, or drag it to the grid | Enter on it | Tap |
| Move, merge or swap stacks | Drag onto a cell | | Drag |
| Wear by dragging | Drag onto its worn slot | | Drag |
| Split a stack | Menu, Split box | S | Hold, Split box |
| Drop on the ground | Menu, Drop, or drag out of the window | Delete | Hold, Drop |
| Sell or offer one | Shift-click, with a shop or trade open | T | |
| Every action | Right-click | M | Hold |

The arrow keys choose a cell while the bag is open; WASD still walks.

## Rules (all on the server)

- 20 stacks, 99 a stack. Coins share one slot however many there are. One
  thing may fill more than one slot: a split stack, or more than 99.
- `bag` message: `move` (onto the same thing it merges, onto another stack the
  two swap, onto an empty cell it goes last), `split` (needs a free slot),
  `sort` (by kind, then rarity, then name, joining split stacks), `drop`.
- **Dropping** leaves a pile beside the player that anyone may take, like a
  body's loot, for ten minutes from the last drop, or until it is empty.
  Drops close by join it. Bound things, like the Bible, can't be dropped.
  Piles are not saved across a restart.
- The bag's order is part of the character, so it is saved.
- Loot, shop and trade windows dock beside the bag on screens 900 px or
  wider; the bag closes with them if docking opened it.

## Code

| Part | Where |
| --- | --- |
| Bag rules: room, stacks, coins | `shared/src/rpg/bag.ts` |
| Move, split, sort | `shared/src/rpg/bag-order.ts` |
| Piles | `shared/src/rpg/piles.ts`, `server/src/region/bodies.ts` (`drop`) |
| Compare with what is worn | `shared/src/rpg/compare.ts` |
| What falling costs | `deathRisk`, `deathRiskWords` in `shared/src/death.ts` |
| The `bag` message | `shared/src/protocol.ts`, `server/src/region/bag-order.ts` |
| The window (facade) | `client/src/inventory-ui.ts` |
| Doll, grid, Sheet | `client/src/inventory/doll.ts`, `bag-html.ts`, `sheet-html.ts` |
| Item card | `client/src/inventory/item-card.ts` |
| Drag, menu, keys | `client/src/inventory/drag.ts`, `item-menu.ts`, `bag-input.ts` |
| Risk line | `client/src/inventory/risk-line.ts` |
| Docking | `client/src/inventory/docking.ts`; `KitUi.fromBag` sells or offers |
| Shared grid keys (bag and loot) | `client/src/inventory/grid.ts` |
| Styles | `client/src/inventory/bag.css`, `item-card.css` |

Screenshots: `sanctum-bag`, `sanctum-bag-card`, `sanctum-bag-menu`,
`sanctum-bag-phone`, `sanctum-pile`, `woods-bag-risk`, `shore-shop-docked`.
A shot can give the player things with `carry`.

## A wish that adds a kind of thing

Wished items are data (`validateDefinition`); they need nothing from the bag.
Their card, compare lines, cell and menu come from the item's definition:
`slot` makes it wearable (Wear in the menu, compare lines, drag to its worn
slot), `heal` makes it drinkable, `teaches` a scroll, `bound` keeps it from
being dropped or traded. An item a scripted rule uses shows **Use**.
