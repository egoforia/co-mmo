import { CALLINGS, CALLING_IDS, OFFHAND_FAMILIES, pathSkillName, RACES, RACE_IDS, WEAPON_FAMILIES, type CallingId, type Stats } from '@co-mmo/shared';
import type { Chapter } from '../bible.ts';

// The in-game editions of docs/world.md, races.md, attributes.md, classes.md
// and classes/*.md. The tables come from the shared data, so the book always
// agrees with the game; the story is retold in a few lines.

const STAT_NAMES: Record<keyof Stats, string> = { might: 'Might', agility: 'Agility', wit: 'Wit', spirit: 'Spirit', vigor: 'Vigor' };

const lift = (l: Partial<Stats>) => (Object.keys(l) as (keyof Stats)[]).map((k) => `${STAT_NAMES[k]} +${l[k]}`).join(', ');

/** Each old order's story, and the trial at the end of its road (docs/classes/*.md). */
const CALLING_STORY: Record<CallingId, { story: string; home: string; trial: string }> = {
  warden: {
    story: 'The knights of Mossgate, sworn to hold its gate for whoever needed shelter. They stood against the tireless army Mossgate wished for, and lost. Sir Alder is the last of them, still keeping a gate with nothing left behind it.',
    home: 'Mossgate, in the Whispering Woods',
    trial: '<i>The Gate Holds</i>: hold Mossgate\'s gate against waves of bark golems beside Sir Alder.',
  },
  duelist: {
    story: 'The Sun-court blades who guarded the desert\'s rulers. When the Sun King wished to rule forever, they would not follow him into his tomb. Sultana Zahra still trains a few, and says a Duelist\'s real weapon is timing.',
    home: 'The Mirage Palace, in the Mirage Desert',
    trial: '<i>Sun and Sand</i>: duel Zahra\'s champion, then lay four of the Sun King\'s guards to rest without falling.',
  },
  ranger: {
    story: 'The wind-watchers who kept the high paths between the peoples. When the Hush came there was nothing to see, only a slow forgetting, and their towers emptied one by one. They believe watching again is how it ends.',
    home: 'The Sky Ruins',
    trial: '<i>The Last Tower</i>: keep watch from a ruined tower through a night, then name what you saw.',
  },
  wishweaver: {
    story: 'Scholars of wishstuff, who traded pearls for secrets in Queen Nerissa\'s coral halls. They were the first to know the Listener had gone silent, because the threads stopped coming. Now new wishstuff settles again.',
    home: 'The coral halls under the Sunlit Shore',
    trial: '<i>Threads in the Tide</i>: gather three kinds of wishstuff along the shore and weave them before the Queen.',
  },
  bellkeeper: {
    story: 'The order of the Temple of the Hundred Bells, whose bells ring for every wish. In the Hush the bells fell quiet and only Brother Tolle stayed. The morning the young God woke, every bell rang at once.',
    home: 'The Temple of the Hundred Bells',
    trial: '<i>The Silent Bell</i>: carry a cracked bell to the crypts below the High Cathedral and ring it where the Hush is thickest.',
  },
};

/** One Calling's page: its story, what it fights with, and its two Paths. */
function callingSection(id: CallingId): string {
  const c = CALLINGS[id];
  const s = CALLING_STORY[id];
  const gear = [...c.weapons.map((w) => WEAPON_FAMILIES[w].name), ...c.offhands.map((o) => `${OFFHAND_FAMILIES[o].name} (off hand)`)].join(', ');
  return `
    <h3>${c.name}: ${c.role}</h3>
    <p>${c.blurb}</p>
    <p>${s.story}</p>
    <ul>
      <li><b>Attributes:</b> ${STAT_NAMES[c.primary]} first, then ${STAT_NAMES[c.secondary]}.</li>
      <li><b>Trained with:</b> ${gear}.</li>
      <li><b>Gauge:</b> ${c.gauge.name}.</li>
      <li><b>Mentors:</b> ${c.mentor} in the Sanctum; ${c.pathMentor} at ${s.home}.</li>
      <li><b>Trial at level 10:</b> ${s.trial}</li>
      <li><b>Paths:</b> ${c.paths.map((p) => `<b>${p.name}</b>, ${p.blurb.charAt(0).toLowerCase()}${p.blurb.slice(1)} ${p.skills.map((k) => `${pathSkillName(k.skill)} at ${k.level}`).join(', ')}.`).join(' Or ')}</li>
    </ul>`;
}

