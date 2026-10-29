import { GAUGE_MAX, gaugeName, gaugeOf, type Character, type GaugeMessage } from '@co-mmo/shared';

/**
 * The signature gauge under the health bar (docs/classes.md, Signature
 * gauges): its name and five pips as plain text, filled as the server says.
 * A character without a Calling has no gauge, so the line stays hidden.
 */
export class GaugeUi {
  private gauge: GaugeMessage | undefined;

  /** A new or changed character: show its Calling's gauge, empty until the server says otherwise. */
  setCharacter(character: Character): void {
    const id = gaugeOf(character.calling);
    if (id !== this.gauge?.gauge) this.gauge = id && { t: 'gauge', gauge: id, pips: 0 };
    this.render();
  }

  /** The server's word on our gauge. */
  show(message: GaugeMessage): void {
    this.gauge = message;
    this.render();
  }

  private render(): void {
    const el = document.getElementById('gauge-line');
    if (!el) return;
    const g = this.gauge;
    el.hidden = !g;
    if (!g) return;
    const pips = '◆'.repeat(g.pips) + '◇'.repeat(Math.max(0, GAUGE_MAX - g.pips));
    el.textContent = `${gaugeName(g.gauge)} ${pips}${g.woven ? ' · your next spell is Woven' : ''}`;
    el.title = `${gaugeName(g.gauge)}: ${g.pips} of ${GAUGE_MAX}`;
  }
}
