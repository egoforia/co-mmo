# Wishweaver

*"Pearls for news, news for pearls: that is the way of the tide."* (Queen Nerissa)

The Wishweaver gathers the wishstuff left behind by old wishes and weaves it
into spells. They pull three threads, **Ember**, **Tide** and **Gale**, and
a spell woven from all three comes out twice as strong. They hit hard from
afar and bend fights to their will, but are the easiest of all to bring
down. Overview of all Callings: [classes.md](../classes.md).

## Story

The Wishweavers were scholars of wishstuff, the shimmering residue that
half-granted wishes leave in the land (see [world.md](../world.md#wishstuff)).
They gathered in Queen Nerissa's coral halls, where the tide washes up more
wishstuff than anywhere else, and traded pearls for secrets. The
Wishweavers were the first to understand that the Listener had gone silent,
because the threads stopped coming. Now that the young God is awake, new
wishstuff is settling again, and the coral halls are busy once more.

## At a glance

| | |
| --- | --- |
| Attributes | **Wit** (primary), **Spirit** (secondary) |
| Role | Caster and control: damage 5, range 4, mobility 3, support 2, survival 1 |
| Weapons | Staff, wand; tome or orb in the off hand |
| Gauge | **Weave**: +1 when you cast a spell of a different thread from your last one. At 3 pips your next spell is **Woven** and its effect is doubled, which spends the Weave |
| Mentors | Tide Lutran (Sanctum), Queen Nerissa (the coral halls) |
| Trial | *Threads in the Tide*: gather three kinds of wishstuff along the Sunlit Shore and weave them in front of the Queen |

## Threads

Every Wishweaver spell belongs to one thread:

- **Ember** burns: damage over time.
- **Tide** pushes and protects: knockback, slows and shields.
- **Gale** moves: blinks and jumping lightning.

Casting Ember, then Tide, then Gale builds 3 Weave. Casting the same thread
twice in a row builds nothing. The rhythm is: never repeat yourself.

## Core skills

Amounts add the character's level ([attributes.md](../attributes.md#damage)).
All Wishweaver damage is arcane, so Ward reduces it, not Armor.

| Skill | Thread | Level | Effect | Energy | Cooldown | Range | Amount | What it does | Woven |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ember Bolt | Ember | 1 | bolt + Burning | 6 | 2.5 | 6 | 4 + Wit × 1.4 | Burns for 30% more over 3 s | The burn is doubled and spreads to one creature nearby |
| Tide Lash | Tide | 2 | cone | 8 | 6 | 3 | 3 + Wit × 1.0 | Knocks creatures back 2 tiles and Slows them 30% for 3 s | Roots instead of slowing |
| Gale Step | Gale | 4 | blink | 8 | 10 | 5 | 2 + Wit × 0.5 | Blink to a spot, leaving a gust that hits creatures where you stood | Blink twice |
| Chain Spark | Gale | 6 | bolt (chains) | 10 | 6 | 6 | 5 + Wit × 1.3 | Jumps to 3 creatures, 20% weaker each jump | Jumps to 6 |
| Wish Ward | Tide | 8 | shield | 12 | 15 | 6 | 10 + Wit × 2.0 | Shields you or an ally for 8 s | Shields every ally within 3 tiles of the target |

Ember Bolt replaces Firebolt for Wishweavers; Firebolt stays as a common
technique for everyone else ([classes.md](../classes.md#common-techniques)).

## Paths (level 10)

### Stormcaller: the storm in full

| Skill | Thread | Level | Effect | Energy | Cooldown | Range | Amount | What it does |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Firestorm | Ember | 10 | area | 18 | 15 | 3 around a spot up to 6 away | 3 + Wit × 0.6 per second for 5 s | Fire rains on a spot; creatures inside are Burning |
| Overflow | | 15 | passive | None | None | Self | None | Woven spells give back the Energy they cost |
| Starfall | All three | 20 | area | 30 | 60 | 4 around a spot up to 7 away | 10 + Wit × 1.5, six times | Six stars fall over 3 s; always Woven, and leaves you with 3 Weave |

### Threadbinder: the one who rewrites the fight

| Skill | Thread | Level | Effect | Energy | Cooldown | Range | Amount | What it does |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unravel | Gale | 10 | debuff | 10 | 12 | 6 | 4 + Wit × 1.0 | Strips a creature's shields and buffs and Silences it for 3 s |
| Loose Ends | | 15 | passive | None | None | Self | +15% damage | You deal 15% more to Slowed, Rooted and Silenced creatures, and your slows last 50% longer |
| Rewrite | Tide | 20 | heal or strike | 25 | 90 | 6 | Everything from the last 3 s | On an ally: undo the last 3 s, healing every bit of damage they took and clearing statuses gained then. On a creature: give it back all the damage it dealt in the last 3 s |

## How to play

- **Alone:** Tide Lash to push creatures away, Ember Bolt while they walk
  back, Gale Step when they reach you. Keep your thread order turning so
  something is always Woven. Never stand still in melee: you have the least
  health of any Calling.
- **In a party:** stay behind the Warden. Stormcallers melt groups with
  Firestorm and Starfall; Threadbinders shut down dangerous creatures with
  Unravel and save allies with Wish Ward and Rewrite.
- **Weapons:** the staff hits harder, the wand fires faster and frees the
  off hand for a tome (Energy) or an orb (Ward).
- **Attributes:** Wit for damage and Energy; Spirit for Energy regeneration
  and Ward; a little Vigor makes mistakes survivable.
