# The five peoples

Every Wishbearer belongs to one of the five beastfolk peoples. A people
shapes how you look, where your family's stories come from, and adds a small
lift to two attributes plus one trait. It never limits what you can do: any
people can take any Calling (see [classes.md](classes.md)). Decided with
egoforia on 2026-10-27.

## Choosing

- You choose your people when you make a character, next to your name and
  your look. Your look wish ("How do you look?") is painted as one of your
  people; the people decides the body, the wish decides the rest (clothes,
  colours, scars, style).
- Characters made before peoples existed choose theirs, with their Calling,
  the next time they play (see Migration in [classes.md](classes.md)).
- Changing your people later is a Moderate wish (6 Favor). The God repaints
  your look and moves your attribute lift.

## The lifts are small, on purpose

Each people adds +1 to two attributes. The two are never neighbours on the
attribute pentagon (see [attributes.md](attributes.md)), while each Calling's
attributes always are. So no people is the "right" one for a Calling: a
people always either deepens one of a Calling's attributes or adds
something the Calling lacks. Each attribute is lifted by exactly two peoples.

The lift is 2 points, the same as two levels of free points, and matters
less as you level. Traits are flavourful and situational, never a large
combat bonus.

| People | Home | Attribute lift | Trait |
| --- | --- | --- | --- |
| Ursine | Whispering Woods | Might +1, Spirit +1 | **Hibernal**: +25% HP regeneration out of combat |
| Scorpid | Mirage Desert | Agility +1, Vigor +1 | **Chitin**: Poisoned and Bleeding last half as long on you |
| Falcon | Sky Ruins and Frostpeak | Agility +1, Spirit +1 | **Keen Eye**: +1 tile of range on ranged attacks and skills, and hidden things show from further away |
| Cervid | Mushroom Hollow | Wit +1, Vigor +1 | **Mycelial Sense**: +10% healing received, and herbs and materials nearby show on the minimap |
| Lutran | Sunlit Shore | Might +1, Wit +1 | **Tideborn**: +10% move speed on shore sand and in shallow water; swims faster when swimming arrives |

## The peoples

### Ursine (bear)

Sturdy, grounded people of the Whispering Woods, who wear petrified bark
as armour and speak slowly. *Their first wish*: in a winter that would not
end, an Ursine elder wished to sleep until spring and wake with her people
safe. The Listener granted it to all of them, and Ursine still sleep deep
and heal well. They greet with "May the earth cradle your steps." They take
the Hush personally, because their oldest neighbours, the golems of
Mossgate, are its saddest victims.

### Scorpid (scorpion)

Patient, watchful people of the Mirage Desert: chitin-plated, pincer-handed,
with a stinger tail. *Their first wish*: to walk unharmed through the
desert's poisons. They served the Sun-court for generations and remember
the Sun King's wish with quiet disapproval. They say "fear no venom" and
mean it literally.

### Falcon (raptor)

Lean, vigilant people of the high places, the cliffs of Frostpeak and the
broken towers of the Sky Ruins. *Their first wish*: to see every danger
coming. Falcon kept watch over the old roads for the other peoples, and
believe the Hush started where nobody was looking. They greet with "Keep
your eyes to the wind and your bow strung."

### Cervid (deer)

Serene, mystical people of Mushroom Hollow, with velvet antlers, who listen
to the mycelium under the forests. *Their first wish*: to hear the land.
They say the roots remember what the Hush makes everyone else forget, and
they were the first to feel the young God wake. They speak of "the mycelium
whispering of ancient roots".

### Lutran (otter)

Curious, buoyant scouts of the Sunlit Shore, sleek in mother-of-pearl
scaled vests. *Their first wish*: to never be bored. They trade news for
pearls with Queen Nerissa's coral halls, collect odd bits of wishstuff
from the tideline, and are the people most likely to make a silly wish
just to see what happens.

## In the code (for the build plan)

Peoples are plain data in a new `packages/shared/src/races.ts`:
`{ id, name, home, lift: Partial<Stats>, trait }`. Traits are a closed list
the server knows how to apply. Wishes may not add a new people as content
data; a new people is an Engine wish (it needs a body for the animation
pipeline). See [callings-build-plan.md](callings-build-plan.md).
