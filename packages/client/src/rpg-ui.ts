import {
  QUESTS,
  STATUSES,
  statusArt,
  attackCooldown,
  goldOf,
  maxEnergy,
  maxHp,
  questProgressText,
  xpToNext,
  type Character,
  type DialogueMessage,
  type OwnerEntry,
  type ShopDef,
  type EquipSlot,
  type Stats,
  type StatusView,
} from '@co-mmo/shared';
import { CHAPTERS } from './bible.ts';
import { InventoryWindow } from './inventory-ui.ts';
import { pathChoicesHtml } from './path-ui.ts';
import { escapeHtml } from './ui.ts';
import { artSrc } from './wished.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface RpgActions {
  attack(): void;
  interact(): void;
  use(item: string): void;
  /** Takes off what is worn in a slot. */
  unequip(slot: EquipSlot): void;
  /** Opens a shopkeeper's or trainer's window. */
  openShop(npc: { id: string; name: string; shop?: ShopDef }): void;
  accept(quest: string): void;
  /** Chooses a Path at the mentor beside you. */
  choosePath(npc: string, path: string): void;
  /** Tells the Stewards about a wished thing. */
  report(kind: 'content' | 'player', target: string, reason: string): void;
  /** True while typing in chat, so letters are not shortcuts. */
  typing(): boolean;
  /** Opens the prayer window. */
  prayer(): void;
  /** Places a free attribute point. */
  spendPoint(stat: keyof Stats): void;
  /** Asks the server who owned these pieces of gear before. */
  askHistory?(items: string[]): void;
}

/** Health, XP, quests, dialogue, the bag and the Bible: everything in DOM. */
export class RpgUi {
  private character: Character;
  private hp: number;
  private energy: number;
  private chapter = CHAPTERS[0]!.id;
  /** The bag window's contents (inventory-ui.ts). */
  private readonly bag: InventoryWindow;
  /** The shop of the person last spoken to, when the world editor gave them one. */
  private wares: ShopDef | undefined;
  private lastAttack = 0;
  /** Our statuses as the stats line shows them (HTML), as the last snapshot told them. */
  private statusText = '';
  /** A painted status icon's picture, once it ships with the game (skill-art.ts); words stand in until then. */
  statusIcon: (key: string) => string | undefined = () => undefined;

