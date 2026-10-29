import { CREATURES, ITEMS, RARITIES, REGION_WISH_COST, bonusText, regionDef, ruleItemId, standing, wishArtKey, type Character, type ContentEntry } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';
import { artSrc, contentEntries } from './wished.ts';
import { LORE_CHAPTERS } from './bible/lore.ts';

// The Bible's chapters. The docs stay the source of truth; these are the
// in-game editions until God's View can publish new versions to everyone.

export interface Chapter {
  id: string;
  title: string;
  html: (c: Character) => string;
}

const art = (id: string) => artSrc(id);

const RARITY_NAMES = Object.fromEntries(RARITIES.map((r) => [r, r[0]!.toUpperCase() + r.slice(1)])) as Record<string, string>;

const PROGRESS_ICON: Record<string, string> = { 'in-progress': '⏳', 'needs-input': '✋', error: '✗', done: '', closed: '' };

/** Where a wish stands, e.g. "(⏳ The God is drafting a rule)", with why underneath when it matters. */
function progress(e: ContentEntry): string {
  const p = e.progress;
  if (!p || p.state === 'done') return '';
  const detail = p.detail && (p.state === 'error' || p.state === 'needs-input') ? `<br><span class="why">${escapeHtml(p.detail)}</span>` : '';
  return ` <i class="progress ${p.state}">(${PROGRESS_ICON[p.state] ? `${PROGRESS_ICON[p.state]} ` : ''}${escapeHtml(p.label)})</i>${detail}`;
}

