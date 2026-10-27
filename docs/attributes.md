# Attributes and combat numbers

Every Wishbearer has five attributes: **Might, Agility, Wit, Spirit and
Vigor**. This page says what each one does, how they grow, and every formula
built on them: health, Energy, damage, healing, defence, crits, statuses and
threat. Decided with egoforia on 2026-10-27: Vigor joins the four existing
attributes, and the rules below replace the ones in
`packages/shared/src/rpg.ts` when [callings-build-plan.md](callings-build-plan.md)
is built.

The aim: every attribute is worth raising for someone, none of them is
worth raising for everyone, and level-1 numbers stay close to today's so
the creatures already in the world stay fair.

## The pentagon

The five attributes sit in a ring:

```
          Might
        /       \
   Vigor         Agility
      |           |
   Spirit ——— Wit
```

Each Calling builds on two **neighbours** in the ring, a primary and a
secondary, so every attribute is primary for one Calling and secondary for
another (see [classes.md](classes.md)). Each people lifts two attributes
that are **not** neighbours (see [races.md](races.md)).

| Calling | Primary | Secondary |
| --- | --- | --- |
| Duelist | Might | Agility |
| Ranger | Agility | Wit |
| Wishweaver | Wit | Spirit |
| Bellkeeper | Spirit | Vigor |
| Warden | Vigor | Might |

## What each attribute does

| Attribute | In a word | Does |
| --- | --- | --- |
| **Might** | Strength | Damage of heavy weapons and might skills; block amount with a shield; stagger chance; +1 max HP per point |
| **Agility** | Speed and precision | Damage of light and ranged weapons and agility skills; attack speed; critical hit chance; dodge |
| **Wit** | Mind and magic | Damage of spells; max Energy; shorter cooldowns; crafting (recipes still ask for a Wit level) |
| **Spirit** | Soul and faith | Healing done; Energy and health regeneration; Ward (defence against magic) |
| **Vigor** | Toughness | Max HP (the main source); Armor; shorter harmful statuses |

Before this change, Might gave both melee damage and health, so everyone
raised it. Health now comes mostly from Vigor, and Might is about hitting
hard.

## How attributes grow

| Source | Points |
| --- | --- |
| Start | 3 in each attribute |
| People | +1 to two attributes ([races.md](races.md)) |
| Calling | +3 primary, +2 secondary |
| Each level after 1 | +1 primary, +1 secondary, **+1 free point** you place yourself |
| Gear | Item bonuses, as today (`Bonus` in `rpg.ts`) |

With every free point in the primary and no people lift, a character has:

| Level | Primary | Secondary | Others |
| --- | --- | --- | --- |
| 1 | 6 | 5 | 3 |
| 10 | 24 | 14 | 3 |
| 20 | 44 | 24 | 3 |

Free points can go anywhere: a Warden with some Spirit, or a Duelist with
some Vigor, are real choices. A shrine resets free points for gold (10 gold
× level); the Calling's own points never move.

Level 20 is the cap at launch. XP to the next level stays
`round(20 × level^1.5)`.

## Health and Energy

`L` is the character's level; attribute names mean the total including gear.

| Value | Formula | Today |
| --- | --- | --- |
| Max HP | `20 + 6·L + 4·Vigor + Might` | `20 + 10·L + 2·Might` |
| HP regeneration | `1 + 0.3·Spirit` per second, starting 5 s after the last hit | `1 + 0.25·Spirit` |
| Max Energy | `20 + 2·L + 3·Wit` | `20 + 2·L + 2·Wit` |
| Energy regeneration | `1.5 + 0.12·Spirit` per second, always | `1.5 + 0.1·Spirit` |

Energy is still the one resource every Calling spends on skills. Callings
that live in melee or on the move also get Energy from their gauge (see
[classes.md](classes.md)): a Warden gains 2 Energy for each Resolve pip, a
Duelist 1 Energy per hit that lands, and a Ranger 1 Energy per Focus pip.
Without this, low-Wit, low-Spirit Callings would run dry.

