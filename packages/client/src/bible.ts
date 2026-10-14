import { CREATURES, ITEMS, regionDef, ruleItemId, wishArtKey, type Character, type ContentEntry } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';
import { artSrc, contentEntries } from './wished.ts';

// The Bible's chapters. The docs stay the source of truth; these are the
// in-game editions until God's View can publish new versions to everyone.

export interface Chapter {
  id: string;
  title: string;
  html: (c: Character) => string;
}

const art = (id: string) => artSrc(id);

const STATUS: Record<string, string> = {
  pending: 'waiting for a Steward',
  approved: 'approved, to be built',
  rejected: 'not approved',
  'rolled-back': 'undone',
};

/** A rule is pictured by its first item (the fishing rod). */
function pictureKey(e: ContentEntry): string {
  const def = e.definition;
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
        <li><b>WASD</b> or the <b>arrow keys</b> to walk. Follow a road off the edge of a region to travel to the next.</li>
        <li><b>Enter</b> to speak. <i>Say</i> reaches those nearby; <i>World</i> reaches everyone.</li>
        <li><b>E</b> beside someone to talk to them. Some will ask for your help.</li>
        <li><b>E</b> with nobody nearby works the land: beside water, a tree or a rock. Wished rules (like fishing) use it; the Chronicle says how to play each one.</li>
      </ul>
      <h3>Fighting</h3>
      <ul>
        <li><b>Space</b> to strike the nearest creature. Walking Mushrooms only fight back; Crab Knights guard their sand; Sun Scarabs chase anyone they see.</li>
        <li>Health returns slowly once you are out of the fight. A <b>Tonic</b> restores it at once.</li>
        <li>If you fall, you wake at the Sanctum shrine with everything you carried, Weakened for a short while.</li>
      </ul>
      <h3>Your things</h3>
      <ul>
        <li><b>I</b> opens your bag. Click a Tonic to drink it.</li>
        <li><b>B</b> opens this book.</li>
        <li><b>Invite a friend</b> at the top makes a link only you can share.</li>
      </ul>
      <h3>Wishes</h3>
      <ul>
        <li><b>G</b> opens a prayer, anywhere in the world. Talk to the God, and ask for something new: a thing to carry, a creature to meet, someone to talk to.</li>
        <li>The God answers with a <b>wish card</b>: what will be made, where, and its cost in <b>Favor</b>. Grant it, or say not now.</li>
        <li>Bigger wishes (a new system, a new place) go to the Stewards first. The Chronicle in this book lists every wish.</li>
      </ul>
      <h3>Keeping the peace</h3>
      <ul>
        <li>Something in the world that should not be there? Press <b>Report</b> beside it in the Chronicle.</li>
        <li>A player making trouble? Type <b>/report</b>, their name and what happened in chat.</li>
        <li>The Stewards read every report.</li>
      </ul>`,
  },
  {
    id: 'style',
    title: 'The Style Bible',
    html: () => `
      <h2>The Style Bible</h2>
      <p>How the world looks, so everything made for it belongs together.</p>
      <ul>
        <li><b>Hand-painted 2D</b>, inspired by Legend of Mana: soft brushwork, warm light, storybook shapes.</li>
        <li><b>128 by 128 pixel tiles.</b> Ground tiles are flat, top-down and seamless, with even light.</li>
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
      <p>Wishes cost Favor: 2 for an item, 6 for a creature or a person. You begin with 10, earn 3 for each quest and 2 for each level, and 1 each time someone else defeats a creature you wished for.</p>
      <h3>Roles</h3>
      <ul>
        <li><b>The Owner</b> keeps the world and its budget.</li>
        <li><b>Stewards</b> are trusted players who review large wishes, roll back creations, read reports and can suspend troublemakers. The Owner names new Stewards by asking the God.</li>
        <li><b>Players</b> are everyone, and anyone can invite a friend.</li>
      </ul>
      <h3>Characters</h3>
      <p>Four stats: <b>Might</b> (strength and health), <b>Agility</b> (attack speed), <b>Wit</b> (magic and crafting) and <b>Spirit</b> (healing). Each level raises them all. There is no level cap.</p>`,
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
        const status = STATUS[e.status] ? ` <i>(${STATUS[e.status]})</i>` : '';
        const howTo = e.definition?.kind === 'rule' && e.status === 'granted' ? `<br><b>How:</b> ${escapeHtml(e.definition.howTo)}` : '';
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
          ? `<figure><img src="${art(d.art)}" alt=""><figcaption><b>${escapeHtml(d.name)}</b><br>${escapeHtml(d.description)}</figcaption></figure>`
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
