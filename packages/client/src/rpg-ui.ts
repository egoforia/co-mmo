import {
  ITEMS,
  QUESTS,
  attackCooldown,
  maxHp,
  questProgressText,
  xpToNext,
  type Character,
  type DialogueMessage,
} from '@co-mmo/shared';
import { CHAPTERS } from './bible.ts';
import { escapeHtml } from './ui.ts';
import { artSrc } from './wished.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface RpgActions {
  attack(): void;
  interact(): void;
  use(item: string): void;
  accept(quest: string): void;
  /** True while typing in chat, so letters are not shortcuts. */
  typing(): boolean;
  /** Opens the prayer window. */
  prayer(): void;
}

/** Health, XP, quests, dialogue, the bag and the Bible: everything in DOM. */
export class RpgUi {
  private character: Character;
  private hp: number;
  private chapter = CHAPTERS[0]!.id;
  private lastAttack = 0;

  constructor(character: Character, private readonly actions: RpgActions) {
    this.character = character;
    this.hp = character.hp;
    for (const id of ['stats', 'quests', 'keys']) $(id).hidden = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('inventory').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-item]')?.dataset.item;
      if (item === 'bible') this.toggle('bible', true);
      else if (item) actions.use(item);
      if (target.closest('[data-close]')) this.toggle('inventory', false);
    });
    $('bible').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const chapter = target.closest<HTMLElement>('[data-chapter]')?.dataset.chapter;
      if (chapter) {
        this.chapter = chapter;
        this.renderBible();
      }
      if (target.closest('[data-close]')) this.toggle('bible', false);
    });
    $('dialogue').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const quest = target.closest<HTMLElement>('[data-accept]')?.dataset.accept;
      if (quest) actions.accept(quest);
      if (quest || target.closest('[data-close]')) $('dialogue').hidden = true;
    });
    $('keys').addEventListener('click', (e) => {
      // Let Space strike rather than press the button again.
      (e.target as HTMLElement).closest('button')?.blur();
      const panel = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open;
      if (panel === 'prayer') actions.prayer();
      else if (panel) this.toggle(panel, true);
    });
    this.render();
  }

  setCharacter(character: Character): void {
    this.character = character;
    this.hp = character.hp;
    this.render();
  }

  setHp(hp: number): void {
    if (hp === Math.ceil(this.hp)) return;
    this.hp = hp;
    this.renderStats();
  }

  get weakened(): boolean {
    return Date.now() < this.character.weakenedUntil;
  }

  showDialogue(d: DialogueMessage): void {
    const box = $('dialogue');
    const paragraphs = d.text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const offer = d.offer
      ? `<div class="offer"><b>${escapeHtml(d.offer.title)}</b><span>Reward: ${escapeHtml(d.offer.reward)}</span></div>
         <div class="buttons"><button type="button" data-accept="${escapeHtml(d.offer.quest)}">Accept</button><button type="button" class="quiet" data-close>Not now</button></div>`
      : `<div class="buttons"><button type="button" class="quiet" data-close>Goodbye</button></div>`;
    box.innerHTML = `
      <img src="${escapeHtml(artSrc(d.npc.asset))}" alt="">
      <div class="words"><h3>${escapeHtml(d.npc.name)}</h3>${paragraphs}${offer}</div>`;
    box.hidden = false;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.actions.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      e.preventDefault();
      // Holding Space keeps striking, at the speed the server allows.
      const now = performance.now();
      if (now - this.lastAttack < attackCooldown(this.character) * 1000) return;
      this.lastAttack = now;
      this.actions.attack();
    } else if (key === 'e') {
      this.actions.interact();
    } else if (key === 'i') {
      this.toggle('inventory');
    } else if (key === 'b') {
      this.toggle('bible');
    } else if (key === 'escape') {
      for (const id of ['inventory', 'bible', 'dialogue']) $(id).hidden = true;
    }
  }

  private toggle(id: string, open?: boolean): void {
    const el = $(id);
    el.hidden = !(open ?? el.hidden);
    if (!el.hidden) {
      if (id === 'bible') $('inventory').hidden = true;
      this.render();
    }
  }

  /** Redraws open windows, e.g. when wished things change. */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.renderStats();
    this.renderQuests();
    if (!$('inventory').hidden) this.renderInventory();
    if (!$('bible').hidden) this.renderBible();
  }

  private renderStats(): void {
    const c = this.character;
    const max = maxHp(c);
    const hp = Math.max(0, Math.ceil(this.hp));
    const next = xpToNext(c.level);
    ($('hp-fill') as HTMLElement).style.width = `${(100 * hp) / max}%`;
    $('hp-text').textContent = `${hp} / ${max}`;
    ($('xp-fill') as HTMLElement).style.width = `${(100 * c.xp) / next}%`;
    $('xp-text').textContent = `${c.xp} / ${next} XP`;
    const weak = this.weakened ? ' · <span class="weak">Weakened</span>' : '';
    $('stats-line').innerHTML = `Level ${c.level} · ${c.gold} gold · <span class="favor">✦ ${c.favor} Favor</span>${weak}`;
  }

  private renderQuests(): void {
    const active = this.character.quests.filter((q) => !q.done && QUESTS[q.id]);
    const el = $('quests');
    el.hidden = active.length === 0;
    el.innerHTML = active
      .map((q) => `<li><b>${escapeHtml(QUESTS[q.id]!.title)}</b><span>${escapeHtml(questProgressText(q))}</span></li>`)
      .join('');
  }

  private renderInventory(): void {
    const c = this.character;
    const slots = c.inventory
      .map((s) => {
        const def = ITEMS[s.item];
        if (!def) return '';
        const hint = def.kind === 'book' ? 'Click to read' : def.heal ? 'Click to drink' : 'Keep it for now';
        return `<button type="button" class="slot" data-item="${escapeHtml(s.item)}" title="${escapeHtml(`${def.name}: ${def.description}`)}">
          <img src="${escapeHtml(artSrc(def.art, true))}" alt="">
          ${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
          <span class="name">${escapeHtml(def.name)}</span><span class="hint">${hint}</span></button>`;
      })
      .join('');
    const s = c.stats;
    $('inventory').innerHTML = `
      <h2>Your bag <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <div class="slots">${slots}</div>
      <dl class="sheet">
        <div><dt>Might</dt><dd>${s.might}</dd></div><div><dt>Agility</dt><dd>${s.agility}</dd></div>
        <div><dt>Wit</dt><dd>${s.wit}</dd></div><div><dt>Spirit</dt><dd>${s.spirit}</dd></div>
      </dl>`;
  }

  private renderBible(): void {
    const chapter = CHAPTERS.find((c) => c.id === this.chapter) ?? CHAPTERS[0]!;
    const tabs = CHAPTERS.map(
      (c) => `<li><button type="button" data-chapter="${c.id}"${c.id === chapter.id ? ' aria-current="true"' : ''}>${escapeHtml(c.title)}</button></li>`,
    ).join('');
    $('bible').innerHTML = `
      <nav><h1>The Bible</h1><ol>${tabs}</ol></nav>
      <article>${chapter.html(this.character)}</article>
      <button type="button" class="close" data-close aria-label="Close">×</button>`;
  }
}