## Damage

There are two kinds of damage:

- **Physical**: weapons and might or agility skills. Reduced by **Armor**.
- **Arcane**: spells, bells and wishstuff. Reduced by **Ward**.

Both use today's curve, `afterArmor(amount, defence) = max(1, round(amount × 12 / (12 + defence)))`.
12 defence halves a hit; 24 leaves a third.

| Hit | Formula |
| --- | --- |
| Weapon hit (basic attack) | `weapon.damage + L + Σ attribute × weapon.scale[attribute]` |
| Might or agility skill | `base + L + attribute × factor + weapon.damage` |
| Spell | `base + L + Wit × factor` (some scale on Spirit) |
| Heal | `base + L + Spirit × factor` |
| Every hit and heal | × a random 0.9 to 1.1, as today |

Skills keep today's `AbilityDef` shape (`base`, `stat`, `factor`, `energy`,
`cooldown`, `range`), so the ability formula in `rpg.ts` stays the same. The
weapon's damage is added to might and agility skills, as it is added to
`strike` abilities today. Weapons and their scaling are in
[classes.md](classes.md).

### Speed, crits and stagger

| Value | Formula | Cap |
| --- | --- | --- |
| Attack interval | `weapon.speed / (1 + 0.01·Agility)` seconds | Agility bonus up to +30%; never under 0.35 s |
| Critical hit chance | `5% + 0.4% × Agility` | 35% |
| Critical damage | 150% of the hit | |
| Cooldowns | × `(1 − 0.4% × Wit)` | 20% shorter |
| Stagger (heavy weapons, speed 1.1 s or slower) | `1% × Might` chance to cancel the target's next attack | 25% |

Today attack speed is `max(0.35, 0.8 − 0.03·Agility)` with no weapon speed.
After this change each weapon family has its own speed, and Agility makes
any weapon a little faster.

## Defence

| Value | Formula | Cap |
| --- | --- | --- |
| Armor | gear armor + `0.5 × Vigor` | |
| Ward | gear ward + `0.5 × Spirit` | |
| Dodge (physical hits only) | `0.25% × Agility` | 20% |
| Block (shield in the off hand) | `shield.block` chance; a blocked hit loses `shield.blockAmount + 0.5 × Might` | 40% chance |
| Harmful status length | × `100 / (100 + 3 × Vigor)` | |

Creatures get `armor` and `ward` too. The proposal for creatures made from a
level (`lands.ts`) and wished creatures (`creatureFromWish`): armor = level,
ward = level ÷ 2, with "tough" creatures and undead trading one for the
other.

## Statuses

Statuses are timed effects on players or creatures, shown as small icons.
Harmful ones are shortened by Vigor. Weakened, the only status today, stays
as it is.

| Status | Effect | Typical length |
| --- | --- | --- |
| Slowed | Moves 30–40% slower | 3 s |
| Rooted | Cannot move; can still attack | 2–3 s |
| Stunned | Cannot act | 1 s (creatures), never more than 2 s |
| Silenced | Creature cannot use its special attacks | 3 s |
| Burning | Arcane damage each second | 3–5 s |
| Bleeding | Physical damage each second, ignores Armor | 6 s |
| Poisoned | Damage each second, and heals on you are 30% weaker | 6 s |
| Marked | Takes more damage from you or your party | 8–10 s |
| Taunted | A creature must attack the one who taunted it | 4 s |
| Shielded | Absorbs damage before HP | 6–8 s |
| Weakened | Deals half damage (after waking at the shrine) | 30 s |

A creature recently Stunned cannot be Stunned again for 6 s, so no one can
keep a creature stunned forever.

## Threat and targeting

**Threat.** Today creatures attack whoever is nearest. After this change each
creature keeps a list of who has threatened it: 1 threat per point of damage,
0.5 per point of healing done to someone it is fighting (split between the
creatures that are), and Warden skills multiply threat. It attacks whoever
has the most, and switches only when someone has 10% more than its target.
A taunt forces its target for 4 s.

