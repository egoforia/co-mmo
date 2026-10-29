# Building the Callings

How to turn [attributes.md](attributes.md), [races.md](races.md),
[classes.md](classes.md) and the five Calling pages into code. Each step is
one pull request with its own tests, small enough to review, and leaves the
game playable. Written 2026-10-27; nothing here is built yet.

These steps change core files (`rpg.ts`, combat, the protocol, the creature
brain), so they are Owner-approved core work, not wish branches. Every step
must pass `npm run typecheck` and `npm test`. Follow the module rules in
`.claude/skills/co-mmo-module/SKILL.md`: shared rules in `packages/shared`,
new files under ~400 lines, and `docs/architecture.md` updated when a
module or contract changes.

## Order

| Step | What | Depends on |
| --- | --- | --- |
| 1 | Five attributes and the new formulas | |
| 2 | Peoples and Callings as data; choosing at creation | 1 |
| 3 | Weapon families and damage types | 1 |
| 4 | Effect kit and statuses | 1 |
| 5 | Threat and targeting | 4 |
| 6 | Signature gauges | 2, 4 |
| 7 | Skills, Paths, hotbar 1–6, mentors and trials | 2–6 |
| 8 | The Fallen and raising | 4 |
| 9 | The God knows the story and the Callings | 2, 7 |
| 10 | Art for weapons, skills and the spirit hawk | 3, 7 |
| 11 | Balance test | 1–7 |

Steps 3, 4 and 8 can be built side by side once step 1 is in.

## 1. Five attributes

- Add `vigor` to `Stats` and `STARTING_STATS` in `packages/shared/src/rpg.ts`.
- `rpg.ts` is large: move the stat formulas (`maxHp`, `maxEnergy`,
  `energyPerSecond`, `regenPerSecond`, `attackPower`, `attackCooldown`,
  `afterArmor`) into a new `packages/shared/src/rpg/attributes.ts` and
  re-export them, so `rpg.ts` becomes a facade.
- Put in the formulas from [attributes.md](attributes.md): HP, Energy,
  regeneration, crit, dodge, cooldown reduction, Armor and Ward from
  attributes.
- `gainXp`: until step 2, level-ups give +1 to all five, as today.
- `upgradeCharacter`: give saved characters `vigor = might`.
- Character sheet (`packages/client/src/rpg-ui.ts`): show five attributes,
  Armor, Ward and crit.
