import {
  skillName,
  ABILITIES,
  HOTBAR_SIZE,
  ITEMS,
  RECIPES,
  SHOPS,
  bonusText,
  cannotCraft,
  itemCount,
  recipeName,
  sellPrice,
  CRAFTS,
  CRAFT_IDS,
  MASTERY_CHANGE_GOLD,
  MAX_MASTERIES,
  bestTool,
  craftLevel,
  craftLevelCap,
  craftXpToNext,
  isMastered,
  recipeCraft,
  type CraftId,
  type RecipeDef,
  type ShopMessage,
  type Character,
  type TradeActionMessage,
  type TradeOffer,
  type TradeRequestMessage,
  type TradeView,
} from '@co-mmo/shared';
import { SpellbookUi } from './spellbook-ui.ts';
import { escapeHtml } from './ui.ts';
import { itemIcon } from './wished.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface KitActions {
  ability(id: string): void;
  /** Arrange keys 1 to 6: an ability id per key, or '' for none. */
  hotbar(slots: string[]): void;
  craft(recipe: string): void;
  shop(action: ShopMessage['action'], npc: string, id: string, qty?: number, replace?: string): void;
  trade(message: TradeActionMessage): void;
  /** True while typing in chat, so keys are not shortcuts. */
  typing(): boolean;
}

/** An item's picture and name, coloured by rarity. */
export function itemLabel(id: string): string {
  const def = ITEMS[id];
  if (!def) return escapeHtml(id);
  return `<img src="${escapeHtml(itemIcon(def))}" alt=""><b class="rarity-${def.rarity ?? 'common'}">${escapeHtml(def.name)}</b>`;
}

/**
 * The Adventurer's kit on screen: the ability bar (keys 1 to 6, arranged in
 * the spellbook, K), the crafting book (C), shop and trainer windows, and
 * trading with players.
 */
export class KitUi {
  private character: Character;
  private energy: number;
  /** When each ability is ready again, by performance.now(). */
  private readonly readyAt = new Map<string, number>();
  private shopNpc: { id: string; name: string } | null = null;
  private trade: TradeView | null = null;
  private timer: number | undefined;
  private readonly spellbook: SpellbookUi;

