import type { GodMessage, WishCard } from '@co-mmo/shared';
import { escapeHtml, isTyping } from './ui.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface PrayerActions {
  pray(text: string): void;
  answer(card: string, confirm: boolean): void;
}

const TIER_NAMES: Record<WishCard['tier'], string> = {
  minor: 'Minor wish',
  moderate: 'Moderate wish',
  major: 'Major wish',
  engine: 'A wish beyond the world',
  refused: 'Refused',
};

/** The prayer window: talk to the God from anywhere, and confirm wish cards. */
export class PrayerUi {
  private readonly log: HTMLOListElement;
  private readonly input: HTMLInputElement;
  private waiting = false;
  private favor = 0;

  constructor(private readonly actions: PrayerActions) {
    const el = $('prayer');
    el.innerHTML = `
      <h2><span>Prayer <small id="prayer-favor"></small></span><button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <ol id="prayer-log" aria-live="polite">
        <li class="god">Speak, and I will listen. Ask me anything, or wish for something new: a thing to carry, a creature to meet, someone to talk to.</li>
      </ol>
      <form id="prayer-form" autocomplete="off">
        <input id="prayer-input" maxlength="400" placeholder="I wish for..." />
        <button type="submit">Pray</button>
      </form>`;
    this.log = $('prayer-log') as HTMLOListElement;
    this.input = $('prayer-input') as HTMLInputElement;
    $('prayer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text || this.waiting) return;
      this.input.value = '';
      this.add('you', text);
      this.setWaiting(true);
      actions.pray(text);
    });
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) return this.toggle(false);
      const button = target.closest<HTMLButtonElement>('[data-card]');
      if (!button) return;
      const confirm = button.dataset.confirm === 'yes';
      actions.answer(button.dataset.card!, confirm);
      const card = button.closest('.card')!;
      card.classList.add(confirm ? 'confirmed' : 'declined');
      for (const b of card.querySelectorAll('button')) b.disabled = true;
      if (confirm) this.setWaiting(true);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) {
        this.input.blur();
        this.toggle(false);
      } else if (e.key.toLowerCase() === 'g' && !isTyping() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  get open(): boolean {
    return !$('prayer').hidden;
  }

  toggle(open?: boolean): void {
    const el = $('prayer');
    el.hidden = !(open ?? el.hidden);
    document.querySelector('[data-open="prayer"]')?.classList.remove('calling');
    if (!el.hidden) {
      this.log.scrollTop = this.log.scrollHeight;
      this.input.focus();
    }
  }

  setFavor(favor: number): void {
    this.favor = favor;
    $('prayer-favor').textContent = `✦ ${favor} Favor`;
    this.refreshCards();
  }

  /** The God spoke: words, and maybe a card. */
  onGod(message: GodMessage): void {
    this.setWaiting(false);
    const li = this.add('god', message.say);
    if (message.card) li.append(this.card(message.card));
    this.log.scrollTop = this.log.scrollHeight;
    if (!this.open) document.querySelector('[data-open="prayer"]')?.classList.add('calling');
  }

  private card(card: WishCard): HTMLElement {
    const div = document.createElement('div');
    div.className = `card ${card.tier}`;
    div.dataset.cost = String(card.cost);
    const cost = card.cost ? `${card.cost} Favor` : 'Free to ask';
    div.innerHTML = `
      <span class="tier">${TIER_NAMES[card.tier]}</span>
      <b>${escapeHtml(card.title)}</b>
      <p>${escapeHtml(card.summary)}</p>
      <dl><div><dt>Where</dt><dd>${escapeHtml(card.where)}</dd></div><div><dt>Cost</dt><dd>${cost}</dd></div></dl>
      <div class="buttons">
        <button type="button" data-card="${escapeHtml(card.id)}" data-confirm="yes">${card.instant ? 'Grant it' : 'Send for review'}</button>
        <button type="button" class="quiet" data-card="${escapeHtml(card.id)}" data-confirm="no">Not now</button>
      </div>
      <p class="short"></p>`;
    queueMicrotask(() => this.refreshCards());
    return div;
  }

  /** Shows when a card costs more Favor than the player holds. */
  private refreshCards(): void {
    for (const card of this.log.querySelectorAll<HTMLElement>('.card:not(.confirmed):not(.declined)')) {
      const short = Number(card.dataset.cost) > this.favor;
      card.querySelector('.short')!.textContent = short ? `You hold ${this.favor} Favor. Quests and levels earn more.` : '';
      card.querySelector<HTMLButtonElement>('[data-confirm="yes"]')!.disabled = short;
    }
  }

  private add(who: 'you' | 'god', text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = who;
    li.textContent = text;
    this.log.append(li);
    while (this.log.children.length > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return li;
  }

  private setWaiting(waiting: boolean): void {
    this.waiting = waiting;
    $('prayer').classList.toggle('waiting', waiting);
    this.log.querySelector('.listening')?.remove();
    if (waiting) {
      const li = this.add('god', 'The God is listening…');
      li.classList.add('listening');
    }
  }
}