export const LORE_CHAPTERS: Chapter[] = [
  {
    id: 'world',
    title: 'The World of Wishmere',
    html: () => `
      <h2>The World of Wishmere</h2>
      <p>Long ago an old God, the <b>Listener</b>, granted every wish it heard. Some wishes went badly wrong, and the Listener fell silent. Now a young God has woken at the Sanctum shrine, and it grows only from what people wish for.</p>
      <h3>The old wishes</h3>
      <ul>
        <li><b>Mossgate's war wish.</b> The knights of Mossgate wished for an army that would never tire. The Listener grew one from bark and moss. It won the war, then forgot whom it served.</li>
        <li><b>The Sun King's wish.</b> A desert king wished to rule forever. He died anyway, and his guards still walk out of his tomb every night.</li>
        <li><b>The Chained Demon.</b> Someone wished for a power that could end any war. What came was bound beneath the High Cathedral with celestial runes. They hold, for now.</li>
      </ul>
      <h3>The Hush</h3>
      <p>Since the Listener fell silent, the world has been slowly forgetting itself. A golem forgets its master; a road forgets where it leads. The Hush is not a monster. It is forgetting, and it never takes what people remember and care for.</p>
      <h3>Wishstuff</h3>
      <p>Half-granted wishes left a faint, shimmering residue in the land. It is why mushrooms sometimes walk and scarabs shine like little suns. Wishweavers cast with it, and creatures born of it carry a little.</p>
      <h3>The young God</h3>
      <p>The young God has no name yet. It remembers what the Listener did, so it weighs each wish: it asks <b>Favor</b> in return, refuses wishes that would hurt others or break the world, and never grants great power outright. Stewards can put a wish to sleep, or undo it.</p>
      <h3>Wishbearers</h3>
      <p>You are a Wishbearer: someone who hears the young God and carries wishes to it. Wishbearers come from all five peoples and take up the five old Callings to keep the waking world safe.</p>`,
  },
  {
    id: 'peoples',
    title: 'The Five Peoples',
    html: () => `
      <h2>The Five Peoples</h2>
      <p>Every Wishbearer belongs to one of five beastfolk peoples, each begun with a wish. A people shapes how you look and lifts two attributes a little. It never limits your Calling.</p>
      ${RACE_IDS.map((id) => {
        const r = RACES[id];
        return `<h3>${r.name}</h3><p>${r.blurb}</p><ul><li><b>Home:</b> ${r.home}.</li><li><b>Lift:</b> ${lift(r.lift)}.</li><li><b>${r.traitName}:</b> ${r.traitText}</li></ul>`;
      }).join('')}
      <p>Changing your people later is a wish to the God.</p>`,
  },
  {
    id: 'attributes',
    title: 'The Five Attributes',
    html: () => `
      <h2>The Five Attributes</h2>
      <p>Five attributes sit in a ring: Might, Agility, Wit, Spirit and Vigor, and back to Might. Each Calling builds on two neighbours; each people lifts two that are not.</p>
      <ul>
        <li><b>Might</b>: heavy weapons hit harder, shields block more, and big blows can stagger.</li>
        <li><b>Agility</b>: light and ranged weapons hit harder, you strike faster, land more critical hits and dodge.</li>
        <li><b>Wit</b>: spells hit harder, more Energy, shorter cooldowns, and finer crafting.</li>
        <li><b>Spirit</b>: stronger healing, faster Energy and health, and defence against magic.</li>
        <li><b>Vigor</b>: more health, more armour, and harmful effects wear off sooner.</li>
      </ul>
      <h3>How they grow</h3>
      <p>You start with 3 in each. Your people adds 1 to two of them, and your Calling adds 3 to its first attribute and 2 to its second. Each level after the first adds 1 to both, plus one free point you place yourself.</p>`,
  },
  {
    id: 'callings',
    title: 'The Five Callings',
    html: () => `
      <h2>The Five Callings</h2>
      <p>The Callings are old orders the Hush nearly took, living again through Wishbearers. Any people can take any Calling. Each has a mentor in the Sanctum and an old home out in the world, where at level 10 its trial opens one of two Paths.</p>
      ${CALLING_IDS.map(callingSection).join('')}`,
  },
];
