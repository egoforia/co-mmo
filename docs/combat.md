# Combat on tiles

Decided with egoforia on 2026-11-16 (thread "Rework the game's combat"; the
shared doc "How combat works today" lists today's rules and gaps).

Everything that moves (players, monsters, NPCs, helpers) stands on tiles and
moves one tile at a time, in real time: everyone steps at once and each step
takes `1 / speed` seconds (diagonals 1.4 times as long). Where you stand
becomes the strategy: a doorway lets one monster at you, a Warden on the
tile in front of a healer really guards them.

## Rules

| Topic | Rule |
| --- | --- |
| Steps | 8 ways. A diagonal step needs both straight ways round the corner open (no slipping between two trees touching at a corner, or past a wall's end). |
| Sizes | Tiny, small and medium bodies take 1 tile; high monsters 2×2; colossal 3×3 (`SIZE_TILES`). |
| One per tile | A body claims the tile it steps onto as the step starts (`TileClaims`); first to ask wins. Players block players; party members may swap places. |
| Walking into someone | Pressing towards a tile someone stands on takes no step: you stay put and turn to face them. Only the land (a wall at a diagonal) slides a step aside. |
| Melee reach | The 8 touching tiles; spears and greatswords 2 tiles in a straight line. |
| Ranged reach | Counted in tiles, with a clear line. Whether bodies block shots is a setting on God's View's Combat page. |
| Skill shapes | Areas are squares of tiles, cones wedges, lines rows; shown before they hit. |
| Flanking | A monster hit while a player stands on the opposite tile takes +15%. |
| Leaving a fight | Stepping away from an adjacent monster gives it one free swing, unless you blink or it is Stunned. |
| World editor | Spawns, NPCs and prefabs snap to tiles. |

## Build steps

1. Shared tile rules (`packages/shared/src/tiles/`): grid, steps, claims, routes, strides. (Built.)
2. Players move on tiles: server, browser prediction, smooth tile-to-tile drawing. Players block players except their party. (Built.)
3. Monsters and NPCs move on tiles (`packages/server/src/walkers.ts`): whole steps, squares as wide as their size, a short route search round walls and crowds that they keep to, and a step begun is always finished. A monster strikes from any tile touching its square, and closes on the nearest free one, so a crowd fans out round a player and only eight player-sized monsters reach them at once. A body holds every tile its square reaches into, plus the square it steps onto. (Built.)
4. Reach and line of sight in tiles (`packages/shared/src/tiles/sight.ts`, `region/combat.ts`): a reach under 2 is the eight touching tiles, past that whole tiles; spears, greatswords and censers reach their second tile only in a straight line; shots and powers past the touching tiles need a clear line (trees, rocks, walls and walls on tile sides stop them, water does not; past a corner one open side is enough). Areas are squares of tiles about their middle. God's View's Combat page (Owner) holds the rules that are the Owner's choice (`combat-rules.ts`): "Bodies block arrows and spells", off by default. (Built.)
5. Tactics (`packages/shared/src/tiles/tactics.ts`): a monster struck by a player beside it while another player stands across it (side to side or corner to corner) takes `FLANK_BONUS` (+15%); stepping from a tile beside a monster fighting you to one out of its reach gives it a free swing (not when it is Stunned; a blink is no step); a pack member closing in heads for the tile across the prey from a packmate already there. People, the arrival point and wished things stand on tile middles (editor spawns already did). (Built.)
6. Skill shapes on tiles (`packages/shared/src/tiles/shapes.ts`): a line is the row of tiles straight ahead, a cone the wedge ahead (as wide as it is far; corner-wise, the quarter between), an area the square about its middle; trees, rocks and walls cut a cone or line short. A creature is hit when any tile of its square is covered. Pointing at a skill's key in the hotbar shows its tiles to the caster; as it lands everyone near sees them for a moment. Each tile shows the painted tile marker (`TILE_MARKER_ART`, the Owner's choice on 2026-11-16 over a code-drawn highlight); until it is painted nothing shows. (Built.)
7. A balance test (`packages/server/src/balance.ts`, `npm run balance`, findings in `docs/balance.md`). (Built.) Balance pass done: the damage Callings are within 15% of each other in steady damage, the Duelist's Momentum turns blows aside, and crowds stay deadly; the balance workflow checks it on pull requests.

## Bag and gold (combat decisions, step 1)

Decided with egoforia on 2026-11-17 (doc "Combat decisions: the five whys").

| Topic | Rule |
| --- | --- |
| Bag size | 20 stacks (`BAG_SLOTS`, shared `rpg/bag.ts`). The Bible takes one. Other things stack up to 99 a slot. |
| Gold | Coins in the bag (`gold` item, kind `coins`), all in one slot however many. `goldOf`, `addGold`, `takeGold` read and change them; nothing keeps gold as a number any more. |
| Older saves | Gold saved as a number moves into the bag as coins the first time the character loads (`upgradeCharacter`), even past 20 slots. The `characters.gold` column counts both until then. |
| Monster gold | Lies on the body with the rest of the loot, for whoever takes it first. |
| A full bag | Looting takes what fits and leaves the rest on the body. Gathering, crafting, buying, selling, taking gear off, trades, quest rewards, scripted rules (`game.give`, `game.gold`) and God's View changes are refused until there is room. Buying may use the slot the last coins free; selling may use the slot the sold stack frees. |
| Never lost | Gear coming off when its wish is switched off, a people's first tools, and quest rewards checked beforehand go in even past 20. |

## Gear history and binding (combat decisions, step 2)

| Topic | Rule |
| --- | --- |
| Every piece is its own | Each piece of gear is a copy with its own id (`copies.ts`), not a stack of a plain item id. Gear found, looted, bought, given by God's View or rules, or handed over as a quest reward becomes a copy with a world maker (`w`, shown "Tailored by unknown"); crafted gear keeps its maker. Older saves turn their gear into copies once, in `upgradeCharacter`. |
| Owners | Each time a piece changes hands the server writes a row in the `gear_owners` table (piece, name, how, when). How is one of crafted, bought, looted, given (trades) or found (quest rewards). History is kept by `pieceKey`, so binding or unbinding a piece keeps its history. |
| Seeing it | The client asks with `{t:'history'}` for the pieces it holds (at most 40 at once) and shows "Owners: made by Mara (17 Nov), given to Tam (…)." on bag and worn item cards. |
| Unbinding | `unbindCopy` turns a bound piece (`b`) into an unbound one (`u`): it reads "No longer bound." and does not bind again when worn. Step 3 (death) uses it for pieces that drop. |
| Switched-off wishes | A copy whose base item sleeps sleeps with it and wakes when the wish is switched on again. |

## Death (combat decisions, step 3)

| Topic | Rule |
| --- | --- |
| When it costs | Only when a Fallen player wakes at the shrine (on their own or with the button). Being raised by a friend costs nothing (`region/deaths.ts`). |
| XP | A quarter of the XP to the next level (`deathXp`). Below 0 they drop a level, never below 1 (`loseXp`). |
| A level lost | The Calling's pair comes off, then an unplaced point, or else the point placed last (`Character.placed` records where each point went; `levelDownStats`). Points placed before the record was kept come off the Calling's first attribute. Skills already learned stay. |
| Drops (`rollDeathDrops`) | All the gold carried. Each worn piece with a 15% chance. With another 15% chance the bag, with everything in it. The Bible and sleeping wish items never drop; bound gear that drops comes off unbound. |
| The body | What drops lies on a player's body where they fell, drawn as the player, for an hour (`PLAYER_BODY_MS`), or until it is empty. Anyone may take from it, and the one who fell hears who took what, wherever they are. |
| Restarts | Player bodies are saved in the `player_bodies` table as they change and laid back in their regions at start (`World.restoreBodies`). Region servers send the changes through the region link. |

## Quitting mid-fight (combat decisions, step 3)

A player who closes the game while a fight is on stays in the world until nothing has hurt them for 15 seconds (`QUIT_FIGHT_MS`) and no creature is after them. A Fallen player counts as in a fight. Monsters keep attacking them, and if they fall they pay the price of death and wake at the shrine next time they play. Coming back before the fight is over takes up where they stand. Once it is over, the region sends a `quit` departure, and the world saves where they ended up (`World.onQuit`). On region servers the `remove` command carries `quit`, and the answer says `staying`.

## Healing and XP (combat decisions, step 4)

| Topic | Rule |
| --- | --- |
| Tonic prices | Healing items in shops cost 5 times what they did (Tonic 8 → 40 gold; Pilgrim Bread too). There is still no cooldown. |
| Use cap | The server takes at most one item use every `ITEM_USE_MS` (500 ms, two a second), so a macro drinks no faster than a hand. |
| Healing others | With another player chosen as target, clicking a healing item gives it to them if they are within `ITEM_REACH` tiles on the same floor. It cannot help someone who has fallen. Healing skills already reach others. |
| Level curve | `xpToNext(L) = 20 × L^1.5 × 2^((L−1)/5)`: it doubles every 5 levels, about 2,200 XP for level 10 and 25,000 for 20. `npm run balance` ends with a "Time per level" table. |
| Wished monsters | Health, damage, XP and gold come from the land formula (`levelStats` in `creature-tune.ts`), the same as land monsters. |
