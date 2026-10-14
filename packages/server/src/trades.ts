import { canGive, cleanOffer, swap, type Character, type ServerMessage, type TradeActionMessage, type TradeOffer } from '@co-mmo/shared';

/** Players must stand this close (tiles) to start or finish a trade. */
export const TRADE_RANGE = 6;
/** An unanswered trade request lapses after this long. */
const REQUEST_MS = 60_000;

/** What the trade desk needs from the region it runs in. */
export interface TradeHost {
  character(id: string): Character | undefined;
  nameOf(id: string): string | undefined;
  /** The player in this region with this name. */
  findByName(name: string): string | undefined;
  distance(a: string, b: string): number;
  send(id: string, message: ServerMessage): void;
  /** A character changed (gold and items swapped): send it to its player. */
  changed(id: string): void;
  now(): number;
}

interface Trade {
  players: [string, string];
  offers: Map<string, TradeOffer>;
  confirmed: Set<string>;
}

const EMPTY: TradeOffer = { items: [], gold: 0 };

/**
 * Trading between players (design doc, Gold: traded between players). Both
 * sides put items and gold on the table; any change clears both
 * confirmations, and the swap happens only when both confirm what they see,
 * all or nothing, checked against what each still holds.
 */
export class TradeDesk {
  private readonly requests = new Map<string, { from: string; at: number }>();
  private readonly trades = new Map<string, Trade>();

  constructor(private readonly host: TradeHost) {}

  handle(id: string, m: TradeActionMessage): void {
    switch (m.action) {
      case 'request':
        return this.request(id, m.name ?? '');
      case 'accept':
        return this.accept(id);
      case 'decline': {
        const req = this.requests.get(id);
        this.requests.delete(id);
        if (req) this.tell(req.from, `${this.host.nameOf(id) ?? 'They'} does not want to trade right now.`);
        return;
      }
      case 'offer':
        return this.offer(id, cleanOffer(m.offer));
      case 'confirm':
        return this.confirm(id);
      case 'cancel':
        return this.cancel(id, 'You called off the trade.', `${this.host.nameOf(id) ?? 'They'} called off the trade.`);
    }
  }

  /** A player left the region: their trade and requests end. */
  leave(id: string): void {
    this.requests.delete(id);
    for (const [target, req] of this.requests) if (req.from === id) this.requests.delete(target);
    this.cancel(id, undefined, `${this.host.nameOf(id) ?? 'They'} walked away, so the trade is off.`);
  }

  trading(id: string): boolean {
    return this.trades.has(id);
  }

  private request(id: string, name: string): void {
    const target = name ? this.host.findByName(name.replace(/^@/, '')) : undefined;
    if (!target) return this.tell(id, name ? `${name} is not here. You can only trade with someone in the same place.` : 'Trade with whom? Write /trade and their name.');
    if (target === id) return this.tell(id, 'Trading with yourself? A fair deal every time.');
    if (this.host.distance(id, target) > TRADE_RANGE) return this.tell(id, `Walk closer to ${this.host.nameOf(target)} to trade.`);
    if (this.trades.has(id)) return this.tell(id, 'Finish the trade you have open first.');
    if (this.trades.has(target)) return this.tell(id, `${this.host.nameOf(target)} is busy trading with someone else.`);
    this.requests.set(target, { from: id, at: this.host.now() });
    this.host.send(target, { t: 'trade-request', from: { id, name: this.host.nameOf(id) ?? 'Someone' } });
    this.tell(id, `You asked ${this.host.nameOf(target)} to trade.`);
  }

  private accept(id: string): void {
    const req = this.requests.get(id);
    this.requests.delete(id);
    if (!req || this.host.now() - req.at > REQUEST_MS || !this.host.character(req.from)) return this.tell(id, 'Nobody is waiting to trade with you.');
    if (this.trades.has(id) || this.trades.has(req.from)) return this.tell(id, 'One of you is already trading.');
    if (this.host.distance(id, req.from) > TRADE_RANGE) return this.tell(id, `Walk closer to ${this.host.nameOf(req.from)} to trade.`);
    const trade: Trade = { players: [req.from, id], offers: new Map([[req.from, EMPTY], [id, EMPTY]]), confirmed: new Set() };
    this.trades.set(req.from, trade);
    this.trades.set(id, trade);
    this.show(trade);
  }

  private offer(id: string, offer: TradeOffer): void {
    const trade = this.trades.get(id);
    const c = this.host.character(id);
    if (!trade || !c) return;
    if (!canGive(c, offer)) return this.tell(id, 'You do not have all of that.');
    trade.offers.set(id, offer);
    trade.confirmed.clear();
    this.show(trade);
  }

  private confirm(id: string): void {
    const trade = this.trades.get(id);
    if (!trade) return;
    trade.confirmed.add(id);
    const [a, b] = trade.players;
    if (trade.confirmed.size < 2) return this.show(trade);
    const ca = this.host.character(a);
    const cb = this.host.character(b);
    if (!ca || !cb || this.host.distance(a, b) > TRADE_RANGE) {
      return this.end(trade, 'You are too far apart, so the trade is off.');
    }
    const why = swap(ca, cb, trade.offers.get(a)!, trade.offers.get(b)!);
    if (why) return this.end(trade, `The trade did not happen: ${why}`);
    this.host.changed(a);
    this.host.changed(b);
    this.end(trade, 'Trade done. Shake on it!');
  }

  private cancel(id: string, mine: string | undefined, theirs: string): void {
    const trade = this.trades.get(id);
    if (!trade) return;
    const other = trade.players.find((p) => p !== id)!;
    this.close(trade);
    if (mine) this.tell(id, mine);
    this.tell(other, theirs);
  }

  private end(trade: Trade, text: string): void {
    this.close(trade);
    for (const p of trade.players) this.tell(p, text);
  }

  private close(trade: Trade): void {
    for (const p of trade.players) {
      this.trades.delete(p);
      this.host.send(p, { t: 'trade', trade: null });
    }
  }

  /** Sends each side the table as they see it. */
  private show(trade: Trade): void {
    for (const me of trade.players) {
      const them = trade.players.find((p) => p !== me)!;
      this.host.send(me, {
        t: 'trade',
        trade: {
          with: { id: them, name: this.host.nameOf(them) ?? 'Someone' },
          mine: trade.offers.get(me)!,
          theirs: trade.offers.get(them)!,
          myConfirm: trade.confirmed.has(me),
          theirConfirm: trade.confirmed.has(them),
        },
      });
    }
  }

  private tell(id: string, text: string): void {
    this.host.send(id, { t: 'notice', text });
  }
}
