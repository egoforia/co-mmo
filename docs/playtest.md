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
| `browser.play.ts` | In Chromium: join by invite link, walk with the arrow keys, pray and grant a wish from its card, open the bag, open every God's View tab, and open the game on a phone-sized screen. Screenshots go to `playtest-results/`. |

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

## In CI

The proposed `playtest` job for `.github/workflows/ci.yml`:

```yaml
  playtest:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run playtest -- --reporter=default --reporter=github-actions
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playtest-screenshots
          path: playtest-results/
          if-no-files-found: ignore
```

In a cloud session Chromium is already installed; do not run
`playwright install` there.
