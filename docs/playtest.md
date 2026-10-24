# The robot playtester

Robot players play the real game before a change reaches `main`, so broken
play is caught in the pull request instead of by players. Nothing is paid
for: the server runs with fake AI (the offline God, a fake painter, no video
or sound), whatever keys are set.

```
npm run playtest
```

It takes about six minutes since the lands grew. Each `*.play.ts` file under
`packages/server/playtest/` starts its own server on a random port and runs
alongside the others.

## What it plays

| File | What the robots do |
| --- | --- |
| `world.play.ts` | Walk every road between every region, both ways, and check each region can be walked: people, roads, doors, creatures and the spawn point all in reach. Also lays out 60 wished lands and checks the same. |
| `journey.play.ts` | Play the first quests as a new player: Sister Amala, Old Bramble in the Woods, four mushrooms with their loot, Power Strike, then Marina's shop on the Shore. |
| `wishes.play.ts` | Pray, then wish for a thing to wear, a creature (and fight it), a person (and talk to them), a power (learn and cast it), a drop and a new land (and walk into it). A player without Favor is turned away. |
| `mods.play.ts` | The Owner switches a wished creature and a wished ring off and on again in God's View while another player watches, then undoes the creature for good. |
| `together.play.ts` | Two players see each other, chat, form a party, share a fight's XP and trade. |
| `editor.play.ts` | In Chromium: a Steward opens the world editor, plants a tree and takes it back, lays a road with a house at its end and places monsters, while a robot in the same land is shown each change. |
| `floors.play.ts` | In Chromium: the Owner gives the Sanctum Arcanum a floor up and a cellar with the world editor's Floors tool, walks up the stairs and back down, is carried into the cellar (the land above hidden), and is still on floor 1 after a reload. |
| `mini-map.play.ts` | In Chromium: the Owner gives the Sanctum Arcanum a floor up and a cellar; the mini map shows the ground floor, zooms in and out, looks at the floor above and the cellar without moving them, follows them upstairs, maximizes, minimizes (drawing nothing) and closes, and comes back with M or the Map button. |
| `sea-cave.play.ts` | In Chromium: a player stands in the Smugglers' Sea Cave's mouth, walks up the stairs to the Smugglers' Loft, and is carried to the Gallery, the Lookout, the Tide Grotto and the Drowned Hoard, each floor drawn on its own, then sees its walls stand up with their faces (shipped pictures stand in for the kit's). |
| `camera.play.ts` | In Chromium: a player sees the Sanctum Arcanum as a kit house through the isometric camera, walks east along the lane with two keys and stands inside its cutaway. |
| `browser.play.ts` | In Chromium: join by invite link, walk with the arrow keys, pray and grant a wish from its card, open the bag, open every God's View tab, and open the game on a phone-sized screen. Screenshots go to `playtest-results/`. |
| `perf.play.ts` | In Chromium: a Steward shows the performance overlay with F3 and sees frames, a ping and the server running their region; it stays on across a reload and hides from Account. A player's F3 shows nothing. |

A run fails when a robot notes a problem (it could not walk somewhere, a
message never came, the server sent an error, a body kept its loot), when
the server logs an error, or when the browser page throws, logs an error or
gets an error answer.

## Adding a playtest

Write a new `packages/server/playtest/<name>.play.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { playWorld } from './harness.ts';

describe('the robot fishes', () => {
  it('casts a line at the Sanctum pond', async () => {
    const world = await playWorld();
    const bot = await world.bot('Angler', { region: 'sanctum', character: { favor: 20 } });
    // walkTo, travelTo, cross, hunt, fight, lootNearest, talkTo, pray, wish,
    // ask (send a message and wait for its answer), waitFor, tick...
    expect(world.problems()).toEqual([]);
  });
});
```

`Bot` (`bot.ts`) speaks the same messages as the client, predicts its own
steps the way the client does, and finds its way with `paths.ts`. Use
`expect.soft` for each thing you check so one run lists every problem, and
end with `expect(world.problems()).toEqual([])`. `checks.ts` holds checks on
what a robot sees (`unreachable`).

A wish may add a playtest file, but the harness, the bot and the test
settings are core files for the wish guard.

## On a pull request

Put the **playtest** label on a pull request to have it played
(`.github/workflows/playtest.yml`). It plays again on every push while the
label stays; take the label off to stop. The screenshots are kept with the
run as `playtest-screenshots`.

In a cloud session Chromium is already installed; do not run
`playwright install` there.
