# Balance on tiles

The balance test (`packages/server/src/balance.ts`, `npm run balance`;
docs/combat.md step 7) fights real fights in a real land on tiles, so reach,
line of sight, crowds about a player, flanking and free swings all count.
Each Calling at a level has its main weapon and every free point in its
primary (no people's lift, no other gear). It fights creatures of its level
made the way land creatures are (`lands.ts` `levelledCreature`). It stands
still, strikes whenever it can and uses its damage skills as they come
ready. Fighters who shoot start 5 tiles off; the rest start 2 off.

There are four scenes: alone against one creature, alone against three, two
against one tough creature (twice the health), and alone against a training
post with ten times the health that never hurts. The training post gives the
**steady damage**: a fight of half a minute or more, so the opening volley and
the last overkill blow don't sway the rate the way they do in a 3-second fight.

"Damage/s" counts from the first blow. "One volley" means the fight was over
before it was worth a rate.

## What the test holds

`balanceProblems` (and `packages/server/test/balance.test.ts`) keep:

- the damage Callings (Duelist, Ranger, Wishweaver) within 15% of each
  other in steady damage at levels 10 and 20;
- a crowd of three creatures of your level deadly to every Calling at
  levels 10 and 20;
- everyone beating one creature of their level, and two beating a tough one;
- a Warden ending a fight hurt less than a Duelist.

`npm run balance -- --check` prints whether the balance holds and fails
when it does not. The balance workflow runs it on pull requests that change
fight numbers and puts the tables in the run's summary.

## Balance pass (2026-11-16, the Owner's choice "Even out damage callings")

| Skill | Before | After |
| --- | --- | --- |
| Ranger Aimed Shot | 5 + Agility × 1.2 | 4 + Agility × 0.85 |
| Ranger Volley | 6 + Agility × 1.5 | 4 + Agility × 1.05 |
| Wishweaver Ember Bolt | 4 + Wit × 1.4, every 2.5 s | 3 + Wit × 0.65, every 4 s |
| Wishweaver Tide Lash | 3 + Wit × 1.0 | 2 + Wit × 0.7 |
| Wishweaver Chain Spark | 5 + Wit × 1.3 | 4 + Wit × 0.9 |
| Duelist Lunge | 4 + Might × 1.0 | 4 + Might × 1.2 |
| Duelist Whirl | 3 + Might × 0.6 | 3 + Might × 0.8 |
| Duelist Momentum | none | each pip turns aside 5% of a creature's blow |

Steady damage, damage Callings:

| Level | Before (Duelist / Ranger / Wishweaver) | After |
| --- | --- | --- |
| 10 | 31.7 / 31.6 / 44.0 (39% apart) | 30.9 / 29.8 / 31.5 (6% apart) |
| 20 | 42.5 / 41.2 / 61.4 (49% apart) | 43.8 / 41.1 / 44.0 (7% apart) |

The Duelist alone against one creature now loses 38% of its health at level
10 (was 42%) and 51% at level 20 (was 61%). Crowds of three still kill every
Calling at levels 10 and 20.

Still to know: in a short fight the shooters still open harder, because their
first shots land while the creature walks up. At level 20, alone against one
creature, the Wishweaver deals 58 a second against the Duelist's 42. Level 1
fights are over in a volley or two, so they are read, not held.

## Findings before the pass

1. **Shooters out-damage the Duelist by far.** At level 10 the Ranger dealt
   59 a second and the Wishweaver 46, against the Duelist's 29; at level 20
   the Wishweaver dealt 90 against 42.
2. **Three creatures of your level kill anyone from level 10 on.** On tiles
   all three reach you at once. The Owner chose to keep it that way.
3. **The Duelist is fragile.** Alone against one creature of its level it
   lost 42% of its health at level 10 and 61% at level 20.
4. **Support damage is about where planned.** The Bellkeeper deals 42 to 50%
   of the Duelist's damage, inside the planned 30 to 50%. The Warden deals 49
   to 73%, above the plan.

## Results (after the pass)

### Level 1, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 2.5 | 13% | 10.2 |
| Duelist | yes | 1.6 | 15% | 13.9 |
| Ranger | yes | 1.0 | 0% | 23.0 |
| Wishweaver | yes | 1.1 | 0% | 20.0 |
| Bellkeeper | yes | 4.5 | 20% | 6.9 |

### Level 10, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 6.0 | 20% | 17.8 |
| Duelist | yes | 3.5 | 38% | 29.3 |
| Ranger | yes | 2.6 | 36% | 40.0 |
| Wishweaver | yes | 3.0 | 35% | 34.7 |
| Bellkeeper | yes | 8.8 | 40% | 13.4 |

### Level 20, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 9.7 | 22% | 20.5 |
| Duelist | yes | 4.6 | 51% | 42.2 |
| Ranger | yes | 4.0 | 38% | 47.9 |
| Wishweaver | yes | 3.4 | 40% | 57.9 |
| Bellkeeper | yes | 12.2 | 56% | 17.6 |

### Level 1, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 8.4 | 0% | 8.4 |
| Duelist | yes | 5.5 | 0% | 12.4 |
| Ranger | yes | 4.8 | 0% | 14.4 |
| Wishweaver | yes | 5.5 | 0% | 12.4 |
| Bellkeeper | no | 6.7 | 100% | 7.9 |

### Level 10, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | no | 11.9 | 100% | 16.2 |
| Duelist | no | 2.6 | 100% | 30.6 |
| Ranger | no | 4.3 | 100% | 36.1 |
| Wishweaver | no | 4.0 | 100% | 36.5 |
| Bellkeeper | no | 5.4 | 100% | 13.5 |

### Level 20, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | no | 13.2 | 100% | 19.9 |
| Duelist | no | 2.6 | 100% | 44.5 |
| Ranger | no | 3.0 | 100% | 43.9 |
| Wishweaver | no | 3.0 | 100% | 45.2 |
| Bellkeeper | no | 5.4 | 100% | 17.0 |

### Level 1, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 2.5 | 6% | 20.4 |
| Duelist | yes | 0.8 | 3% | 54.1 |
| Ranger | yes | 1.0 | 0% | 46.0 |
| Wishweaver | yes | 1.1 | 0% | 40.0 |
| Bellkeeper | yes | 4.5 | 13% | 13.7 |

### Level 10, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 6.0 | 9% | 35.6 |
| Duelist | yes | 2.9 | 19% | 73.0 |
| Ranger | yes | 3.5 | 17% | 60.3 |
| Wishweaver | yes | 3.4 | 17% | 62.1 |
| Bellkeeper | yes | 8.8 | 28% | 26.8 |

### Level 20, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 8.4 | 10% | 47.0 |
| Duelist | yes | 4.6 | 25% | 84.3 |
| Ranger | yes | 4.0 | 31% | 95.8 |
| Wishweaver | yes | 3.4 | 20% | 115.8 |
| Bellkeeper | yes | 12.2 | 36% | 35.1 |

### Level 1, alone against a training post that never hurts (ten times the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 23.9 | 0% | 9.7 |
| Duelist | yes | 16.9 | 0% | 13.6 |
| Ranger | yes | 19.1 | 0% | 12.1 |
| Wishweaver | yes | 19.9 | 0% | 11.6 |
| Bellkeeper | yes | 34.1 | 0% | 7.0 |

### Level 10, alone against a training post that never hurts (ten times the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 59.3 | 0% | 17.6 |
| Duelist | yes | 33.6 | 0% | 30.9 |
| Ranger | yes | 34.9 | 0% | 29.8 |
| Wishweaver | yes | 33.0 | 0% | 31.5 |
| Bellkeeper | yes | 77.0 | 0% | 13.7 |

### Level 20, alone against a training post that never hurts (ten times the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 96.0 | 0% | 20.2 |
| Duelist | yes | 44.3 | 0% | 43.8 |
| Ranger | yes | 47.3 | 0% | 41.1 |
| Wishweaver | yes | 44.0 | 0% | 44.0 |
| Bellkeeper | yes | 114.5 | 0% | 17.1 |
