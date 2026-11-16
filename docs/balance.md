# Balance on tiles

The balance test (`packages/server/src/balance.ts`, `npm run balance`;
docs/combat.md step 7) fights real fights in a real land on tiles, so reach,
line of sight, crowds about a player, flanking and free swings all count.
Each Calling at a level has its main weapon and every free point in its
primary (no people's lift, no other gear). It fights creatures of its level
made the way land creatures are (`lands.ts` `levelledCreature`). It stands
still, strikes whenever it can and uses its damage skills as they come
ready. Fighters who shoot start 5 tiles off; the rest start 2 off.
`packages/server/test/balance.test.ts` keeps the floors: everyone beats one
creature of their level, two beat a tough one, a Warden ends hurt less than a
Duelist.

"Damage/s" counts from the first blow. "One volley" means the fight was over
before it was worth a rate.

## Findings (2026-11-16, before any balance pass)

1. **Shooters out-damage the Duelist by far.** At level 10 the Ranger deals
   59 a second and the Wishweaver 46, against the Duelist's 29; at level 20
   the Wishweaver deals 90 against 42. The Callings plan wanted the three
   damage Callings within 15% of each other. Shooters also lose much less
   health, since the creature has to walk up to them.
2. **Three creatures of your level kill anyone from level 10 on.** On tiles
   all three reach you at once. The Duelist falls in under 3 seconds and even
   the Warden in 12. At level 1 everyone but the Bellkeeper wins.
3. **The Duelist is fragile.** Alone against one creature of its level it
   loses 42% of its health at level 10 and 61% at level 20.
4. **Support damage is about where planned.** The Bellkeeper deals 42 to 50%
   of the Duelist's damage, inside the planned 30 to 50%. The Warden deals 49
   to 73%, above the plan.

## Results

### Level 1, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 2.5 | 13% | 10.2 |
| Duelist | yes | 1.6 | 16% | 13.9 |
| Ranger | yes | 0.1 | 0% | one volley |
| Wishweaver | yes | 0.1 | 0% | one volley |
| Bellkeeper | yes | 4.5 | 20% | 6.9 |

### Level 10, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 6.0 | 20% | 17.8 |
| Duelist | yes | 3.5 | 42% | 29.3 |
| Ranger | yes | 1.8 | 18% | 59.4 |
| Wishweaver | yes | 2.3 | 18% | 46.2 |
| Bellkeeper | yes | 8.8 | 40% | 13.4 |

### Level 20, alone against one creature

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 9.7 | 22% | 20.5 |
| Duelist | yes | 4.6 | 61% | 42.2 |
| Ranger | yes | 4.0 | 38% | 47.9 |
| Wishweaver | yes | 2.1 | 20% | 90.2 |
| Bellkeeper | yes | 12.2 | 56% | 17.6 |

### Level 1, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 8.4 | 0% | 8.4 |
| Duelist | yes | 5.5 | 0% | 12.4 |
| Ranger | yes | 4.8 | 0% | 14.4 |
| Wishweaver | yes | 4.5 | 0% | 15.5 |
| Bellkeeper | no | 6.7 | 100% | 7.9 |

### Level 10, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | no | 11.9 | 100% | 16.2 |
| Duelist | no | 2.6 | 100% | 29.4 |
| Ranger | no | 4.3 | 100% | 38.2 |
| Wishweaver | no | 4.3 | 100% | 40.7 |
| Bellkeeper | no | 5.4 | 100% | 13.5 |

### Level 20, alone against three

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | no | 13.2 | 100% | 19.9 |
| Duelist | no | 2.6 | 100% | 43.4 |
| Ranger | no | 3.0 | 100% | 45.6 |
| Wishweaver | no | 4.0 | 100% | 59.7 |
| Bellkeeper | no | 5.4 | 100% | 17.0 |

### Level 1, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 2.5 | 6% | 20.4 |
| Duelist | yes | 1.6 | 8% | 27.9 |
| Ranger | yes | 0.1 | 0% | one volley |
| Wishweaver | yes | 0.1 | 0% | one volley |
| Bellkeeper | yes | 4.5 | 13% | 13.7 |

### Level 10, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 6.0 | 9% | 35.6 |
| Duelist | yes | 3.5 | 22% | 58.6 |
| Ranger | yes | 2.6 | 8% | 80.0 |
| Wishweaver | yes | 2.3 | 8% | 92.4 |
| Bellkeeper | yes | 8.8 | 28% | 26.8 |

### Level 20, two of the Calling against one tough creature (twice the health)

| Calling | Won | Seconds | Health lost | Damage/s |
| --- | --- | --- | --- | --- |
| Warden | yes | 8.4 | 10% | 47.0 |
| Duelist | yes | 4.6 | 30% | 84.3 |
| Ranger | yes | 4.0 | 31% | 95.8 |
| Wishweaver | yes | 2.3 | 10% | 172.4 |
| Bellkeeper | yes | 12.2 | 36% | 35.1 |

