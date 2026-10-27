# The five Callings

A Calling is a Wishbearer's class: how they fight, which weapons they are
trained in, which skills they learn and what they bring to a party. There
are five at launch, one for each attribute on the pentagon
([attributes.md](attributes.md)). Any of the five peoples
([races.md](races.md)) can take any Calling. Story: [world.md](world.md).
Decided with egoforia on 2026-10-27.

| Calling | Attributes | Role | In one line | Details |
| --- | --- | --- | --- | --- |
| **Warden** | Vigor, Might | Tank | Stands in front, keeps creatures on themselves and the party safe | [warden.md](classes/warden.md) |
| **Duelist** | Might, Agility | Melee damage | Dashes in, builds Momentum and spends it on big finishers | [duelist.md](classes/duelist.md) |
| **Ranger** | Agility, Wit | Ranged damage | Holds still to build Focus, then strikes from afar; traps and a spirit hawk | [ranger.md](classes/ranger.md) |
| **Wishweaver** | Wit, Spirit | Caster and control | Weaves three threads of wishstuff (Ember, Tide, Gale) for doubled spells | [wishweaver.md](classes/wishweaver.md) |
| **Bellkeeper** | Spirit, Vigor | Healer and support | Rings heals that echo, raises the fallen, and tolls doom on creatures | [bellkeeper.md](classes/bellkeeper.md) |

## Balance

Three ideas keep the Callings even:

1. **The pentagon.** Each Calling has two neighbouring attributes, and each
   attribute is primary for one Calling and secondary for another. No
   attribute is useless and none is for everyone.
2. **A 15-point budget.** Each Calling is rated 1 to 5 on five things, and
   every row adds up to 15. A Calling that is great at something pays for it
   somewhere else.