**Targeting.** Today attacks hit the nearest creature. After this change:

- Click a creature, or press Tab to cycle through those nearby, to make it
  your target. Attacks and skills go to your target if it is in range.
- With no target, the nearest creature in range is chosen, as today.
- Heals and buffs go to the ally you click. With nobody chosen, they go to
  the most hurt ally in range, or to you.

## Worked numbers

Each Calling with its main weapon, every free point in its primary, no
people lift and no other gear. "Damage/s" is a rough fight against one
creature of the same level, with armor equal to its level, counting basic
attacks and core damage skills, limited by Energy. "Kill" is seconds to
defeat a same-level creature from `lands.ts` alone; "Last" is seconds the
character survives that creature's hits with no healing. The script that
makes this table should become the balance test in step 11 of the build
plan.

| Level 1 | Max HP | Energy | Armor | Ward | Crit | Damage/s | Kill | Last |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warden | 55 | 31 | 3 | 1.5 | 6% | 11 | 2.1 s | 29 s |
| Duelist | 44 | 31 | 1.5 | 1.5 | 7% | 18 | 1.3 s | 21 s |
| Ranger | 41 | 37 | 1.5 | 1.5 | 7% | 15 | 1.6 s | 20 s |
| Wishweaver | 41 | 40 | 1.5 | 2.5 | 6% | 12 | 1.9 s | 19 s |
| Bellkeeper | 49 | 31 | 2.5 | 3 | 6% | 8 | 3.0 s | 25 s |

| Level 10 | Max HP | Energy | Armor | Ward | Crit | Damage/s | Kill | Last |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warden | 190 | 49 | 12 | 1.5 | 6% | 18 | 5.8 s | 32 s |
| Duelist | 116 | 49 | 1.5 | 1.5 | 11% | 37 | 2.8 s | 11 s |
| Ranger | 95 | 82 | 1.5 | 1.5 | 15% | 34 | 3.1 s | 9 s |
| Wishweaver | 95 | 112 | 1.5 | 7 | 6% | 30 | 3.5 s | 9 s |
| Bellkeeper | 139 | 49 | 7 | 12 | 6% | 16 | 6.5 s | 18 s |

| Level 20 | Max HP | Energy | Armor | Ward | Crit | Damage/s | Kill | Last |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warden | 340 | 69 | 22 | 1.5 | 6% | 21 | 9.3 s | 43 s |
| Duelist | 196 | 69 | 1.5 | 1.5 | 15% | 49 | 3.9 s | 10 s |
| Ranger | 155 | 132 | 1.5 | 1.5 | 23% | 45 | 4.4 s | 9 s |
| Wishweaver | 155 | 192 | 1.5 | 12 | 6% | 44 | 4.4 s | 8 s |
| Bellkeeper | 239 | 69 | 12 | 22 | 6% | 20 | 9.9 s | 21 s |

What the tables show:

- **Damage.** The three damage Callings land within about 10% of each
  other. The Ranger fights from range and the Wishweaver's Woven spells and
  area spells add about 15% more than shown, so the small gap is their price.
  Warden and Bellkeeper deal about 40% as much.
- **Survival** follows the role ratings in [classes.md](classes.md): Warden,
  then Bellkeeper, Duelist, Ranger and Wishweaver. By level 20 the Warden
  lasts about five times longer than a Wishweaver against the same creature.
- **Healing.** A level-10 Bellkeeper's Mend heals about 78 (`8 + 10 + 24 × 2.5`);
  a same-level creature hits for about 18 every 1.5 s. One Bellkeeper can keep
  a Warden standing against three or four creatures at once.
- **Today vs. later.** Level 1 stays close to today: 36 HP now, 41 to 55 then,
  and level-1 creatures still fall in one to three seconds.
