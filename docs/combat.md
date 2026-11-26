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
| Facing | You turn as a step begins, to the way of that step, and keep facing it until you stand on the next tile; a new way pressed mid-step waits for the tile (`tiles/facing.ts`). Standing, pressing a way turns you (towards someone, that is all it does). |
| Melee reach | Only the touching tile you face, of the 8 (egoforia, 2026-11-24); spears, greatswords and censers also the tile behind it, straight ahead. Melee skills that strike one foe (`strike`) follow the same rule. A trained greatsword's second foe must be ahead too; a censer's splash still falls round its target. |
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

## Seeing a strike land

The server settles every move and strike the moment it happens. The browser
draws others a little in the past (`SnapshotClock`), so they walk smoothly
however unevenly snapshots arrive, while our own player is predicted in the
present. Two things keep a fight looking the way it is decided:

- **Monsters beside us are drawn on the present.** Snapshots name the tile
  each creature is stepping onto (`CreatureState.to`). Within three tiles of
  our player a creature is carried on along that step to the server's present
  (`Interpolator.ahead`), never past the step's end, blending into the smooth
  past by seven tiles (`client/src/world-scene/near-present.ts`). A monster
  strikes from the tile it is seen on, and we bump into it where it is seen.
- **A strike shows when its striker is seen to strike.** A blow, a bolt or a
  skill's burst from someone drawn in the past is held back until they are
  drawn at that moment, at most a quarter second; our own strikes show at
  once. A bolt shows its number, flash and sound when it arrives, not when it
  leaves, and the health a strike on us takes comes off the health shown as
  it lands (`client/src/world-scene/hit-timing.ts`).

## Holding Space

Holding Space keeps striking at the pace the server allows, timed by the
browser's own clock (`client/src/held-strike.ts`), not by the keyboard's
repeat, which starts after about half a second and then comes unevenly. A
press within 150 ms of the next swing being ready still counts: it swings the
moment the cooldown ends, as fighting games keep a press.

A home or mobile line delivers messages unevenly, so a swing sent as the
last one ended can reach the server a few milliseconds early. The server used
to drop it, which lost a third of held swings on Wi-Fi after the browser had
already shown them. Now an attack or skill up to 150 ms early is kept and
done the moment it is ready, by a timer, or by the next tick if that comes
first (`server/src/region/held-actions.ts`). A kept attack counts its
cooldown from when it was ready, so a held key keeps the Calling's full pace.
Anything earlier is still dropped, so nothing ever strikes faster than its
cooldown.

## Readying a skill for Space

Ctrl or Shift with a hotbar number (or a Ctrl- or Shift-click on its button)
readies that skill instead of using it (`client/src/readied-skill.ts`). Its
button is ringed, and nothing is sent. The next Space casts it in place of a
strike; after that one cast Space strikes again. The same key again, or Esc,
puts it down; another key swaps it. Shift always works, Ctrl where the browser
lets a page have Ctrl with a number.

- A tap casts only the skill. Held on past 250 ms (`HELD_AFTER_CAST_MS`),
  Space carries on striking at the Calling's pace.
- Held while the skill still rests, Space waits and casts it the moment it is
  ready; it never swaps it for a strike. A tap within 150 ms of it being ready
  is kept, the same window as strikes (the server keeps it too, see above). A
  tap earlier than that casts nothing and says how long is left.
- Not enough Energy: the skill stays readied and the game says so.
- Falling, or opening the editor, puts it down. A skill the server refuses
  (out of range, no target) is not readied again: the server's notice says why.
- Plain number keys now also get the 150 ms window, so a skill pressed just
  before it is ready is sent instead of dropped.

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

## PvP version 1 (combat decisions, step 5)

