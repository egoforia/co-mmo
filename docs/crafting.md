# Gathering and crafting

Players gather materials in every land, work them into gear in seven
crafts, and put their name on what they make. This is the gather and craft
plan (approved by the Owner on 2026-11-03), built in seven steps. The Bible
has the players' edition (`client/src/bible/crafting.ts`), built from the
same data, so the two always agree.

The game is meant to be harsh. Costs and penalties here are on purpose:
changing a mastery costs gold and a craft's levels, and tools wear out.

## Where things live

| What | File |
| --- | --- |
| Materials: family, home lands, source, tier, trait | `shared/src/materials.ts` (`ItemDef.material`) |
| Crafts, levels, masteries, tools | `shared/src/crafts.ts` |
| Crafted copies: maker, quality, binding | `shared/src/copies.ts` |
| Recipes, recipe tiers, crafting, quality | `shared/src/kit.ts` |
| The starting recipes and unique pieces | `shared/src/recipes.ts` |
| Gathering spots and gathered materials | `shared/src/gathering.ts` |
| Gathering on the server | `server/src/region/gathering.ts` |
| Crafting, shops and masteries on the server | `server/src/region/kit.ts` |
| Pictures to paint (tools, spots, icons) | `server/src/assets/craft-tool-anchors.ts`, `gather-spot-anchors.ts`, `material-icon-anchors.ts` |

## Materials

Every material has:

- **A family:** wood, hide, fibre, ore, plate, feather, herb, gem, bone or wishstuff. The family decides which craft works it.
- **Its home lands.** The Sanctum's materials count as every land's.
- **A source:** gathered, creature, quest or boss.
- **A tier:** 1 anyone can work, 2 is finer, and 3 comes only from bosses and needs a master.
- **At most one trait.** The fashion plan gives traits their numbers.

Wished materials must fill these fields (`cleanMaterial`). They are tier 1 or 2, and they come from where the wisher stands.

## Crafts

| Craft | Works | Tool | Home peoples |
| --- | --- | --- | --- |
| Woodcarving | wood, bone | axe | Ursine, Cervid |
| Leatherwork | hide | skinning knife | Ursine |
| Tailoring | fibre | shears | Scorpid, Falcon |
| Smithing | ore, plate | pick | Scorpid, Lutran |
| Fletching | feather | fletching knife | Falcon |
| Herbalism | herb | sickle | Cervid |
| Jewellery | gem | pliers | Lutran |

Wishstuff stays an ingredient for now; a wishstuff craft can come later.

- **Levels** run from 1 to 20, kept in `Character.crafts`.
  - Gathering and crafting add practice.
  - A recipe five or more levels below yours gives a quarter as much practice.
- **Masteries** are kept in `Character.masteries`; a player can hold two.
  - You take one from the craft's master, a shop with `masters`.
  - You need one to rise past level 10, to work tier 3 materials, to make unique recipes and to reach quality above 115%.
  - The first two are free. Changing one costs 300 gold (`MASTERY_CHANGE_GOLD`), and the old craft drops to level 10.
- **Home crafts** start at level 3 with +10 quality. A character's first tool for each home craft is given once, when they enter the world (`giveHomeTools`).
- **Tools** have item ids `tool-<craft>-<tier>`.
  - Every craft and every gathering needs its tool in the bag.
  - A spot's material tier is the tool tier it needs.
  - Each tier above the first adds 5 quality.
  - Masters sell tiers 1 and 2. Smithing makes all three.
  - Each use has a 2%, 1% or 0.5% chance of wearing the tool out, by tier.

| Craft | Master |
| --- | --- |
| Herbalism | Old Bramble |
| Woodcarving | Mother Morel |
| Leatherwork | Ysolde |
| Tailoring | Mother Elena |
| Smithing | Brother Tolle |
| Fletching | Marina |
| Jewellery | Sultana Zahra |

## Gathering

Each shipped biome has four kinds of spot (`SPOTS`). `layOutSpots` stands 12 of each in every land of that biome:

- They stand on open ground with open ground all round, at least 10 tiles from the middle.
- The layout is the same every time.
- Each spot blocks its tile.

The world editor's **Gathering** tool (in the Life group) stands a spot or takes one away (the `spot` edit). Painting over a spot removes it.

Pressing **E** checks for these in order: an NPC to talk to, a body to loot, a spot to gather. Gathering at a spot:

- takes `GATHER_MS` (2 s), and being hit or walking off stops it;
- gives 1 to 3 of the spot's material and practice to the craft;
- starts a regrow timer of `REGROW_MS` (5 minutes), separate for each player and spot, so nobody empties a spot for anyone else.

The tool shows in the hand while gathering. Its own picture is used once it is painted; until then a shipped stand-in shows. Cervid players see spots on the mini map (Mycelial Sense, `sensesSpots`).

## Recipes

A recipe (`RecipeDef`) names:

- its craft (when it has none, its main material's craft is used);
- the craft level it needs;
- its materials and its result.

Its tier is worked out by `recipeTier`, unless the recipe sets one:

| Tier | Rule | Who adds it |
| --- | --- | --- |
| Common | every material from one land (the Sanctum's count anywhere) | Minor wishes |
| Rare | materials from two or three lands | wishes, reviewed by the Stewards |
| Unique | a tier 3 or key item, and a master to make it | the Stewards and the Owner |

A wished recipe that is rare or unique goes before the Stewards (`wishes/cards.ts`).

The starting recipes (`recipes.ts`) are:

- every craft's tools in three tiers;
- common recipes from each land's materials, gathered ones most of all;
- two rare recipes;
- one unique piece for each big boss: the Hoarfrost Roc, the Rootless King, the Chained Demon, the wyrm and the Sanctum Relic.

## Crafted copies

Crafted and shop-bought gear is a copy. All of it is in its item id:

```
<base>~c~<quality>~<maker>~<people>~<trait>~<material>~<nonce>
```

`ITEMS[id]` works out the copy's ItemDef from that id, so bags, trades, saves and every server agree with nothing to sync.

- **Quality** runs from 80 to 130. It sizes the bonus and the value.
- **Rarity:** a copy of quality 115 or more is one rarity finer than its base item.
- **Shop gear** is quality 100, made by the shopkeeper.
- **Unique pieces** bind when first worn: the tag changes from `c` to `b`. A bound copy is never sold, traded or dropped.
- **Wishes and rules** can never name a copy id.

## Adding to it

- **A recipe:** add it to `recipes.ts`, or wish for it. Keep common recipes at level 10 or below; the tests check this.
- **A spot kind:** add it to `SPOTS` with a material from its biome, and a look to `gather-spot-anchors.ts`. Every land of the biome gets it.
- **A material:** give it `material` data. If it borrows another item's icon, set `art: 'item-<id>'` and `standIn` to the borrowed icon, and its own icon becomes paintable in the Art tab.
- **Balance:** the numbers are named constants in `crafts.ts` and `gathering.ts`.

## Robot playtest

`server/playtest/crafting.play.ts` plays it end to end:

1. A Cervid gathers sage with the sickle their people gave them and brews a tonic.
2. The Cervid fells an oak branch and trades it to a Scorpid.
3. The Scorpid digs copper with their own pick and smiths pliers.
