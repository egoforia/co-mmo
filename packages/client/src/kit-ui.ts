import {
  ABILITIES,
  ITEMS,
  RECIPES,
  SHOPS,
  bonusText,
  cannotCraft,
  itemCount,
  recipeName,
  sellPrice,
  type Character,
  type TradeActionMessage,
  type TradeOffer,
  type TradeRequestMessage,
  type TradeView,
} from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';
import { artSrc } from './wished.ts';

const $ = (id: string) => document.getElementById(id)!;

export interface KitActions {
  ability(id: string): void;
  craft(recipe: string): void;
  shop(action: 'buy' | 'sell' | 'learn', npc: string, id: string, qty?: number): void;
  trade(message: TradeActionMessage): void;
  /** True while typing in chat, so keys are not shortcuts. */
  typing(): boolean;
}

/** An item's picture and name, coloured by rarity. */
export function itemLabel(id: string): string {
  const def = ITEMS[id];
  if (!def) return escapeHtml(id);
  return `<img src="${escapeHtml(artSrc(def.art, true))}" alt=""><b class="rarity-${def.rarity ?? 'common'}">${escapeHtml(def.name)}</b>`;
}

/**
 * The Adventurer's kit on screen: the ability bar (keys 1 to 4), the
 * crafting book (C), shop and trainer windows, and trading with players.
 */
export class KitUi {
  private character: Character;
  private energy: number;
  /** When each ability is ready again, by performance.now(). */
  private readonly readyAt = new Map<string, number>();
  private shopNpc: { id: string; name: string } | null = null;
  private trade: TradeView | null = null;
  private timer: number | undefined;

  constructor(character: Character, private readonly actions: KitActions) {
    this.character = character;
    this.energy = character.energy;
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('abilities').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-ability]')?.dataset.ability;
      (e.target as HTMLElement).closest('button')?.blur();
      if (id) this.use(id);
    });
    $('keys').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest<HTMLElement>('[data-open]')?.dataset.open === 'crafting') this.toggleCrafting(true);
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
        actions.shop(button.dataset.action as 'buy' | 'sell' | 'learn', this.shopNpc.id, button.dataset.id!, qty);
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
    if (n >= 1 && n <= 4) {
      // The same order as the bar: abilities whose wish is switched off are left out.
      const id = this.character.abilities.filter((a) => ABILITIES[a])[n - 1];
      if (id) this.use(id);
    } else if (e.key.toLowerCase() === 'c') {
      this.toggleCrafting();
    } else if (e.key === 'Escape') {
      $('crafting').hidden = true;
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
    const known = this.character.abilities.filter((id) => ABILITIES[id]).slice(0, 4);
    const bar = $('abilities');
    bar.hidden = known.length === 0;
    const now = performance.now();
    bar.innerHTML = known
      .map((id, i) => {
        const a = ABILITIES[id]!;
        const wait = Math.max(0, (this.readyAt.get(id) ?? 0) - now) / 1000;
        const low = this.energy < a.energy;
        return `<button type="button" data-ability="${escapeHtml(id)}" class="${low ? 'low' : ''}${wait ? ' resting' : ''}"
          title="${escapeHtml(`${a.name}: ${a.description} Costs ${a.energy} Energy, rests ${a.cooldown} s.`)}">
          <kbd>${i + 1}</kbd> ${escapeHtml(a.name)}${wait ? `<span class="wait">${Math.ceil(wait)}</span>` : ''}</button>`;
      })
      .join('');
  }

  private renderCrafting(): void {
    const c = this.character;
    const rows = Object.entries(RECIPES)
      .filter(([, r]) => ITEMS[r.result.item] && r.materials.every((m) => ITEMS[m.item]))
      .map(([id, r]) => {
        const why = cannotCraft(c, id);
        const needs = r.materials
          .map((m) => `<span class="${itemCount(c, m.item) >= m.qty ? 'have' : 'need'}">${itemCount(c, m.item)}/${m.qty} ${escapeHtml(ITEMS[m.item]!.name)}</span>`)
          .join(', ');
        const made = ITEMS[r.result.item]!;
        const name = recipeName(id);
        return `<li>${itemLabel(r.result.item)}${r.result.qty > 1 ? ` × ${r.result.qty}` : ''}
          ${name !== made.name ? `<i>${escapeHtml(name)}</i>` : ''}
          <span class="info">${needs}${r.wit ? ` · needs ${r.wit} Wit` : ''}${made.bonus ? ` · ${escapeHtml(bonusText(made.bonus))}` : ''}</span>
          <button type="button" data-recipe="${escapeHtml(id)}"${why ? ` disabled title="${escapeHtml(why)}"` : ''}>Make</button></li>`;
      })
      .join('');
    $('crafting').innerHTML = `
      <h2>Crafting book <button type="button" class="close" data-close aria-label="Close">×</button></h2>
      <p class="note">Creatures drop materials. Wit (and a good charm) lets you make finer things. New recipes can be wished for.</p>
      <ul class="rows">${rows}</ul>`;
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
        <img src="${escapeHtml(artSrc(ITEMS[s.item]!.art, true))}" alt="">${s.qty > 1 ? `<span class="qty">${s.qty}</span>` : ''}
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