3. **Numbers checked by a script.** The tables in
   [attributes.md](attributes.md#worked-numbers) are computed, not guessed,
   and become a test (step 11 in [callings-build-plan.md](callings-build-plan.md)).

| Calling | Damage | Survival | Support | Range | Mobility | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Warden | 2 | 5 | 3 | 2 | 3 | 15 |
| Duelist | 5 | 3 | 1 | 1 | 5 | 15 |
| Ranger | 4 | 2 | 2 | 5 | 2 | 15 |
| Wishweaver | 5 | 1 | 2 | 4 | 3 | 15 |
| Bellkeeper | 1 | 4 | 5 | 3 | 2 | 15 |

Every Calling can quest alone. The Warden and Bellkeeper kill more slowly
but almost never fall; the three damage Callings kill fast but must avoid
being swarmed. A party of all five is the strongest, but any mix works.

## Signature gauges

Each Calling has one gauge of up to 5 pips, shown under the health bar.
It gives each Calling a rhythm of its own on top of Energy.

| Calling | Gauge | Fills when | Spent on |
| --- | --- | --- | --- |
| Warden | **Resolve** | You are hit or block (+1). Each pip also gives 2 Energy | Bulwark and other Warden skills; empties slowly out of combat |
| Duelist | **Momentum** | Your hits land (+1, and 1 Energy each) | Finishers (Whirl, Execute); empties after 6 s without a hit |
| Ranger | **Focus** | You stand still and are not hit (+1 per second, and 1 Energy each); each pip is +5% crit | Aimed Shot and other big shots; moving or being hit empties it |
| Wishweaver | **Weave** | You cast a spell of a different thread from your last one (+1) | At 3 pips your next spell is **Woven**: its effect is doubled |
| Bellkeeper | **Echo** | Your heals leave an Echo on the ally (one pip per ally with an Echo) | Toll rings every Echo, repeating half of the heal that left it |

## Weapons

Weapons belong to a **family**. The family sets the speed, reach, which
attributes it scales with, and any extra; the item sets the damage and
bonuses, as today. Slower weapons scale harder, so damage per second evens
out across a Calling's weapons.

A Calling is trained in three families. Anyone can wield any weapon, but
outside your training it deals 30% less damage and its extra does not work.

| Family | Calling | Hands | Speed (s) | Reach (tiles) | Damage | Scales with | Extra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hammer | Warden | One | 1.2 | 1.6 | 4 | Might 0.7, Vigor 0.3 | Heavy: can stagger |
| Axe | Warden | One | 1.0 | 1.6 | 3 | Might 0.6, Vigor 0.2 | 10% chance to cause Bleeding |
| Spear | Warden | One | 1.1 | 2.2 | 3 | Might 0.55, Vigor 0.3 | Long reach; heavy |
| Sword | Duelist | One | 0.8 | 1.6 | 3 | Might 0.6, Agility 0.5 | None (the all-rounder) |
| Twin blades | Duelist | Both | 0.55 | 1.4 | 2 | Agility 0.5, Might 0.25 | +5% crit |
| Greatsword | Duelist | Both | 1.3 | 2.0 | 6 | Might 1.1, Agility 0.3 | Heavy; hits up to two creatures |
| Bow | Ranger | Both | 1.0 | 6 | 3 | Agility 0.8, Wit 0.3 | Long range |
| Sling | Ranger | One | 0.7 | 5 | 2 | Agility 0.5, Wit 0.2 | Off hand stays free |
| Javelins | Ranger | One | 1.3 | 4.5 | 5 | Agility 0.9, Wit 0.3 | Slows 20% for 2 s |
| Staff | Wishweaver | Both | 1.1 | 5 | 3 | Wit 0.8, Spirit 0.2 | Arcane bolt |
| Wand | Wishweaver | One | 0.8 | 5.5 | 2 | Wit 0.55, Spirit 0.1 | Arcane bolt; off hand stays free |
| Bell-mace | Bellkeeper | One | 1.1 | 1.6 | 3 | Spirit 0.45, Vigor 0.25 | Each hit heals the most hurt ally within 4 tiles for 30% of the damage |
| Censer | Bellkeeper | Both | 1.0 | 2.5 | 2 | Spirit 0.4, Vigor 0.15 | Arcane; hits everything within 1 tile of the target |
| Hand bell | Bellkeeper | One | 0.9 | 4 | 2 | Spirit 0.4, Vigor 0.1 | Arcane ranged chime |

Off-hand families:

| Family | Trained | Gives |
| --- | --- | --- |
| Shield | Warden, Bellkeeper | Armor, block chance and block amount ([attributes.md](attributes.md#defence)) |
| Tome | Wishweaver | Wit and max Energy |
| Orb | Wishweaver | Ward and Spirit |
| Lantern | Bellkeeper | Spirit and light (the existing Temple Lantern is one) |

Existing items get a family: the Wooden Sword is a sword, the Crab Lance and
Coral Spear are spears, and the Golem Club is a hammer. A wished weapon names
its family, and `validateDefinition` checks it, so wished weapons fit
someone's training.

## Progression

- **Level cap 20** at launch. Wishes and updates can raise it later.
- **Core skills.** Five per Calling, learned automatically at levels 1, 2,
  4, 6 and 8.
- **Paths.** At level 10 the Calling's mentor sends you on a **trial**: a
  quest to the Calling's old home (see [world.md](world.md#the-wishbearers-and-the-callings)).
  Finishing it lets you choose one of two Paths. Each Path gives an active
  skill at 10, a passive at 15 and a great skill at 20. Changing Path later
  costs gold at the Path mentor (50 gold × level).
- **Hotbar.** Keys 1 to 6 (today 1 to 4). By level 20 a character has seven
  active skills and two common techniques to choose from, so what to slot
  is a real choice. Passives do not need a slot.
- **Attributes.** +1 primary, +1 secondary and one free point per level
  ([attributes.md](attributes.md#how-attributes-grow)).
- **Calling Wishes.** At levels 10 and 20 you get one free Minor wish to
  reshape one of your skills: its look, its name and its flavour ("my Ember
  Bolt is a swarm of fireflies"). The God shapes the picture; the world keeps
  the numbers, as it does for every wished ability.

| Level | Gets |
| --- | --- |
| 1 | Calling chosen; first core skill; Calling weapon from the mentor |
| 2, 4, 6, 8 | Next core skill |
| 10 | Path trial; Path skill; first Calling Wish |
| 15 | Path passive |
| 20 | Path's great skill; second Calling Wish |

### Mentors

Every Calling has a mentor in the Sanctum, standing where the five peoples'
representatives stand today (`packages/shared/src/world.ts`). The mentor
gives you your first weapon, teaches the core skills again if you forget
them, and starts the level-10 trial. The trial ends with the Path mentor in
the Calling's old home.

| Calling | Sanctum mentor | Path mentor |
| --- | --- | --- |
| Warden | Bramble Ursine | Sir Alder, Mossgate |
| Duelist | Dune Scorpid | Sultana Zahra, the Mirage Palace |
| Ranger | Zephyr Falcon | The Windkeeper, Sky Ruins (a new person; until the Sky Ruins exist, Zephyr Falcon) |
| Wishweaver | Tide Lutran | Queen Nerissa, the coral halls |
| Bellkeeper | Sylvan Cervid | Brother Tolle, the temple |

A mentor's people is not a hint: anyone can learn from any mentor.

### Common techniques

Abilities that belong to no Calling stay in the game as **common
techniques**: Power Strike (the Mushroom Trouble quest reward), Firebolt
(the scroll) and every wished ability. Anyone can slot them. They follow
today's `AbilityDef` numbers, which are a little weaker than Calling skills.
Mend becomes the Bellkeeper's first skill; a non-Bellkeeper who already knows
it keeps it as a common technique.

## New mechanics

These are new to the game. Their numbers are in [attributes.md](attributes.md).

- **Effect kit.** Today an ability is a `strike`, `bolt` or `heal`. The kit
  grows to a closed list that hand-made and wished skills both draw on:
  `strike`, `bolt`, `heal`, `area` (around you or at a spot), `cone`,
  `line`, `dash`, `blink`, `shield`, `buff`, `debuff` (statuses and marks),
  `taunt`, `trap`, `summon`, `stance` (a toggle that drains Energy) and
  `cleanse`. A skill can add one status to its effect. The God still picks
  only the effect; the world sets the numbers.
- **Statuses, threat and targeting:** see [attributes.md](attributes.md#statuses).
- **The Fallen.** Today a player at 0 HP wakes at the shrine at once. After
  this change they are **Fallen** for up to 10 s, lying where they fell, and
  can wake at the shrine any time (a button). A Bellkeeper can raise them
  where they lie with Peal of Waking or Great Bell of Waking. Waking at the
  shrine still leaves you Weakened for 30 s; being raised does not.
  Creatures ignore the Fallen.
- **Gauges** (above) and **weapon families** (above).

## Changing Calling

Changing Calling is a Moderate wish (6 Favor), made at the shrine. You keep
your level, gear and common techniques; your Calling points move to the new
Calling, your free points come back to place again, your Path is cleared
and you learn the new Calling's core skills for your level. You need to do
the new Calling's trial again to choose a Path.

## Wishes and Callings

- **A wish for a new skill** ("I wish I could throw lightning") becomes a
  common technique built from the effect kit, as today, or, when it fits,
  a Calling Wish's new look for a skill you have.
- **A wish for a new Calling or Path** is too big for content data. The God
  offers it as a Major wish: Stewards review it, and it becomes data in
  `packages/shared/src/classes.ts` or a reviewed Engine wish. A new Calling
  must keep the pentagon and the 15-point budget.
- **Gear wishes** stay capped at Rare and name a weapon family.

## Migration

Characters from before Callings keep their level, XP, gold, Favor, items
and known abilities. The next time they join, a "Choose your people and
Calling" screen appears before they enter the world. Their attributes are
rebuilt by the new rules for their level, with free points ready to place.
Known abilities that match a skill of the chosen Calling become that skill;
the rest become common techniques.

## In the code (for the build plan)

Callings are plain data in a new `packages/shared/src/classes.ts`: the
attribute pair, trained weapon families, gauge, core skills and Paths. Skills
are `AbilityDef`s in the same `ABILITIES` table as today, with new effect and
status fields. The character keeps `race`, `calling`, `path` and
`freePoints`. See [callings-build-plan.md](callings-build-plan.md).
