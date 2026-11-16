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
