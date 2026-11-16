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
4. Reach, line of sight and tile shapes for skills and weapons; God's View Combat page.
5. Tactics: flanking, free swings on leaving, monster tactics; editor snapping.
6. Balance test and a balance pass.
