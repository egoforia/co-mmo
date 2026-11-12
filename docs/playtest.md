# The robot playtester

Robot players play the real game before a change reaches `main`, so broken
play is caught in the pull request instead of by players. Nothing is paid
for: the server runs with fake AI (the offline God, a fake painter, no video
or sound), whatever keys are set.

```
npm run playtest
```

It takes about twelve minutes now there are six lands; walking every road is the longest part. Each `*.play.ts` file under
`packages/server/playtest/` starts its own server on a random port and runs
alongside the others.

## What it plays

| File | What the robots do |
| --- | --- |
| `world.play.ts` | Walk every road between every region, both ways, and check each region can be walked: people, roads, doors, creatures and the spawn point all in reach. Also lays out 60 wished lands and checks the same. |
| `journey.play.ts` | Play the first quests as a new player: Sister Amala, Old Bramble in the Woods, four mushrooms with their loot, Power Strike, then Marina's shop on the Shore. |
| `wishes.play.ts` | Pray, then wish for a thing to wear, a creature (and fight it), a person (and talk to them), a power (learn and cast it), a drop and a new land (and walk into it). A player without Favor is turned away. |
| `fashion.play.ts` | In Frostpeak a Falcon tailors a Windfelt hood, a tunic leaning toward Spirit and a cloak, wears the three for the full-style bonus, and buys boots from Ysolde. |
| `mods.play.ts` | The Owner switches a wished creature and a wished ring off and on again in God's View while another player watches, then undoes the creature for good. |
| `together.play.ts` | Two players see each other, chat, form a party, share a fight's XP and trade. |
| `crafting.play.ts` | A Cervid gathers sage with the sickle their people gave them and brews a tonic, fells an oak branch and trades it to a Scorpid, who digs copper with their own pick and smiths a pair of pliers. |
| `editor.play.ts` | In Chromium: a Steward opens the world editor, plants a tree and takes it back, lays a road with a house at its end and places monsters, while a robot in the same land is shown each change. |
| `floors.play.ts` | In Chromium: the Owner gives the Sanctum Arcanum a floor up and a cellar with the world editor's Floors tool, walks up the stairs and back down, is carried into the cellar (the land above hidden), and is still on floor 1 after a reload. |
| `workshop.play.ts` | In Chromium: the Owner makes a blank workshop land and builds the testbed's terrace bay on it from nothing with the in-game editor (three open terraces, each on the floor shown by the floor picker), checks they match the testbed's, picks the summit with Select and takes it away and back, lays a bookmark and goes to it. |
| `mini-map.play.ts` | In Chromium: the Owner gives the Sanctum Arcanum a floor up and a cellar; the mini map shows the ground floor, zooms in and out, looks at the floor above and the cellar without moving them, follows them upstairs, maximizes, minimizes (drawing nothing) and closes, and comes back with M or the Map button. |
| `sea-cave.play.ts` | In Chromium: a player stands in the Smugglers' Sea Cave's mouth, walks up the stairs to the Smugglers' Loft, and is carried to the Gallery, the Lookout, the Tide Grotto and the Drowned Hoard, each floor drawn on its own, then sees its walls stand up with their faces (shipped pictures stand in for the kit's). |
| `camera.play.ts` | In Chromium: a player sees the Sanctum Arcanum as a kit house through the isometric camera, walks east along the lane with two keys and stands inside its cutaway. |
| `browser.play.ts` | In Chromium: join by invite link, walk with the arrow keys, pray and grant a wish from its card, open the bag, open every God's View tab and the Art tab's Buildings page, and open the game on a phone-sized screen. Screenshots go to `playtest-results/`. |
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

## The network bench

```
npm run netbench
```

Robot players walk back and forth in the Sanctum through a pretend network
(`packages/server/netbench/lag-proxy.ts`: a proxy that adds delay, wobble and
a bandwidth limit, keeping bytes in order as TCP does) and the bench reports
what they felt, one scenario at a time, in about a minute and a half. It
fails only when robots get no snapshots: the numbers are for comparing a
change with `main`. Each run is also saved to `netbench-results/`.

| Column | What it means |
| --- | --- |
| snaps/s | Snapshots each robot received a second (20 is every tick). |
| KB/s each, host MB/s | Bytes on the wire, after any compression: to each robot, and out of the game server in all. |
| gap p50/p95 | Time between snapshots arriving: half are under the first, 1 in 20 over the second. |
| step answered p50/p95/end | From sending a step until a snapshot says the server took it; `end` is the last steps only, so it shows lag that grows. |
| others wobble % | How unevenly other players move on a robot's screen, drawn by the same smoothing as the browser (`netbench/remote-motion.ts`): the spread of their speed as a share of walking speed. Turning is left out. Around 2% is the bench's own noise. |
| (server) | The same wobble in the server's own positions, tick to tick, before any network or drawing: when it is as high as the first number, the stutter started on the server (a robot's steps arriving bunched, two taken in one tick), not on the way. |
| stalls %, leaps % | Frames where a walking player stood still, or moved over twice their speed. |
| tick ms | How long a tick of their region took. |
| skipped/s | Snapshots the game server skipped a second for each robot because its line had fallen behind. |
| cpu % | Processor time the whole bench used (game server, robots and proxies together), as a share of one core. |

Scenarios: 10 players on the same machine, on home Wi-Fi (20 ms, up to 40 ms
of wobble) and on mobile (50 ms, up to 120 ms); 40 and 60 players on Wi-Fi; one
player on a weak 3 KB/s link among 20; and 10 players with their region on a
region server 20 ms from the game server (and 40 the same way). A second
bench, `crossing.net.ts`, walks one player back and forth over the road
between two regions on two region servers 20 ms away and reports how long
each crossing went without a snapshot and whether a step was lost
(`NETBENCH_ONLY=crossing`). `NETBENCH_SECONDS` sets how long
each one runs (10 by default), `NETBENCH_ONLY=wi-fi` runs only the scenarios
whose names hold those words, and the game's network switches in `.env`
(`NET_COMPRESS=off`, `NET_SKIP_STALE=off`, `NET_SEE_ACROSS=off`,
`NET_FAST_PATH=off`, `NET_FAR_LESS=off`) apply, to compare.

The performance overlay (F3) shows the same from a real browser: under
Network, how far apart snapshots arrive.
