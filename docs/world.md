# The world of Wishmere

This is the story the game tells: where the world came from, who the God is,
why the land is the way it is, and how players fit in. The God, the people
in the world and every wish draw on it, so wished content should agree with
it. Drafted with egoforia on 2026-10-27. **Wishmere** is a working name; the
Owner may rename the world.

The story grows the way the world does. Wishes add new places, people and
history, and a granted wish that adds to the story becomes part of it. This
page holds the parts the launch world is built on.

## In one breath

Long ago an old God, the Listener, granted every wish it heard. Some wishes
went badly wrong, and the Listener fell silent. That long silence is the
**Hush**, and in it the world began to forget itself. Now a young God has
woken at the Sanctum shrine, born from the first new wish in an age. It is
small, warm and curious, and it grows only from what people wish for.
Players are **Wishbearers**: people who hear the young God and carry their
wishes to it, and who take up the old Callings to keep the waking world safe.

## The Listener and the old wishes

The Listener had no temple and no rules. It granted whatever it heard,
great or small, kind or cruel. For a long age that was a blessing: rivers
moved, forests grew overnight, and the five peoples (see
[races.md](races.md)) each began with a wish.

Then came the wishes that broke things:

- **Mossgate's war wish.** The knights of Mossgate wished for an army that
  would never tire. The Listener grew them one from bark and moss. The
  golems won the war, and in the Hush they forgot whom they served. Mossgate
  fell, and Sir Alder is its last knight.
- **The Sun King's wish.** A king of the desert wished to rule forever. He
  died anyway, and his guards still walk out of the tomb every night, still
  keeping a reign that ended long ago.
- **The Chained Demon.** Someone, nobody knows who, wished for a power
  that could end any war. What came was the Chained Demon. Priests of the
  High Cathedral bound it under the earth with celestial runes. The runes
  hold, for now.

After the Chained Demon, the Listener stopped answering. Some say it was
ashamed; some say it simply wore out. Nobody knows.

## The Hush

The Hush is what the world has been like since. Without a God listening,
things slowly lose hold of why they exist. A golem forgets its master; a
road forgets where it leads; a song is half remembered. The Hush is not a
monster or a villain. It is forgetting, and it is the quiet threat behind
every quest: creatures that lost their purpose, places nobody remembers,
old orders with no one left to join them.

The Hush never takes what people remember and care for. That is why
players' quests often end with a promise kept, a gate opened or a name
spoken again.

## Wishstuff

Half-granted wishes did not vanish. They left **wishstuff**: a faint,
shimmering residue that settles in the land like dew. Wishstuff is why
mushrooms sometimes stand up and walk, why scarabs shine like little suns,
and why the crab knights of the shore hold their lances with such
ceremony. Each began as part of someone's old wish.

Wishweavers (see [classes/wishweaver.md](classes/wishweaver.md)) draw on
wishstuff to cast their spells. Creatures born of it carry a little, which
is why their bodies can be searched for materials worth crafting with.

## The young God

The young God woke at the shrine in the Sanctum when someone made the
first new wish in an age. Sister Amala, the shrine's keeper, was waiting for
it ("Speak your wishes at the shrine, once it wakes"). The young God has no
name yet. It is warm, a little grand and playful, and it never talks long.
It remembers what the Listener did and is careful, but it is not afraid.

Unlike the Listener, the young God weighs each wish:

- **It grows from wishes.** Every granted wish makes the world, and the God,
  a little bigger. Brother Tolle hears it in the temple bells: every bell
  rings for a wish someone made.
- **It asks something back.** Wishes cost **Favor**, earned by helping the
  world: quests, levels and wishes others enjoy. This is the lesson of the
  Listener: a wish that costs nothing can undo the world.
- **It refuses some wishes.** It will not grant wishes that hurt other
  Wishbearers, break the world's fairness, or are against the law. It never
  grants great power outright; Epic and Legendary gear is earned, never
  wished.
- **Its wishes can be unmade.** Stewards can put a wish to sleep or undo it.
  In the story, that is the young God taking a wish back before it goes the
  way of Mossgate.

## The Wishbearers and the Callings

Players arrive at the Sanctum as Wishbearers. Anyone the young God can hear
can become one, from any of the five peoples.

To protect the waking world, Wishbearers take up one of five **Callings**:
old orders that were nearly lost to the Hush and now live again through
them. Each Calling has a mentor in the Sanctum and an old home out in the
world where its deeper Paths are learned (see [classes.md](classes.md)).

| Calling | The old order | Old home |
| --- | --- | --- |
| Warden | The knights of Mossgate, who held the gate | Mossgate, Whispering Woods (Sir Alder) |
| Duelist | The Sun-court blades who guarded the desert rulers | The Mirage Palace (Sultana Zahra) |
| Ranger | The wind-watchers who kept the high paths | The Sky Ruins |
| Wishweaver | The scholars of wishstuff, who traded pearls for secrets | The coral halls of the Sunlit Shore (Queen Nerissa) |
| Bellkeeper | The temple order that rings for every wish | The Temple of the Hundred Bells (Brother Tolle) |

## Places

The launch world is laid out as a grid around the Sanctum
(`WORLD_REGIONS` in `packages/shared/src/world.ts`):

- **The Sanctum** at the centre: the young God's shrine, Sister Amala, and
  the five Calling mentors. Every Wishbearer starts here and wakes here
  after falling.
- **Whispering Woods** to the west: home of the Ursine. Thorn wolves, and the
  bark golems on the road to Mossgate Castle.
- **Sunlit Shore** to the east: home of the Lutran. The crab knights, and
  Queen Nerissa's coral halls under the waves.
- **Mirage Desert** to the south: home of the Scorpid. Sun scarabs, the Sun
  King's tomb, the Mirage Palace and Sultana Zahra, and the High Cathedral
  with its crypts and the Chained Demon below.

Biomes that are not yet in the world, ready for wished regions
(`packages/shared/src/biomes.ts`): Verdant Meadows, Mushroom Hollow (home of
the Cervid), Frostpeak and the Sky Ruins (home of the Falcon), Ember Wastes
and Murkmire Swamp. A region wished at the world's edge is the young God
remembering a place the Hush took, or dreaming a new one.

## Tone

- Cosy, mythic fantasy with real danger and real sadness under it. The Hush
  is melancholy, not grimdark. The game is for adults (18+) and may be
  mature, but it is never cruel for its own sake.
- Wonder first: odd creatures are strange and a little funny before they
  are frightening.
- The past is told through people and places (a knight, a tomb, a bell),
  never through long lore dumps.
- The young God speaks warmly, briefly and in the first person (see
  `co-mmo-player-words`).

### Rules for wished content

When the God shapes a wish, it keeps to the story:

- New creatures come from the Hush (things that forgot their purpose), from
  wishstuff (odd beings made of old wishes), or from their biome's nature.
- New people know the young God is new. Old people remember the Listener.
- A wish may add history, but must not erase the five peoples, the
  Callings, the Listener, the Hush or the young God.
- A wish for a "new class" becomes a new Path or skill inside a Calling, or
  a Major wish for the Stewards to review (see [classes.md](classes.md)).