/** A rule is pictured by its first item (the fishing rod), a recipe by what it makes. */
function pictureKey(e: ContentEntry): string {
  const def = e.definition;
  if (def?.kind === 'recipe') return ITEMS[def.result.item]?.art ?? 'item-scroll';
  // A region is shown by the first creature that lives there.
  if (def?.kind === 'region') return regionDef(e.id)?.wild?.creatures[0]?.asset ?? 'sanctum-shrine';
  // Loot is shown by the creature that drops it.
  if (def?.kind === 'loot') return CREATURES[def.creature]?.art ?? 'woods-mushroom';
  const first = def?.kind === 'rule' ? Object.keys(def.items)[0] : undefined;
  return wishArtKey(first ? ruleItemId(e.id, first) : e.id);
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'first-steps',
    title: 'First Steps',
    html: () => `
      <h2>First Steps</h2>
      <p>Welcome to the world. It is young, and it grows from what its people wish for.</p>
      <h3>Moving and talking</h3>
      <ul>
        <li><b>WASD</b> or the <b>arrow keys</b> to walk. The regions join up into one land: walk off an edge where you can see the next region and you step straight into it.</li>
        <li><b>Enter</b> to speak. <i>Say</i> reaches those nearby, <i>Region</i> everyone in this region, <i>Party</i> your party, <i>World</i> everyone. <b>/w</b> and a name whispers to one player; <b>/r</b> answers. Type <b>/help</b> for the rest.</li>
        <li><b>/invite</b> and a name asks someone into your party. A party shares the XP of every creature its members defeat together, and their defeat quests.</li>
        <li><b>Account</b> (top right) adds an email or Google/GitHub to sign in from any device, and is where you describe your look if you have not yet.</li>
        <li><b>E</b> beside someone to talk to them. Some will ask for your help. People keep a day: at work by day, out in the square at dusk, asleep at night. Wake them and they will still talk and trade.</li>
        <li>Days turn into nights, and each land has its own weather. The corner of the screen says the hour and the sky.</li>
        <li>Every land is wide, and its roads lead out from the middle to great places: a temple, caves, a castle, palaces, a tomb, a pyramid and more. Follow a road, or leave it and explore. Bridges carry the roads over water.</li>
        <li><b>E</b> with nobody nearby works the land: beside water, a tree or a rock. Wished rules (like fishing) use it; the Chronicle says how to play each one.</li>
      </ul>
      <h3>Fighting</h3>
      <ul>
        <li><b>Space</b> to strike the nearest creature. Walking Mushrooms only fight back, and scurry off when badly hurt; Crab Knights walk their rounds on the sand; Sun Scarabs hunt in packs, so when one comes for you the others near it follow.</li>
        <li>Creatures keep hours. Sun Scarabs sleep at night, and some wished creatures only come out after dark. A sleeping creature wakes if you strike it.</li>
        <li>The great places have creatures of their own: Thorn Wolves and Dune Jackals hunt in packs at night, Bark Golems and the Sand Wyrm guard their ground, Mummy Guards and Drowned Deckhands walk their rounds after dark, and Lantern Moths and Hermit Crabs only run away.</li>
        <li>In the dark, in fog and in sandstorms, most creatures only notice you up close. Carry a torch or anything else that glows and they see you coming.</li>
        <li>Health returns slowly once you are out of the fight. A <b>Tonic</b> restores it at once.</li>
        <li>If you fall, you wake at the Sanctum shrine with everything you carried, Weakened for a short while.</li>
        <li><b>1</b> to <b>6</b> use your abilities; <b>K</b> opens your spellbook to choose which. Your Calling teaches you a skill at levels 1, 2, 4, 6 and 8. Each costs <b>Energy</b> (the blue bar), which comes back by itself, and rests a few seconds after use. Old Bramble teaches Power Strike when you help her, Sister Amala teaches Mend for a little gold, and the Cactus Elder sells the Scroll of Firebolt.</li>
      </ul>
      <h3>Your things</h3>
      <ul>
        <li><b>I</b> opens your bag. Click a Tonic to drink it, a weapon, hat, coat or charm to wear it, and a scroll to learn what it teaches. Click what you wear to take it off.</li>
        <li><b>E</b> beside a defeated creature searches its body, which lies there for five minutes. Each kind carries its own finds, each with its own chance, kept for whoever won the fight and their party.</li>
        <li><b>C</b> opens the crafting book. Creatures drop materials (mushroom caps, crab shells, scarab wing cases) that become Tonics and gear. Finer things need more Wit.</li>
        <li><b>Trade</b> with Marina on the Shore or the Cactus Elder in the desert to buy, and to sell what you found. Sister Amala gives lessons.</li>
        <li><b>/trade</b> and a name trades with a player close by. You both put things and gold on the table; nothing changes hands until you both agree.</li>
        <li><b>B</b> opens this book.</li>
        <li><b>Invite a friend</b> at the top makes a link only you can share.</li>
      </ul>
      <h3>Wishes</h3>
      <ul>
        <li><b>G</b> opens a prayer, anywhere in the world. Talk to the God, and ask for something new: a thing to carry, a creature to meet, someone to talk to.</li>
        <li>The God answers with a <b>wish card</b>: what will be made, where, and its cost in <b>Favor</b>. Grant it, or say not now.</li>
        <li>You can wish for gear to wear, a new crafting recipe, or a new ability (it comes as a scroll you can read, sell or give away).</li>
        <li>At the edge of the world, you can wish for a whole <b>new region</b> beyond it: snowy peaks, ember wastes, a mushroom hollow, a swamp, sky ruins, meadows or more of a land you know. Say how wild and dangerous it is and what lives there; a road leads into it at once, and everyone who walks in learns that you wished it.</li>
        <li>Bigger wishes (a new system, a town, a dungeon) go to the Stewards first. The Chronicle in this book lists every wish.</li>
      </ul>
      <h3>Keeping the peace</h3>
      <ul>
        <li>Something in the world that should not be there? Press <b>Report</b> beside it in the Chronicle.</li>
        <li>A player making trouble? Type <b>/report</b>, their name and what happened in chat.</li>
        <li>The Stewards read every report.</li>
      </ul>`,
  },
  ...LORE_CHAPTERS,
  {
    id: 'style',
    title: 'The Style Bible',
    html: () => `
      <h2>The Style Bible</h2>
      <p>How the world looks, so everything made for it belongs together.</p>
      <ul>
        <li><b>Flat-faceted 2D isometric art</b>: crisp geometric planes, clean shapes, and warm dynamic light.</li>
        <li><b>128 by 128 pixel tiles.</b> Ground tiles are flat and seamless, projected onto isometric diamonds with even light.</li>
        <li><b>Each biome has its own colours</b> and light: the pale gold Sanctum, the deep green Whispering Woods, the turquoise Sunlit Shore, the amber Mirage Desert.</li>
        <li><b>Characters and creatures</b> are drawn three-quarter view, a little round and friendly, with a clear silhouette.</li>
        <li><b>No writing</b> appears inside the art.</li>
        <li><b>Motion</b> comes from the engine first (bobbing, squash, lunges), painted frames later.</li>
      </ul>
      <p>The full Style Bible lives with the Owner, and every new picture is checked against it.</p>`,
  },
  {
    id: 'making',
    title: 'The Book of Making',
    html: () => `
      <h2>The Book of Making</h2>
      <p>How this world is made, and who makes it.</p>
      <h3>Wishes</h3>
      <p>Any player can speak a wish to the God, anywhere. Small wishes (a new item, a creature, a place) become content the moment they are granted. Larger wishes that change the rules wait for a Steward.</p>
      <h3>New rules</h3>
      <p>A wish for a new thing to do (fishing, foraging, a blessing at a shrine) becomes a <b>scripted rule</b>. The God drafts it, tries it in a copy of the world, and a Steward reads it before it goes live. Rules can only act through the world's own building blocks (items, health, gold, XP, messages), with limits on how much they give, and a rule that misbehaves stops itself.</p>
      <h3>Favor</h3>
      <p>Wishes cost Favor: 2 for an item or a recipe, 6 for a creature, a person or an ability, ${REGION_WISH_COST} for a new region. You begin with 10, earn 3 for each quest and 2 for each level.</p>
      <h3>Creator XP</h3>
      <p>When other players fight what you wished for, talk to it, wear it, use it, craft with it, learn from it or walk into the land you wished, you earn <b>Creator XP</b>. Each Creator level brings 3 Favor, so making things people love pays for more wishes.</p>
      <h3>Gear</h3>
      <p>Weapons, hats, coats and charms add to your stats, damage and armour. Rarity runs from Common through Uncommon, Rare and Epic to Legendary. The world sets how strong wished gear is from its rarity; wishes reach Rare at most, and the rest must be earned.</p>
      <h3>Roles</h3>
      <ul>
        <li><b>The Owner</b> keeps the world and its budget.</li>
        <li><b>Stewards</b> are trusted players who review large wishes, switch any wish off and on again or undo it, read reports and can suspend troublemakers. The Owner names new Stewards by asking the God.</li>
        <li><b>Players</b> are everyone, and anyone can invite a friend.</li>
      </ul>
      <h3>Characters</h3>
      <p>Four stats: <b>Might</b> (strength and health), <b>Agility</b> (attack speed), <b>Wit</b> (magic, Energy and crafting) and <b>Spirit</b> (healing, and Energy coming back). Each level raises them all. There is no level cap.</p>`,
  },
  {
    id: 'chronicle',
    title: 'The Chronicle',
    html: () => {
      const list = contentEntries();
      const lines = list.map((e) => {
        const when = new Date(e.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        const where = regionDef(e.regionId)?.name ?? e.regionId;
        const pic = e.definition && e.status === 'granted' ? `<img src="${escapeHtml(art(pictureKey(e)))}" alt="">` : '<div class="mystery">✦</div>';
        const status = progress(e);
        const howTo = e.definition?.kind === 'rule' && standing(e) ? `<br><b>How:</b> ${escapeHtml(e.definition.howTo)}` : '';
        const report = e.status === 'granted' ? ` <button type="button" class="report" data-report="${escapeHtml(e.id)}" data-title="${escapeHtml(e.title)}">Report</button>` : '';
        return `<figure${e.status === 'granted' ? '' : ' class="unknown"'}>${pic}<figcaption><b>${escapeHtml(e.title)}</b>${status}<br>${escapeHtml(e.summary)}${howTo}<br><small>Wished by ${escapeHtml(e.wisher.name)} in ${escapeHtml(where)}, ${when}</small>${report}</figcaption></figure>`;
      });
      return `
      <h2>The Chronicle</h2>
      <p>Every wish is written here, newest first, with who wished it and where.</p>
      ${lines.length ? `<div class="entries chronicle">${lines.join('')}</div>` : '<p class="empty">The pages are still blank. Press G and make the first wish.</p>'}`;
    },
  },
  {
    id: 'bestiary',
    title: 'Bestiary and Armoury',
    html: (c) => {
      const creatures = Object.entries(CREATURES).map(([id, d]) =>
        c.discovered.includes(id)
          ? `<figure><img src="${art(d.art)}" alt=""><figcaption><b>${escapeHtml(d.name)}</b> · level ${d.level}<br>${escapeHtml(d.description)}</figcaption></figure>`
          : `<figure class="unknown"><div class="mystery">?</div><figcaption><b>Not yet met</b></figcaption></figure>`,
      );
      const items = Object.entries(ITEMS).map(([id, d]) =>
        c.discovered.includes(id)
          ? `<figure><img src="${art(d.art)}" alt=""><figcaption><b>${escapeHtml(d.name)}</b>${d.rarity ? ` · <i>${RARITY_NAMES[d.rarity]}</i>` : ''}<br>${escapeHtml(d.description)}${d.bonus ? `<br><small>${escapeHtml(bonusText(d.bonus))}</small>` : ''}</figcaption></figure>`
          : `<figure class="unknown"><div class="mystery">?</div><figcaption><b>Not yet found</b></figcaption></figure>`,
      );
      return `
        <h2>Bestiary</h2>
        <p>Creatures you have defeated.</p>
        <div class="entries">${creatures.join('')}</div>
        <h2>Armoury</h2>
        <p>Things you have found.</p>
        <div class="entries">${items.join('')}</div>`;
    },
  },
];
