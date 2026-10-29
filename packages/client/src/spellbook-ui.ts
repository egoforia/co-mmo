import { ABILITIES, CALLING_SKILLS, HOTBAR_SIZE, type Character } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

const $ = (id: string) => document.getElementById(id)!;

/**
 * The spellbook (K): every ability the character knows, Calling skills
 * first, with keys 1 to 6 to put each on. The new layout is sent to the
 * server, which checks it and saves it on the character.
 */
export class SpellbookUi {
  private character: Character;

  constructor(character: Character, private readonly arrange: (slots: string[]) => void) {
    this.character = character;
    $('spellbook').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) return this.toggle(false);
      const button = target.closest<HTMLElement>('[data-skill]');
      if (button) this.place(button.dataset.skill!, Number(button.dataset.key));
    });
  }

  setCharacter(character: Character): void {
    this.character = character;
    if (!$('spellbook').hidden) this.render();
  }

  toggle(open?: boolean): void {
    const el = $('spellbook');
    el.hidden = !(open ?? el.hidden);
    if (!el.hidden) this.render();
  }

  /** Puts a skill on a key (0 takes it off), moving it from any key it was on. */
  private place(id: string, key: number): void {
    const slots = Array.from({ length: HOTBAR_SIZE }, (_, i) => this.character.hotbar[i] ?? '');
    for (let i = 0; i < slots.length; i++) if (slots[i] === id) slots[i] = '';
    if (key >= 1 && key <= HOTBAR_SIZE) slots[key - 1] = id;
    this.arrange(slots);
  }

  private render(): void {
    const c = this.character;
    const known = c.abilities.filter((a) => ABILITIES[a]);
    const order = [...known.filter((a) => CALLING_SKILLS[a]), ...known.filter((a) => !CALLING_SKILLS[a])];
    const rows = order.map((id) => {
      const a = ABILITIES[id]!;
      const on = c.hotbar.indexOf(id) + 1;
      const keys = Array.from({ length: HOTBAR_SIZE }, (_, i) => i + 1)
        .map((k) => `<button type="button" class="key${k === on ? ' on' : ''}" data-skill="${escapeHtml(id)}" data-key="${k}" title="Put it on key ${k}">${k}</button>`)
        .join('');
      const off = on ? `<button type="button" class="quiet" data-skill="${escapeHtml(id)}" data-key="0">Take off</button>` : '';
      const kind = CALLING_SKILLS[id] ? 'Calling skill' : 'Common technique';
      return `<li><b>${escapeHtml(a.name)}</b> <small>${kind}</small>
        <span class="info">${escapeHtml(a.description)} ${a.energy} Energy, rests ${a.cooldown} s.</span>
        <span class="keys">${keys}${off}</span></li>`;
    }).join('');
    $('spellbook').innerHTML = `
      <h2>Spellbook <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <p class="note">Choose what sits on keys 1 to ${HOTBAR_SIZE}. Your Calling teaches you a new skill at levels 2, 4, 6 and 8.</p>
      ${rows ? `<ul class="rows">${rows}</ul>` : '<p class="note">No abilities yet. Trainers, scrolls and quests teach them.</p>'}`;
  }
}