  constructor(character: Character, private readonly actions: RpgActions) {
    this.character = character;
    this.hp = character.hp;
    this.energy = character.energy;
    this.bag = new InventoryWindow(actions.askHistory ? (items) => actions.askHistory!(items) : undefined);
    for (const id of ['stats', 'quests', 'keys']) $(id).hidden = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('inventory').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-item]')?.dataset.item;
      const slot = target.closest<HTMLElement>('[data-slot]')?.dataset.slot as EquipSlot | undefined;
      const stat = target.closest<HTMLElement>('[data-stat]')?.dataset.stat as keyof Stats | undefined;
      if (stat) actions.spendPoint(stat);
      else if (item === 'bible') this.toggle('bible', true);
      else if (item) actions.use(item);
      else if (slot) actions.unequip(slot);
      if (target.closest('[data-close]')) this.toggle('inventory', false);
    });
    $('bible').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const chapter = target.closest<HTMLElement>('[data-chapter]')?.dataset.chapter;
      if (chapter) {
        this.chapter = chapter;
        this.renderBible();
      }
      const report = target.closest<HTMLElement>('[data-report]');
      if (report) {
        const reason = window.prompt(`What is wrong with ${report.dataset.title ?? 'this'}? The Stewards will read it.`);
        if (reason?.trim()) actions.report('content', report.dataset.report!, reason.trim());
      }
      if (target.closest('[data-close]')) this.toggle('bible', false);
    });
    $('dialogue').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const quest = target.closest<HTMLElement>('[data-accept]')?.dataset.accept;
      if (quest) actions.accept(quest);
      const path = target.closest<HTMLElement>('[data-path]');
      if (path) actions.choosePath(path.dataset.npc!, path.dataset.path!);
      const shop = target.closest<HTMLElement>('[data-shop]');
      if (shop) actions.openShop({ id: shop.dataset.shop!, name: shop.dataset.name ?? '', ...(this.wares ? { shop: this.wares } : {}) });
      if (quest || shop || path || target.closest('[data-close]')) $('dialogue').hidden = true;
    });
    $('keys').addEventListener('click', (e) => {
      // Let Space strike rather than press the button again.
      (e.target as HTMLElement).closest('button')?.blur();
      const panel = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open;
      if (panel === 'prayer') actions.prayer();
      else if (panel === 'crafting') return;
      else if (panel) this.toggle(panel, true);
    });
    this.render();
  }

  setCharacter(character: Character): void {
    this.character = character;
    this.hp = character.hp;
    this.energy = character.energy;
    this.render();
  }

  setVitals(hp: number, energy: number): void {
    if (hp === Math.ceil(this.hp) && energy === Math.floor(this.energy)) return;
    this.hp = hp;
    this.energy = energy;
    this.renderStats();
  }

  get weakened(): boolean {
    return Date.now() < this.character.weakenedUntil;
  }

  /** Our running statuses from the snapshot, shown in words beside the stats until their icons are painted (build plan step 10). */
  setStatuses(statuses: StatusView[] | undefined): void {
    const next = (statuses ?? []).map((s) => {
      const name = STATUSES[s.id].name;
      const icon = this.statusIcon(statusArt(s.id));
      return icon ? `<img class="status-icon" src="${escapeHtml(icon)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}"> ${s.left}s` : `${escapeHtml(name)} ${s.left}s`;
    }).join(' · ');
    if (next === this.statusText) return;
    this.statusText = next;
    this.renderStats();
  }

  showDialogue(d: DialogueMessage): void {
    const box = $('dialogue');
    this.wares = d.wares;
    const paragraphs = d.text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const shop = d.shop ? `<button type="button" data-shop="${escapeHtml(d.npc.id)}" data-name="${escapeHtml(d.npc.name)}">Trade</button>` : '';
    const offer = d.offer
      ? `<div class="offer"><b>${escapeHtml(d.offer.title)}</b><span>Reward: ${escapeHtml(d.offer.reward)}</span></div>
         <div class="buttons"><button type="button" data-accept="${escapeHtml(d.offer.quest)}">Accept</button>${shop}<button type="button" class="quiet" data-close>Not now</button></div>`
      : `<div class="buttons">${shop}<button type="button" class="quiet" data-close>Goodbye</button></div>`;
    box.innerHTML = `
      <img src="${escapeHtml(artSrc(d.npc.asset))}" alt="">
      <div class="words"><h3>${escapeHtml(d.npc.name)}</h3>${paragraphs}${d.paths?.length ? pathChoicesHtml(d.npc.id, d.paths) : ''}${offer}</div>`;
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
    const maxE = maxEnergy(c);
    const energy = Math.max(0, Math.floor(this.energy));
    ($('energy-fill') as HTMLElement).style.width = `${(100 * energy) / maxE}%`;
    $('energy-text').textContent = `${energy} / ${maxE} Energy`;
    // Weakened comes in the snapshot's statuses with the rest; before the first one, the character says.
    const shown = this.statusText || (this.weakened ? 'Weakened' : '');
    const weak = shown ? ` · <span class="weak">${this.statusText ? shown : escapeHtml(shown)}</span>` : '';
    $('stats-line').innerHTML = `Level ${c.level} · ${goldOf(c)} gold · <span class="favor">✦ ${c.favor} Favor</span>${weak}`;
  }

  private renderQuests(): void {
    const active = this.character.quests.filter((q) => !q.done && QUESTS[q.id]);
    const el = $('quests');
    el.hidden = active.length === 0;
    el.innerHTML = active
      .map((q) => `<li><b>${escapeHtml(QUESTS[q.id]!.title)}</b><span>${escapeHtml(questProgressText(q, this.character))}</span></li>`)
      .join('');
  }

  /** Owner histories the server sent: the bag shows them on each piece's card. */
  setHistories(histories: Record<string, OwnerEntry[]>): void {
    this.bag.setHistories(histories);
    if (!$('inventory').hidden) this.renderInventory();
  }

  private renderInventory(): void {
    $('inventory').innerHTML = this.bag.html(this.character);
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
