# Region fashion

Each region has its own line of clothes, made by Tailoring and Leatherwork
from that region's materials. Characters' pictures never change: garments
are seen as item pictures, names and attributes. The approved plan is the
[Region fashion plan](https://claude.ai/artifact/Y6C7JZJpf4wUyiqzNue3Ep).

## Wear slots

A full outfit is four garments: **head, body, cloak, feet**
(`GARMENT_SLOTS`, `packages/shared/src/rpg.ts`). Weapon, off hand and charm
are not garments. Wished cloaks and boots guard like a hat
(`equipmentBonus`).

## A garment's attributes (`packages/shared/src/fashion.ts`)

A crafted copy's bonus is worked out once, from its id (`copies.ts`), the
same on server and browser:

1. **Base item**, scaled by **quality** (80% to 130%; 115% and up is one
   rarity finer).
2. **People lean**: the maker's people's two lifted attributes, by the
   copy's rarity: Common +1, Uncommon +1/+1, Rare +2/+1, Epic +2/+2,
   Legendary +3/+3. The maker chooses which attribute gets the larger share
   in the crafting book; the choice is kept in the id (`ursine-spirit`).
3. **Material trait** of the main material, x1 (Common, Uncommon), x2 (Rare,
   Epic) or x3 (Legendary): sturdy +1 Armor, warding +1 Ward, warm +5% health
   regeneration, light +1% dodge, supple +1% attack speed, shimmering +3%
   Energy regeneration.

A maker working a material their people prefers (Ursine bark, wood and
pelts; Scorpid linen, silk and chitin; Falcon feathers, wool and felt;
Cervid moss, mushroom fibre and herbs; Lutran shell, pearl and sea cotton)
gets +10 quality. Shopkeepers have a people (`NPC_PEOPLES`); what they sell
is Common at 100% with their lean. Loot and older gear say "Tailored by
unknown" and have no lean. The bag card says where each part comes from.

## The six styles (`packages/shared/src/fashion-styles.ts`)

| Style | Region | Full-style bonus (3+ pieces, anywhere) | Home tailor |
| --- | --- | --- | --- |
| Pilgrim | Sanctum | +10% healing received | Mother Elena |
| Barkwarden | Whispering Woods | +3 Armor | Old Bramble |
| Pearlcoat | Sunlit Shore | +3 Ward | Marina |
| Sunwrap | Mirage Desert | harmful statuses 10% shorter | Cactus Elder |
| Windfelt | Frostpeak | +3% dodge | Ysolde |
| Sporeweave | Mushroom Hollow | +10% Energy regeneration | Mother Morel |

Each style has four common garments from its own region's materials (the
Sanctum's count anywhere), sold at home by its tailor. Eight rare garments
mix two or three regions. Three unique pieces belong to a style: the Roc
Plume Mantle (Windfelt), the Crown of the Rootless King (Sporeweave) and the
Wyrmscale Hauberk (Sunwrap). `fullStyles` counts styles among the four
garment slots; `gearBonus` adds the bonus, so every formula sees it.

A region added later gets a style the same way: add it to `REGION_STYLES`
and `STYLE_CHOICES` (`fashion.ts`), with its four garments in `COMMON`.

## Wished garments (`packages/shared/src/fashion-wishes.ts`)

A wished hat, coat, cloak or pair of boots names a style (or its words do;
otherwise the wisher's region's style is used) and takes up to three of that
region's materials. The wish brings the garment and its recipe under the
wish's id, so switching the wish off takes both out. A rare garment goes
before the Stewards; unique pieces are never wished.

## Pictures

Every garment has its own picture, `item-<id>`, painted from the Art tab
beside its stand-in (`server/src/assets/material-icon-anchors.ts`); until it
is painted the bag shows the stand-in. About 32 pictures, ~$0.04 each.
