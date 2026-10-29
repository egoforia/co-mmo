import {
  ECHO_MS,
  ECHO_SHARE,
  FOCUS_CRIT,
  FOCUS_STEP_MS,
  GAUGE_ENERGY,
  GAUGE_MAX,
  MOMENTUM_FADE_MS,
  POISONED_HEALING,
  RESOLVE_CALM_MS,
  RESOLVE_FADE_MS,
  WOVEN_AT,
  WOVEN_FACTOR,
  finisherFactor,
  gaugeOf,
  maxEnergy,
  maxHp,
  statusOf,
  weaveAfter,
  type AbilityDef,
  type GaugeId,
  type Thread,
} from '@co-mmo/shared';
import type { PlayerState, RegionState } from './state.ts';

/** An Echo a Bellkeeper's heal left on someone: Toll repeats a share of `amount`. */
export interface Echo {
  on: string;
  amount: number;
  until: number;
}

/** One player's signature gauge, as the server keeps it. */
export interface GaugeState {
  id: GaugeId;
  pips: number;
  /** Epoch ms that times it: Momentum's last hit, Resolve's last fight, Focus's last pip or break. */
  at: number;
  /** Weave: the thread of the last spell. */
  thread?: Thread;
  /** Echo: the Echoes this Bellkeeper's heals left. */
  echoes: Echo[];
  /** What the player was last told, so a change is sent once. */
  sent?: string;
}

/** What a cast takes from the gauge before it runs. */
export interface GaugeSpend {
  /** Multiplies the cast's amount: a finisher's pips, or a Woven spell's double. */
  factor: number;
  /** Pips a finisher spends once it has run. */
  spent: number;
  woven: boolean;
}

/**
 * The five signature gauges (docs/classes.md, Signature gauges): Resolve
 * fills as the Warden is hit, Momentum as the Duelist's hits land, Focus as
 * the Ranger stands still, Weave as the Wishweaver changes thread, and Echo
 * with the Bellkeeper's heals. Combat and Minds tell it what happened; it
 * keeps the pips, gives the Energy, and tells the player when they change.
 * Skills that add pips or spend them in their own way (build plan step 7)
 * call `add`, `pips` and `toll`.
 */
export class Gauges {
  constructor(private readonly s: RegionState) {}

  /** The player's gauge, started (or restarted, after a Calling change) as needed; none without a Calling. */
  of(p: PlayerState): GaugeState | undefined {
    const id = gaugeOf(p.character.calling);
    if (!id) return (p.gauge = undefined);
    if (p.gauge?.id !== id) p.gauge = { id, pips: 0, at: this.s.now(), echoes: [] };
    return p.gauge;
  }

  /** The pips the player holds now. */
  pips(p: PlayerState): number {
    return this.of(p)?.pips ?? 0;
  }

  /** Adds pips (up to five) to the player's gauge if it is `only` (when given); each new pip gives its Energy. */
  add(p: PlayerState, n: number, only?: GaugeId): void {
    const g = this.of(p);
    if (!g || (only && g.id !== only) || g.id === 'echo') return;
    const gained = Math.min(GAUGE_MAX, g.pips + n) - g.pips;
    if (gained <= 0) return;
    g.pips += gained;
    const energy = gained * GAUGE_ENERGY[g.id];
    if (energy) {
      p.character.energy = Math.min(maxEnergy(p.character), p.character.energy + energy);
      p.dirty = true;
    }
  }

  /** A creature's blow reached the player (blocked or not, but not dodged): Resolve grows, Focus breaks. */
  struck(p: PlayerState): void {
    const g = this.of(p);
    if (g?.id === 'resolve') {
      g.at = this.s.now();
      this.add(p, 1);
    } else if (g?.id === 'focus') this.breakFocus(g);
  }

  /** One of the player's hits landed on a creature: Momentum grows and the Warden is still fighting. */
  landed(p: PlayerState): void {
    const g = this.of(p);
    if (g?.id === 'momentum' || g?.id === 'resolve') g.at = this.s.now();
    if (g?.id === 'momentum') this.add(p, 1);
  }

  /** The player took a step: Focus breaks. */
  moved(p: PlayerState): void {
    const g = this.of(p);
    if (g?.id === 'focus') this.breakFocus(g);
  }

  /** Extra crit chance the gauge gives: 5% per Focus pip. */
  critBonus(p: PlayerState): number {
    const g = this.of(p);
    return g?.id === 'focus' ? g.pips * FOCUS_CRIT : 0;
  }