  constructor(character: Character, private readonly actions: KitActions) {
    this.character = character;
    this.energy = character.energy;
    this.spellbook = new SpellbookUi(character, (slots) => actions.hotbar(slots));
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('abilities').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-ability]')?.dataset.ability;
      if ((e.target as HTMLElement).closest('[data-open-book]')) this.spellbook.toggle(true);
      (e.target as HTMLElement).closest('button')?.blur();
      if (id) this.use(id);
    });
    $('keys').addEventListener('click', (e) => {
      const open = (e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open;
      if (open === 'crafting') this.toggleCrafting(true);
      if (open === 'spellbook') this.spellbook.toggle(true);
    });
    $('crafting').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const recipe = target.closest<HTMLElement>('[data-recipe]')?.dataset.recipe;
      if (recipe) actions.craft(recipe);
      if (target.closest('[data-close]')) $('crafting').hidden = true;
    });
    $('shop').addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const button = target.closest<HTMLElement>('[data-action]');
      if (button && this.shopNpc) {
        const qty = button.dataset.qty ? Number(button.dataset.qty) : undefined;
        actions.shop(button.dataset.action as ShopMessage['action'], this.shopNpc.id, button.dataset.id!, qty, button.dataset.replace);
      }
      if (target.closest('[data-close]')) this.closeShop();
    });
    $('trade').addEventListener('click', (e) => this.onTradeClick(e));
    $('trade').addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.name === 'gold' && this.trade) this.offer({ ...this.trade.mine, gold: Math.max(0, Math.floor(Number(input.value) || 0)) });
    });
    $('trade-request').addEventListener('click', (e) => {
      const answer = (e.target as HTMLElement).dataset.answer as 'accept' | 'decline' | undefined;
      if (!answer) return;
      actions.trade({ t: 'trade', action: answer });
      $('trade-request').hidden = true;
    });
    this.render();
  }

  setCharacter(character: Character): void {
    this.character = character;
    this.energy = character.energy;
    this.spellbook.setCharacter(character);
    this.render();
  }

  setEnergy(energy: number): void {
    if (energy === this.energy) return;
    this.energy = energy;
    this.renderBar();
  }

  /** The server says an ability is resting. */
  cooldown(ability: string, seconds: number): void {
    this.readyAt.set(ability, performance.now() + seconds * 1000);
    this.renderBar();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      this.renderBar();
      if ([...this.readyAt.values()].every((t) => t <= performance.now())) clearInterval(this.timer);
    }, 200);
  }

  openShop(npc: { id: string; name: string }): void {
    this.shopNpc = npc;
    $('shop').hidden = false;
    this.renderShop();
  }

  toggleCrafting(open?: boolean): void {
    const el = $('crafting');
    el.hidden = !(open ?? el.hidden);
    if (!el.hidden) this.renderCrafting();
  }

  tradeRequested(m: TradeRequestMessage): void {
    const el = $('trade-request');
    el.innerHTML = `<p><b>${escapeHtml(m.from.name)}</b> wants to trade with you.</p>
      <button type="button" data-answer="accept">Trade</button> <button type="button" class="quiet" data-answer="decline">No thanks</button>`;
    el.hidden = false;
  }

  showTrade(view: TradeView | null): void {
    this.trade = view;
    $('trade').hidden = !view;
    if (view) $('trade-request').hidden = true;
    this.renderTrade();
  }

  /** Redraws open windows, e.g. when wished things change. */
  refresh(): void {
    this.render();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.actions.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= HOTBAR_SIZE) {
      // The key as the bar shows it: an ability whose wish is switched off does nothing.
      const id = this.character.hotbar[n - 1];
      if (id && ABILITIES[id]) this.use(id);
    } else if (e.key.toLowerCase() === 'c') {
      this.toggleCrafting();
    } else if (e.key.toLowerCase() === 'k') {
      this.spellbook.toggle();
    } else if (e.key === 'Escape') {
      $('crafting').hidden = true;
      this.spellbook.toggle(false);
      this.closeShop();
    }
  }

  private use(id: string): void {
    if ((this.readyAt.get(id) ?? 0) > performance.now()) return;
    this.actions.ability(id);
  }

  private closeShop(): void {
    $('shop').hidden = true;
    this.shopNpc = null;
  }

  private render(): void {
    this.renderBar();
    if (!$('crafting').hidden) this.renderCrafting();
    if (!$('shop').hidden) this.renderShop();
    if (!$('trade').hidden) this.renderTrade();
  }

  private renderBar(): void {
    const keys = Array.from({ length: HOTBAR_SIZE }, (_, i) => this.character.hotbar[i] ?? '');
    const bar = $('abilities');
    bar.hidden = !keys.some((id) => id && ABILITIES[id]);
    const now = performance.now();
    bar.innerHTML = keys
      .map((id, i) => {
        const a = id ? ABILITIES[id] : undefined;
        if (!a) return `<button type="button" class="empty" data-open-book title="An empty key. Open your spellbook (K) to put a skill here."><kbd>${i + 1}</kbd></button>`;
        const wait = Math.max(0, (this.readyAt.get(id) ?? 0) - now) / 1000;
        const low = this.energy < a.energy;
        // A Calling Wish may have renamed it (calling-wish.ts).
        const name = skillName(this.character, id);
        return `<button type="button" data-ability="${escapeHtml(id)}" class="${low ? 'low' : ''}${wait ? ' resting' : ''}"
          title="${escapeHtml(`${name}: ${a.description} Costs ${a.energy} Energy, rests ${a.cooldown} s.`)}">
          <kbd>${i + 1}</kbd> ${escapeHtml(name)}${wait ? `<span class="wait">${Math.ceil(wait)}</span>` : ''}</button>`;
      })
      .join('');
  }

  private renderCrafting(): void {
    const c = this.character;
    const known = Object.entries(RECIPES).filter(([, r]) => ITEMS[r.result.item] && r.materials.every((m) => ITEMS[m.item]));
    const row = ([id, r]: [string, RecipeDef]) => {
      const why = cannotCraft(c, id);
      const needs = r.materials
        .map((m) => `<span class="${itemCount(c, m.item) >= m.qty ? 'have' : 'need'}">${itemCount(c, m.item)}/${m.qty} ${escapeHtml(ITEMS[m.item]!.name)}</span>`)
        .join(', ');
      const made = ITEMS[r.result.item]!;
      const name = recipeName(id);
      return `<li>${itemLabel(r.result.item)}${r.result.qty > 1 ? ` × ${r.result.qty}` : ''}
        ${name !== made.name ? `<i>${escapeHtml(name)}</i>` : ''}
        <span class="info">${needs}${recipeCraft(r) && r.level > 1 ? ` · level ${r.level}` : ''}${made.bonus ? ` · ${escapeHtml(bonusText(made.bonus))}` : ''}</span>
        <button type="button" data-recipe="${escapeHtml(id)}"${why ? ` disabled title="${escapeHtml(why)}"` : ''}>Make</button></li>`;
    };
    // The book is grouped by craft, each with how far along you are and the tool you hold.
    const groups = [...CRAFT_IDS, undefined].map((k) => {
      const rows = known.filter(([, r]) => recipeCraft(r) === k).sort(([, a], [, b]) => a.level - b.level);
      if (!rows.length) return '';
      return `<h3>${k ? escapeHtml(this.craftLine(k)) : 'Anyone can make'}</h3><ul class="rows">${rows.map(row).join('')}</ul>`;
    }).join('');
    $('crafting').innerHTML = `
      <h2>Crafting book <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <p class="note">Each craft needs its tool in your bag and grows as you practise it. Anyone can reach level 10; a master goes on to 20. Wit makes finer things.</p>
      ${groups}`;
  }

  /** A craft's heading: its level, practice toward the next, mastery and tool. */
  private craftLine(k: CraftId): string {
    const c = this.character;
    const level = craftLevel(c, k);
    const xp = c.crafts?.[k]?.xp ?? 0;
    const tool = bestTool(c, k);
    const toward = level < craftLevelCap(c, k) ? ` (${xp}/${craftXpToNext(level)})` : '';
    return `${CRAFTS[k].name}: level ${level}${toward}${isMastered(c, k) ? ', master' : ''}, ${tool ? ITEMS[tool.id]!.name.toLowerCase() : `no ${CRAFTS[k].tool.toLowerCase()}`}`;
  }

  /** What a master offers: taking up their craft, or changing a mastery for it. */
  private masteryRows(crafts: CraftId[]): string[] {
    const c = this.character;
    const held = c.masteries ?? [];
    return crafts.map((k) => {
      const name = escapeHtml(CRAFTS[k].name);
      const info = `<span class="info">Rise past level 10 in ${name}, work the rarest materials and make the finest pieces.</span>`;
      if (isMastered(c, k)) return `<li><b>${name}</b>${info}<button type="button" disabled>You are a master</button></li>`;
      if (held.length < MAX_MASTERIES) return `<li><b>${name}</b>${info}<button type="button" data-action="master" data-id="${k}">Become a master</button></li>`;
      return `<li><b>${name}</b>${info}${held.map((old) => `<button type="button" data-action="master" data-id="${k}" data-replace="${old}"${c.gold < MASTERY_CHANGE_GOLD ? ' disabled' : ''}
        title="${escapeHtml(`Your ${CRAFTS[old].name} drops back to level 10.`)}">Give up ${escapeHtml(CRAFTS[old].name)} · ${MASTERY_CHANGE_GOLD} gold</button>`).join('')}</li>`;
    });
  }

  private renderShop(): void {
    const npc = this.shopNpc;
    const shop = npc && SHOPS[npc.id];
    if (!npc || !shop) return;
    const c = this.character;
    const sells = shop.sells.filter((s) => ITEMS[s.item]).map((s) => {
      const def = ITEMS[s.item]!;
      const bonus = bonusText(def.bonus);
      return `<li>${itemLabel(s.item)}<span class="info">${escapeHtml(bonus || def.description)}</span>
        <button type="button" data-action="buy" data-id="${escapeHtml(s.item)}"${c.gold < s.price ? ' disabled' : ''}>Buy · ${s.price} gold</button></li>`;
    });
    const teaches = shop.teaches.filter((t) => ABILITIES[t.ability]).map((t) => {
      const a = ABILITIES[t.ability]!;
      const known = c.abilities.includes(t.ability);
      return `<li><b>${escapeHtml(a.name)}</b><span class="info">${escapeHtml(a.description)} ${a.energy} Energy.</span>
        <button type="button" data-action="learn" data-id="${escapeHtml(t.ability)}"${known || c.gold < t.price ? ' disabled' : ''}>${known ? 'Known' : `Learn · ${t.price} gold`}</button></li>`;
    });
    const buys = shop.buys
      ? c.inventory.filter((s) => sellPrice(s.item) > 0).map((s) => {
        const price = sellPrice(s.item);
        return `<li>${itemLabel(s.item)}${s.qty > 1 ? ` × ${s.qty}` : ''}<span class="info">${price} gold each</span>
          <button type="button" data-action="sell" data-id="${escapeHtml(s.item)}">Sell one</button>
          ${s.qty > 1 ? `<button type="button" class="quiet" data-action="sell" data-id="${escapeHtml(s.item)}" data-qty="${s.qty}">Sell all</button>` : ''}</li>`;
      })
      : [];
    $('shop').innerHTML = `
      <h2>${escapeHtml(npc.name)} <small>${c.gold} gold</small> <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      ${sells.length ? `<h3>For sale</h3><ul class="rows">${sells.join('')}</ul>` : ''}
      ${teaches.length ? `<h3>Lessons</h3><ul class="rows">${teaches.join('')}</ul>` : ''}
      ${shop.masters?.length ? `<h3>Mastery</h3><ul class="rows">${this.masteryRows(shop.masters).join('')}</ul>` : ''}
      ${shop.buys ? `<h3>Sell your things</h3>${buys.length ? `<ul class="rows">${buys.join('')}</ul>` : '<p class="note">Nothing to sell. Worn gear must be taken off first.</p>'}` : ''}`;
  }

  private onTradeClick(e: Event): void {
    const target = e.target as HTMLElement;
    const t = this.trade;
    if (!t) return;
    const add = target.closest<HTMLElement>('[data-add]')?.dataset.add;
    const remove = target.closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (add) {
      const items = t.mine.items.map((s) => ({ ...s }));
      const slot = items.find((s) => s.item === add);
      if (slot) slot.qty = Math.min(slot.qty + 1, itemCount(this.character, add));
      else items.push({ item: add, qty: 1 });
      this.offer({ ...t.mine, items });
    } else if (remove) {
      this.offer({ ...t.mine, items: t.mine.items.filter((s) => s.item !== remove) });
    } else if (target.closest('[data-confirm]')) {
      this.actions.trade({ t: 'trade', action: 'confirm' });
    } else if (target.closest('[data-cancel]')) {
      this.actions.trade({ t: 'trade', action: 'cancel' });
    }
  }

  private offer(offer: TradeOffer): void {
    this.actions.trade({ t: 'trade', action: 'offer', offer });
  }

  private renderTrade(): void {
    const t = this.trade;
    if (!t) return;
    const list = (o: TradeOffer, mine: boolean) => `
      <ul class="rows">${o.items.map((s) => `<li>${itemLabel(s.item)} × ${s.qty}${mine ? ` <button type="button" class="quiet" data-remove="${escapeHtml(s.item)}">Take back</button>` : ''}</li>`).join('') || '<li class="note">Nothing yet.</li>'}</ul>
      ${mine ? `<label>Gold <input name="gold" type="number" min="0" max="${this.character.gold}" value="${o.gold}"></label>` : `<p><b>${o.gold}</b> gold</p>`}`;
    const bag = this.character.inventory
      .filter((s) => !ITEMS[s.item]?.bound && ITEMS[s.item])
      .map((s) => `<button type="button" class="slot" data-add="${escapeHtml(s.item)}" title="Add one to your side">
        <img src="${escapeHtml(itemIcon(ITEMS[s.item]!))}" alt="">${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
        <span class="name">${escapeHtml(ITEMS[s.item]!.name)}</span><span class="hint">Add one</span></button>`)
      .join('');
    $('trade').innerHTML = `
      <h2>Trading with ${escapeHtml(t.with.name)}</h2>
      <div class="sides">
        <section><h3>You give ${t.myConfirm ? '<span class="ok">✓ agreed</span>' : ''}</h3>${list(t.mine, true)}</section>
        <section><h3>${escapeHtml(t.with.name)} gives ${t.theirConfirm ? '<span class="ok">✓ agreed</span>' : ''}</h3>${list(t.theirs, false)}</section>
      </div>
      <h3>Your bag</h3>
      <div class="slots">${bag || '<p class="note">Nothing you can trade.</p>'}</div>
      <p class="note">Any change clears both agreements. The swap happens when you both agree.</p>
      <div class="buttons"><button type="button" data-confirm${t.myConfirm ? ' disabled' : ''}>${t.myConfirm ? `Waiting for ${escapeHtml(t.with.name)}` : 'Agree'}</button>
      <button type="button" class="quiet" data-cancel>Call it off</button></div>`;
  }
}
