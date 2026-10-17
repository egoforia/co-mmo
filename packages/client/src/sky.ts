import { DEFAULT_SKY, darkness, dayPhase, skyFill, skyTint, skyWords, sunAt, type SkyView, type Sun, type Weather } from '@co-mmo/shared';

// The hour and the weather on this screen. The server says how the sky
// turns and what its clock reads; the hour is counted on from there every
// frame, so dusk falls smoothly. The light grade eases toward the sky's
// colour, so a change of land, hour or weather never switches it at once.

/** How quickly the light catches up with the sky: about this share per second. */
const EASE_PER_SECOND = 1.5;

export class SkyClock {
  private view: SkyView = { config: DEFAULT_SKY, now: Date.now(), weather: 'clear' };
  /** The server's clock minus ours, so the hour matches the server's. */
  private offset = 0;
  private biomeTint = 0xffffff;
  /** The grade shown now, per channel, kept unrounded so slow eases still arrive. */
  private shown?: [number, number, number];
  /** The sun's colour and the sky's all-round share shown now, eased the same way. */
  private shownSun?: { color: [number, number, number]; fill: number };

  /** A welcome said how the sky turns, its clock and the weather here, and the land's own light. */
  set(view: SkyView | undefined, biomeTint: number): void {
    if (view) {
      this.view = view;
      this.offset = view.now - Date.now();
    }
    this.biomeTint = biomeTint;
  }

  setWeather(weather: Weather): void {
    this.view = { ...this.view, weather };
  }

  /** Where the day is now. */
  phase(): number {
    return dayPhase(Date.now() + this.offset, this.view.config);
  }

  /** How dark it is, 0 by day to 1 at night. */
  darkness(): number {
    return darkness(this.phase());
  }

  /** The hour and the weather in a few words, for the corner of the screen. */
  words(): string {
    return skyWords(this.phase(), this.view.weather);
  }

  /** The light grade to show this frame, eased from the last toward the sky's colour. */
  tint(deltaMs: number): number {
    const target = skyTint(this.biomeTint, this.phase(), this.view.weather);
    const goal: [number, number, number] = [(target >> 16) & 0xff, (target >> 8) & 0xff, target & 0xff];
    const t = Math.min(1, (EASE_PER_SECOND * deltaMs) / 1000);
    this.shown = this.shown ? (this.shown.map((v, i) => v + (goal[i]! - v) * t) as [number, number, number]) : goal;
    const [r, g, b] = this.shown.map(Math.round) as [number, number, number];
    return (r << 16) | (g << 8) | b;
  }

  /** The sun or moon and the sky's all-round share this frame; a change of weather eases in like the grade. */
  sun(deltaMs: number): { sun: Sun; fill: number } {
    const goal = sunAt(this.phase(), this.view.weather);
    const fill = skyFill(this.view.weather);
    const t = Math.min(1, (EASE_PER_SECOND * deltaMs) / 1000);
    const was = this.shownSun;
    this.shownSun = was
      ? { color: was.color.map((v, i) => v + (goal.color[i]! - v) * t) as [number, number, number], fill: was.fill + (fill - was.fill) * t }
      : { color: goal.color, fill };
    return { sun: { dir: goal.dir, color: this.shownSun.color }, fill: this.shownSun.fill };
  }
}
