import {
  ABILITIES,
  EQUIP_SLOTS,
  ITEMS,
  QUESTS,
  SLOT_NAMES,
  attackCooldown,
  armor,
  attackPower,
  attackReach,
  familyText,
  bonusText,
  creatorXpToNext,
  critChance,
  dodgeChance,
  maxEnergy,
  maxHp,
  questProgressText,
  totalStats,
  ward,
  xpToNext,
  type Character,
  type DialogueMessage,
  type EquipSlot,
} from '@co-mmo/shared';
import { CHAPTERS } from './bible.ts';
import { itemLabel } from './kit-ui.ts';
import { escapeHtml } from './ui.ts';
import { artSrc, contentEntries } from './wished.ts';

/** A defence value with at most one decimal (half of Vigor can be 1.5). */
const one = (n: number): string => String(Math.round(n * 10) / 10);
/** A chance as a whole percent. */
const percent = (n: number): string => `${Math.round(n * 100)}%`;

const $ = (id: string) => document.getElementById(id)!;

export interface RpgActions {
  attack(): void;
  interact(): void;
  use(item: string): void;
  /** Takes off what is worn in a slot. */
  unequip(slot: EquipSlot): void;
  /** Opens a shopkeeper's or trainer's window. */
  openShop(npc: { id: string; name: string }): void;
  accept(quest: string): void;
  /** Tells the Stewards about a wished thing. */
  report(kind: 'content' | 'player', target: string, reason: string): void;
  /** True while typing in chat, so letters are not shortcuts. */
  typing(): boolean;
  /** Opens the prayer window. */
  prayer(): void;
}

/** Health, XP, quests, dialogue, the bag and the Bible: everything in DOM. */
export class RpgUi {
  private character: Character;
  private hp: number;
  private energy: number;
  private chapter = CHAPTERS[0]!.id;
  private lastAttack = 0;

  constructor(character: Character, private readonly actions: RpgActions) {
    this.character = character;
    this.hp = character.hp;
    this.energy = character.energy;
    for (const id of ['stats', 'quests', 'keys']) $(id).hidden = false;
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('inventory').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLElement>('[data-item]')?.dataset.item;
      const slot = target.closest<HTMLElement>('[data-slot]')?.dataset.slot as EquipSlot | undefined;
      if (item === 'bible') this.toggle('bible', true);
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
      const shop = target.closest<HTMLElement>('[data-shop]');
      if (shop) actions.openShop({ id: shop.dataset.shop!, name: shop.dataset.name ?? '' });
      if (quest || shop || target.closest('[data-close]')) $('dialogue').hidden = true;
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

  showDialogue(d: DialogueMessage): void {
    const box = $('dialogue');
    const paragraphs = d.text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const shop = d.shop ? `<button type="button" data-shop="${escapeHtml(d.npc.id)}" data-name="${escapeHtml(d.npc.name)}">Trade</button>` : '';
    const offer = d.offer
      ? `<div class="offer"><b>${escapeHtml(d.offer.title)}</b><span>Reward: ${escapeHtml(d.offer.reward)}</span></div>
         <div class="buttons"><button type="button" data-accept="${escapeHtml(d.offer.quest)}">Accept</button>${shop}<button type="button" class="quiet" data-close>Not now</button></div>`
      : `<div class="buttons">${shop}<button type="button" class="quiet" data-close>Goodbye</button></div>`;
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
    const maxE = maxEnergy(c);
    const energy = Math.max(0, Math.floor(this.energy));
    ($('energy-fill') as HTMLElement).style.width = `${(100 * energy) / maxE}%`;
    $('energy-text').textContent = `${energy} / ${maxE} Energy`;
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
        const ruled = contentEntries().some((e) => e.definition?.kind === 'rule' && s.item.startsWith(`${e.id}-`));
        const hint = def.kind === 'book' ? 'Click to read'
          : def.heal ? 'Click to drink'
            : def.slot ? `Wear: ${[familyText(def), bonusText(def.bonus)].filter(Boolean).join(' · ') || SLOT_NAMES[def.slot]}`
              : def.teaches ? 'Click to read and learn'
                : ruled ? 'Click to use' : 'For crafting and trade';
        return `<button type="button" class="slot" data-item="${escapeHtml(s.item)}" title="${escapeHtml(`${def.name}: ${def.description}`)}">
          <img src="${escapeHtml(artSrc(def.art, true))}" alt="">
          ${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
          <span class="name rarity-${def.rarity ?? 'common'}">${escapeHtml(def.name)}</span><span class="hint">${escapeHtml(hint)}</span></button>`;
      })
      .join('');
    const worn = EQUIP_SLOTS.map((slot) => {
      const id = c.equipment[slot];
      const def = id ? ITEMS[id] : undefined;
      return def
        ? `<button type="button" class="slot worn" data-slot="${slot}" title="Click to take it off">${itemLabel(id!)}<span class="hint">${escapeHtml([familyText(def), bonusText(def.bonus)].filter(Boolean).join(' · '))}</span></button>`
        : `<div class="slot empty"><span class="name">${SLOT_NAMES[slot]}</span><span class="hint">Nothing worn</span></div>`;
    }).join('');
    const s = c.stats;
    const t = totalStats(c);
    const stat = (name: string, k: keyof typeof s) => `<div><dt>${name}</dt><dd>${t[k]}${t[k] > s[k] ? `<small>+${t[k] - s[k]}</small>` : ''}</dd></div>`;
    const abilities = c.abilities.filter((a) => ABILITIES[a]).map((a, i) => `<li><kbd>${i + 1}</kbd> <b>${escapeHtml(ABILITIES[a]!.name)}</b> ${escapeHtml(ABILITIES[a]!.description)}</li>`).join('');
    $('inventory').innerHTML = `
      <h2>Your bag <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <h3>Worn</h3>
      <div class="slots gear">${worn}</div>
      <h3>Carried</h3>
      <div class="slots">${slots}</div>
      <dl class="sheet">
        ${stat('Might', 'might')}${stat('Agility', 'agility')}${stat('Wit', 'wit')}${stat('Spirit', 'spirit')}${stat('Vigor', 'vigor')}
        <div><dt>Damage</dt><dd>${attackPower(c)}</dd></div><div><dt>Reach</dt><dd>${one(attackReach(c))}<small>steps</small></dd></div><div><dt>Attack every</dt><dd>${attackCooldown(c).toFixed(2)}<small>s</small></dd></div><div><dt>Armour</dt><dd>${one(armor(c))}</dd></div><div><dt>Ward</dt><dd>${one(ward(c))}</dd></div>
        <div><dt>Critical hit</dt><dd>${percent(critChance(c))}</dd></div><div><dt>Dodge</dt><dd>${percent(dodgeChance(c))}</dd></div>
        <div class="wide"><dt>Creator level</dt><dd>${c.creatorLevel}<small>${c.creatorXp} / ${creatorXpToNext(c.creatorLevel)}</small></dd></div>
      </dl>
      ${abilities ? `<h3>Abilities</h3><ul class="abilities">${abilities}</ul>` : '<p class="note">No abilities yet. Trainers, scrolls and quests teach them.</p>'}`;
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
