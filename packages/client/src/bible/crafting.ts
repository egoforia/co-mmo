import {
  CRAFTS,
  CRAFT_IDS,
  FINER_QUALITY,
  HOME_CRAFT_LEVEL,
  HOME_CRAFT_QUALITY,
  MASTERY_CHANGE_GOLD,
  MAX_CRAFT_LEVEL,
  MAX_MASTERIES,
  OPEN_CRAFT_LEVEL,
  QUALITY_MAX,
  QUALITY_MIN,
  RACES,
  REGROW_MS,
  SHOPS,
  SPOTS,
  UNIQUE_ITEMS,
  WORLD_REGIONS,
  craftLevel,
  isMastered,
  npcName,
  type CraftId,
} from '@co-mmo/shared';
import type { Chapter } from '../bible.ts';

// The in-game edition of docs/crafting.md. The tables come from the shared
// data (crafts.ts, gathering.ts, recipes.ts), so the book agrees with the game.

/** Who names masters of a craft. */
function masterOf(k: CraftId): string {
  const npc = Object.entries(SHOPS).find(([, s]) => s.masters?.includes(k))?.[0];
  return npc ? npcName(npc) : 'nobody yet';
}

/** Each land's gathering spots, by the biome they grow in. */
function spotsByLand(): string {
  return WORLD_REGIONS.map((r) => {
    const kinds = Object.values(SPOTS).filter((s) => s.biome === r.biome).map((s) => s.name);
    return kinds.length ? `<li><b>${r.name}:</b> ${kinds.join(', ')}.</li>` : '';
  }).join('');
}

export const CRAFTING_CHAPTER: Chapter = {
  id: 'crafting',
  title: 'Gathering and Crafting',
  html: (c) => `
    <h2>Gathering and Crafting</h2>
    <p>Everything worth wearing was made by someone. Gather what the lands give, work it into gear, and your name goes on every piece you make.</p>
    <h3>The seven crafts</h3>
    <table>
      <tr><th>Craft</th><th>Works</th><th>Tool</th><th>Peoples at home in it</th><th>Master</th><th>You</th></tr>
      ${CRAFT_IDS.map((k) => `<tr><td>${CRAFTS[k].name}</td><td>${CRAFTS[k].families.join(', ')}</td><td>${CRAFTS[k].tool}</td>
        <td>${CRAFTS[k].peoples.map((p) => RACES[p].name).join(', ')}</td><td>${masterOf(k)}</td>
        <td>level ${craftLevel(c, k)}${isMastered(c, k) ? ', master' : ''}</td></tr>`).join('')}
    </table>
    <ul>
      <li><b>Levels:</b> each craft runs from 1 to ${MAX_CRAFT_LEVEL} and grows as you gather and make things in it. Easy work far below your level teaches little.</li>
      <li><b>Mastery:</b> anyone can reach level ${OPEN_CRAFT_LEVEL}. Past that you must be a master, and you may master ${MAX_MASTERIES} crafts. Ask the craft's master. Giving one up for another costs ${MASTERY_CHANGE_GOLD} gold, and the old craft falls back to level ${OPEN_CRAFT_LEVEL}.</li>
      <li><b>Your people:</b> your home crafts start at level ${HOME_CRAFT_LEVEL}, make things ${HOME_CRAFT_QUALITY} points finer, and you are given their first tools.</li>
      <li><b>Tools:</b> every craft needs its tool in your bag. Tools come common, fine and master's; finer tools make finer things and gather rarer materials. Masters sell the first two; smiths make all three. Tools wear out in time.</li>
    </ul>
    <h3>Gathering</h3>
    <p>Bushes, veins, driftwood and more stand in every land. Walk up with the right tool and press <b>E</b>. It takes a moment; a hit or a step away stops it. Each spot grows back for you about ${Math.round(REGROW_MS / 60_000)} minutes after you gather it, whoever else has been there. The Cervid feel spots from afar: they show on their map.</p>
    <ul>${spotsByLand()}</ul>
    <h3>Recipes</h3>
    <p>Open your crafting book with <b>C</b>. Recipes come in three tiers:</p>
    <ul>
      <li><b>Common:</b> one land's materials. The Sanctum's count for any land.</li>
      <li><b>Rare:</b> materials from two or three lands.</li>
      <li><b>Unique:</b> a key item only a great foe gives, and a master's hand: ${Object.values(UNIQUE_ITEMS).map((d) => d.name).join(', ')}. A unique piece binds to whoever first wears it.</li>
    </ul>
    <h3>What you make</h3>
    <p>Everything you make carries "Tailored by" and your name. Its quality, from ${QUALITY_MIN}% to ${QUALITY_MAX}%, sizes its bonus: it comes from your level in the craft, your Wit, your tool, your people and a little luck. Only a master's work goes highest, and a piece of ${FINER_QUALITY}% or more is a rarity finer than usual. Shops sell their gear at 100%, made by the shopkeeper.</p>`,
};