| Topic | Rule |
| --- | --- |
| Safe areas | `safe-areas.ts`: the whole Sanctum, and `SAFE_RADIUS` (8) tiles round the square where each land's travellers arrive. The world editor's **Safe area** tool (Places) lays more, or takes them away with reach 0, as land data (`RegionMap.safe`). No player is hurt in one, and monsters give up a chase when their prey steps in. Stepping in or out says so. |
| Fighting | Out of safe areas any player may hurt another with the same attacks, reach, Armor, Ward, dodge and shields as against a monster (`region/pvp.ts`). A plain attack hits a player only when they are the chosen target. Strike and bolt skills aimed at a player hit them. Area, cone and line skills hit every rival they cover, bystanders included. Statuses from skills stay for monsters in this version. |
| Parties | Party members cannot hurt each other. To attack one, leave the party first; the party is told at once. |
| Being attacked | The one attacked is told who attacks them (once every 15 s per attacker). A player struck down falls as usual, and step 3's death rules apply in full. |
| Not in it | Morality, warnings for attacking first, and bounties. |

## Breaking off (combat decisions, step 6)

| Topic | Rule |
| --- | --- |
| Ways | Each monster breaks off a chase its own way (`breakOffOf`, `creature-brain.ts`). **Timed**: gives up after `CHASE_SECONDS` (20) of chasing, each second counting for more the farther it is from home. **Lost**: led more than `LOST_DISTANCE` (16) tiles from home, it forgets the fight and makes its home where it stands; it comes back at its old home when it falls. **Edge**: chases to the edge of its reach (`LEASH`, 8 tiles), keeps watch there striking whoever comes close, and gives up once they are well beyond. |
| Who picks | Each behaviour has a fitting way (`BEHAVIOR_BREAK_OFF`: wanderers get lost, guards and patrols hold the edge, chasers, packs and the timid tire). A wish's creature may name one (`breakOff`), and the world editor's **Monsters** and **Change monsters** tools set it for the monsters they place or change. |
| Calm | Having broken off, it notices no one for `CALM_MS` (8 s), so it does not turn straight back. A blow still provokes it. |
| Healing | Every monster heals at its own rate (`regenOf`: `regen` per second, 1% of its health when not given), in a fight or out of it. Getting home no longer heals it fully at once. |
| Safe areas | No monster takes a step into a safe area: it stops at the edge. |

## Monsters with gear and skills (combat decisions, step 7)

| Topic | Rule |
| --- | --- |
| Loot at spawn | A monster's loot is rolled when it appears, not when it falls (`rollKit`, `monster-gear.ts`), from its kind's table (God's View and loot wishes) plus its spawn's own extras from the world editor. Each piece of gear is its own found copy. Its body holds exactly what it carried. It comes back with a new roll each time, from dice of its own (`kitDice`), so loot never shifts how fights roll. |
| Worn gear | The first piece for each slot is worn and adds power: a weapon's damage to its blows and physical skills (`damageOf`), armour and ward to its Armor and Ward (`defenceOf`). |
| In hand | Its weapon (else its charm) shows in its right hand and an off-hand item in its left, where the Art tab's hand finder found its hands in the picture it already has. Monsters that may carry such gear are looked at; none is painted again. Unfound hands mean the gear is unseen but still counts. |
| Skills | Tougher kinds have one or two skills (`MONSTER_SKILLS`, `monster-skills.ts`), each one of the players' sixteen effects with plain numbers. A wished monster brings up to four (`skills`), each hitting at most twice its plain blow. On each attack beat a ready skill that reaches goes before its plain blow; one with nothing to do (a heal with no one hurt) is not spent. The one targeted is told "The X uses Y!". |
| What each does | Strike, bolt (arcane unless said), area, cone and line hurt; dash leaps beside the target and strikes; blink steps away; trap roots and hurts; debuff puts a harmful status on; heal mends the most hurt monster near it; shield, stance (takes up to 60% less) and buff (more on each blow) go on itself; taunt calls every idle monster near it, summon its own kind from farther; cleanse shakes off its harmful statuses. No skill reaches into a safe area. |
| Not in it | Weapon traits stay data only. |
