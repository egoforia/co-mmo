import { CALLINGS, PATH_SKILLS, callingWishesLeft, knowsPassive, pathOf, type Character, type PathChoice } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

// The Path in the browser (docs/classes.md, Progression; build plan step 7b):
// a Path mentor's choices in the dialogue window, and the Path, its passives
// and Calling Wishes on the character sheet.

/** The Path choices a mentor offers, as buttons in the dialogue window (data-path). */
export function pathChoicesHtml(npc: string, paths: PathChoice[]): string {
  return paths.map((p) => `
    <div class="offer path-choice"><b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.blurb)} You learn ${escapeHtml(p.skill)} at once.</span></div>
    <div class="buttons"><button type="button" data-path="${escapeHtml(p.id)}" data-npc="${escapeHtml(npc)}">${p.cost ? `Change to ${escapeHtml(p.name)} for ${p.cost} gold` : `Walk the ${escapeHtml(p.name)} Path`}</button></div>`).join('');
}

/** The character sheet's Path lines: the Path walked, its passives, and Calling Wishes held and used. */
export function pathSheetHtml(c: Character): string {
  if (!c.calling) return '';
  const path = pathOf(c.calling, c.path);
  const lines: string[] = [];
  if (path) {
    lines.push(`<li><b>${escapeHtml(path.name)} Path</b> ${escapeHtml(path.blurb)}</li>`);
    for (const s of path.skills) {
      const passive = PATH_SKILLS[s.skill]?.passive;
      if (passive && knowsPassive(c, s.skill)) lines.push(`<li><b>${escapeHtml(passive.name)}</b> ${escapeHtml(passive.description)}</li>`);
    }
  } else if (c.level >= 10) {
    lines.push(`<li>Your Path waits. Talk to ${escapeHtml(CALLINGS[c.calling].mentor)} in the Sanctum to begin your trial.</li>`);
  }
  for (const look of Object.values(c.skillLooks ?? {})) lines.push(`<li><b>${escapeHtml(look.name)}</b> ${escapeHtml(look.description)}</li>`);
  const left = callingWishesLeft(c);
  if (left) lines.push(`<li><b>${left === 1 ? 'A Calling Wish' : `${left} Calling Wishes`}</b> Pray and tell the God how one of your skills should look.</li>`);
  return lines.length ? `<h3>Path</h3><ul class="abilities">${lines.join('')}</ul>` : '';
}