  /**
   * What a cast takes from the gauge before it runs. A finisher grows with
   * the pips it will spend (Toll spends Echoes instead, in `toll`). A spell
   * of a thread is Woven at three Weave, doubled and spending it; otherwise
   * a new thread adds a pip.
   */
  cast(p: PlayerState, a: AbilityDef): GaugeSpend {
    const g = this.of(p);
    const plain = { factor: 1, spent: 0, woven: false };
    if (!g) return plain;
    if (g.id === 'weave' && a.thread) {
      const woven = g.pips >= WOVEN_AT;
      g.pips = woven ? 0 : weaveAfter(g.pips, g.thread, a.thread);
      g.thread = a.thread;
      return woven ? { ...plain, factor: WOVEN_FACTOR, woven } : plain;
    }
    if (a.finisher && g.id !== 'echo' && g.id !== 'weave') return { ...plain, factor: finisherFactor(a, g.pips), spent: g.pips };
    return plain;
  }

  /** After a finisher has run (its own hits counted), its pips are gone. */
  spend(p: PlayerState, spend: GaugeSpend): void {
    const g = this.of(p);
    if (g && spend.spent) g.pips = 0;
  }

  /** A Bellkeeper's heal left an Echo of `amount` on someone (a new heal replaces their old Echo). */
  healed(p: PlayerState, on: PlayerState, amount: number): void {
    const g = this.of(p);
    if (g?.id !== 'echo' || amount <= 0) return;
    g.echoes = g.echoes.filter((e) => e.on !== on.info.id);
    g.echoes.push({ on: on.info.id, amount, until: this.s.now() + ECHO_MS });
    this.countEchoes(g);
  }

  /** Echoes the player could ring within `range` tiles: allies here, on their feet and on their floor. */
  echoesNear(p: PlayerState, range: number): { echo: Echo; ally: PlayerState }[] {
    const g = this.of(p);
    if (g?.id !== 'echo') return [];
    const now = this.s.now();
    return g.echoes.flatMap((echo) => {
      const ally = this.s.players.get(echo.on);
      const near = ally && echo.until > now && ally.character.hp > 0 && ally.floor === p.floor && Math.hypot(ally.x - p.x, ally.y - p.y) <= range;
      return near ? [{ echo, ally }] : [];
    });
  }

  /** Toll: every Echo in range rings, healing its ally for half the heal that left it, then fades. Returns how many rang. */
  toll(p: PlayerState, a: AbilityDef): number {
    const g = this.of(p);
    const rung = this.echoesNear(p, a.range);
    if (!g || !rung.length) return 0;
    const now = this.s.now();
    for (const { echo, ally } of rung) {
      const ch = ally.character;
      const poisoned = statusOf(ally, 'poisoned', now) ? POISONED_HEALING : 1;
      const healed = Math.min(maxHp(ch) - ch.hp, Math.round(echo.amount * ECHO_SHARE * poisoned));
      ch.hp += healed;
      ally.dirty = true;
      this.s.notice(ally, ally === p ? `${a.name} rings your Echo: +${healed} health.` : `${p.info.name}'s ${a.name} rings your Echo: +${healed} health.`);
    }
    g.echoes = g.echoes.filter((e) => !rung.some((r) => r.echo === e));
    this.countEchoes(g);
    return rung.length;
  }

  /** Each tick: Focus grows, Momentum and Resolve empty with time, Echoes fade, and changes are sent. */
  tick(now: number): void {
    for (const p of this.s.players.values()) {
      const g = this.of(p);
      if (!g) continue;
      if (g.id === 'focus') {
        if (p.character.hp <= 0) this.breakFocus(g);
        while (now - g.at >= FOCUS_STEP_MS) {
          g.at += FOCUS_STEP_MS;
          this.add(p, 1);
        }
      } else if (g.id === 'momentum' && g.pips && now - g.at >= MOMENTUM_FADE_MS) {
        g.pips = 0;
      } else if (g.id === 'resolve' && g.pips && now - g.at >= RESOLVE_CALM_MS) {
        // Out of combat it empties slowly: one pip, then another every RESOLVE_FADE_MS.
        g.pips--;
        g.at = now - RESOLVE_CALM_MS + RESOLVE_FADE_MS;
      } else if (g.id === 'echo') {
        g.echoes = g.echoes.filter((e) => e.until > now && this.s.players.has(e.on));
        this.countEchoes(g);
      }
      this.tell(p, g);
    }
  }

  /** Sends the player their gauge if it changed since they were last told. */
  private tell(p: PlayerState, g: GaugeState): void {
    const woven = g.id === 'weave' && g.pips >= WOVEN_AT;
    const key = `${g.id}:${g.pips}:${woven}`;
    if (key === g.sent) return;
    g.sent = key;
    p.conn.send({ t: 'gauge', gauge: g.id, pips: g.pips, ...(woven ? { woven } : {}) });
  }

  private breakFocus(g: GaugeState): void {
    g.pips = 0;
    g.at = this.s.now();
  }

  private countEchoes(g: GaugeState): void {
    g.pips = Math.min(GAUGE_MAX, g.echoes.length);
  }
}