- Tests: formula values at levels 1/10/20 match the tables in
  [attributes.md](attributes.md#worked-numbers).

## 2. Peoples and Callings as data

- New `packages/shared/src/races.ts` (`RACES`) and
  `packages/shared/src/classes.ts` (`CALLINGS`: attribute pair, trained
  weapon families, gauge, core skill ids by level, two Paths).
- `Character` gains `race`, `calling`, `path?` and `freePoints`. `gainXp`
  gives +1 primary, +1 secondary and a free point. A new `spendPoint`
  message and handler lets players place free points; the server checks
  them.
- Character creation: the invite form (`packages/client/src/main.ts`) asks
  for a people and a Calling next to the name and look; `/api/accept`
  (`packages/server/src/account-routes.ts`) checks and saves them. The look
  wish (`grantLook`) passes the people to the painter.
- Existing characters without a Calling see a "Choose your people and
  Calling" screen on joining (`game-socket.ts`), and their stats are rebuilt
  ([classes.md](classes.md#migration)).
- Changing Calling or people as a Moderate wish: a new wish kind in
  `packages/shared/src/content.ts`, handled like the look wish.
- Tests: creation with every people and Calling, migration of an old saved
  character, point spending refused when there are no free points.

## 3. Weapon families and damage types

- `WEAPON_FAMILIES` in a new `packages/shared/src/weapons.ts`; `ItemDef`
  gains `weapon?: WeaponFamily` and shields gain `block` and `blockAmount`.
  Give existing weapons their family ([classes.md](classes.md#weapons)).
- Basic attacks in `packages/server/src/region/combat.ts` use the family's
  speed, reach and scaling, ranged families fire at range, and untrained
  weapons deal 30% less.
- Damage types: hits carry `physical` or `arcane`; creatures gain `armor`
  and `ward` (`CreatureDef`, the `lands.ts` generator, `creatureFromWish`).
- Wished weapons name a family; `validateDefinition` checks it.
- Client: hold the weapon by family (`packages/shared/src/held.ts`), and
  show the attack's reach.

## 4. Effect kit and statuses

- Grow `AbilityEffect` to the kit in [classes.md](classes.md#new-mechanics);
  `AbilityDef` gains optional `status`, `radius`, `duration`, `damageType`,
  `thread` and `finisher` fields.
- A status timer list on players and creatures (server), sent in snapshots
  and shown as icons (client). Stun immunity after a stun; Vigor shortens
  harmful statuses.
- `Combat.useAbility` runs each effect; keep each effect a small function in
  `packages/server/src/region/effects/*.ts` rather than growing `combat.ts`.
- `validateDefinition` and `abilityFromWish` (`content.ts`) accept the new
  effects for wished abilities, still with world-set numbers.
- Tests: one per effect and per status, including stun immunity.
- Built: the kit also has `line` (docs/classes.md lists it). Silenced is a
  status too, waiting for creature specials. Summoned helpers and traps work
  but are not seen yet, and statuses show as words: their pictures come in
  step 10. Taunt only sets the status; threat is step 5.

## 5. Threat and targeting

- Creatures keep a threat list (`packages/server/src/region/minds.ts`,
  `packages/server/src/creature-brain.ts`) and pick their target by threat, with taunts.
- Targeting: the client sends a target on attacks and abilities (the
  `target` field already in `AbilityMessage` in `protocol.ts`), chosen by
  click or Tab; the server checks range and falls back to the nearest.
  Heals and buffs pick the most hurt ally when none is chosen.
- Tests: the healer draws threat, a taunt forces the target, a creature
  switches only past 10% more threat.
- Built: the rules are in `packages/server/src/threat.ts`. A Fallen player
  leaves every threat list and the creature turns to the next. `AbilityDef`
  has `threat` (a multiplier, e.g. Shield Bash's 3) for step 7 to fill.
  A heal with range 0 mends only its user (wished heals stay that way); Mend
  now reaches 5 steps. The chosen target shows as a gold name tag with ▸.

## 6. Signature gauges

- Gauge state per player on the server, filled and spent by the rules in
  [classes.md](classes.md#signature-gauges), including the Energy the
  Warden, Duelist and Ranger gain from it.
- A small protocol message for gauge changes; HUD pips under the health bar.
- Tests: each gauge fills, empties and is spent as described.
- Built: shared `rpg/gauges.ts`, server `region/gauges.ts`. Step 7's
  skills only add data: `finisher` with `perPip` spends the gauge (a
  Bellkeeper's finisher heal is Toll), `thread` feeds Weave, and effects read
  `cast.woven` and `cast.spent`; skills that add pips (Challenge, Riposte,
  Sidestep) call `Gauges.add`. Echoes last 20 s and Resolve starts emptying
  after 5 s out of a fight, a pip every 2 s (numbers the pages leave open).

## 7. Skills, Paths, hotbar, mentors and trials

- Add every skill in the five Calling pages to `ABILITIES`, with the numbers
  in their tables.
- Core skills are learned on level-up; Path skills after the trial.
- The five Sanctum mentors become trainers and quest givers (their entries
  in `world.ts` and `rpg.ts`); add the five trial quests and the Path choice.
  Sir Alder, Sultana Zahra, Queen Nerissa and Brother Tolle become Path
  mentors (`packages/shared/src/lands.ts`). The Windkeeper is added when the
  Sky Ruins exist; until then Zephyr Falcon stands in.
- Hotbar grows to keys 1–6 (`packages/client/src/kit-ui.ts`, `main.ts`), and
  the player arranges it from their spellbook.
- Existing abilities become common techniques; Mend and Firebolt follow
  [classes.md](classes.md#common-techniques).
- The Calling Wish at levels 10 and 20: a free Minor wish limited to a new
  look and name for one skill.

## 8. The Fallen and raising

- In `packages/server/src/world.ts`, a player at 0 HP becomes Fallen for up
  to 10 s instead of waking at the shrine at once; a "Wake at the shrine"
  button ends it early. Creatures ignore the Fallen.
- Peal of Waking and Great Bell of Waking raise a Fallen ally where they
  lie, with no Weakened.
- Player words: "You have fallen. A friend may still ring you back, or you
  can wake at the shrine."

## 9. The God knows the story

- Add a short summary of [world.md](world.md) and the Callings to the God's
  persona in `packages/server/src/god.ts`. While there, replace its old
  "Legend of Mana" art line with the current style (Style Bible v3).
- Teach the God the rules for wished content in
  [world.md](world.md#rules-for-wished-content) and how to answer wishes
  for new Callings ([classes.md](classes.md#wishes-and-callings)).
- Put the new docs in the in-game Bible with the other documents.

## 10. Art

Everything is painted by the image model through the existing pipeline,
never drawn in code (`docs/art-pipeline.md`, `.claude/skills/co-mmo-art/SKILL.md`):

- The five peoples as player bodies (the beastfolk anchors and walks in
  `assets/beastfolk/` are the starting point).
- A held-item picture for each weapon family and off-hand family.
- Skill effects (Ember, Tide and Gale threads, bells and Echoes, traps,
  marks) and status icons.
- The spirit hawk and the Sandstorm double, as creatures in the `small` and
  `medium` height tiers.

## 11. Balance test

A Vitest test (`packages/shared/test/balance.test.ts`) builds each Calling at
levels 1, 10 and 20 with its main weapon and runs a simple fight against a
same-level creature from the `lands.ts` generator. It checks:

- the three damage Callings' damage per second is within 15% of each other;
- Warden and Bellkeeper deal 30–50% of the Duelist's damage;
- time survived follows the survival ratings (Warden > Bellkeeper >
  Duelist > Ranger > Wishweaver);
- each Calling's 15-point rating row adds up to 15.

When a wish or update changes a formula, this test shows whether the
Callings are still even.
