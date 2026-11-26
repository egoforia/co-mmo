import { DEFAULT_SKY, darkness, dayPhase, mix, skyFill, skyTint, skyWords, sunAt, type SkyConfig, type SkyView, type Sun, type Weather } from '@co-mmo/shared';

// The hour and the weather on this screen. The server says how the sky
// turns and what its clock reads; the hour is counted on from there every
// frame, so dusk falls smoothly. The light grade eases toward the sky's
// colour, so a change of land or hour never switches it at once, and a new
// weather rolls in over the sky's fade (fadeSeconds) rather than in a blink.

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
  /** The weather rolling out while a new one rolls in, and since when (our clock). */
  private fading?: { from: Weather; since: number };
  /** The world editor's look at another hour or weather, on this screen only. */
  private preview: { phase?: number; weather?: Weather } = {};

  /** A welcome said how the sky turns, its clock and the weather here, and the land's own light. */
  set(view: SkyView | undefined, biomeTint: number): void {
    if (view) {
      this.view = view;
      this.offset = view.now - Date.now();
      // A new land shows its own weather at once.
      this.fading = undefined;
    }
    this.biomeTint = biomeTint;
  }

  /** The weather here turned: it rolls in over the sky's fade. */
  setWeather(weather: Weather): void {
    if (weather !== this.view.weather) this.fading = { from: this.view.weather, since: Date.now() };
    this.view = { ...this.view, weather };
  }

  /** How the sky turns changed (God's View, Sky tab): the hour carries on from the server's new clock. */
  setConfig(config: SkyConfig, now: number): void {
    this.view = { ...this.view, config };
    this.offset = now - Date.now();
  }

  /** How far the new weather has rolled in, 0 to 1, and the one it replaces. */
  private fade(): { from: Weather; t: number } | undefined {
    if (!this.fading || this.preview.weather) return undefined;
    const ms = (this.view.config.fadeSeconds ?? 0) * 1000;
    const t = ms > 0 ? (Date.now() - this.fading.since) / ms : 1;
    if (t >= 1) {
      this.fading = undefined;
      return undefined;
    }
    return { from: this.fading.from, t: Math.max(0, t) };
  }

  /** Shows another hour (a phase of the day) or weather on this screen only, for the world editor; none puts back the sky's. */
  showAs(preview: { phase?: number; weather?: Weather }): void {
    this.preview = preview;
  }

  /** The weather shown: the editor's look, else the land's. */
  private get weather(): Weather {
    return this.preview.weather ?? this.view.weather;
  }

  /** Where the day is now. */
  phase(): number {
    return this.preview.phase ?? dayPhase(Date.now() + this.offset, this.view.config);
  }

  /** How dark it is, 0 by day to 1 at night. */
  darkness(): number {
    return darkness(this.phase());
  }

  /** The hour and the weather in a few words, for the corner of the screen. */
  words(): string {
    return skyWords(this.phase(), this.weather);
  }

  /** The light grade to show this frame, eased from the last toward the sky's colour. */
  tint(deltaMs: number): number {
    const phase = this.phase();
    const fade = this.fade();
    const now = skyTint(this.biomeTint, phase, this.weather);
    const target = fade ? mix(skyTint(this.biomeTint, phase, fade.from), now, fade.t) : now;
    const goal: [number, number, number] = [(target >> 16) & 0xff, (target >> 8) & 0xff, target & 0xff];
    const t = Math.min(1, (EASE_PER_SECOND * deltaMs) / 1000);
    this.shown = this.shown ? (this.shown.map((v, i) => v + (goal[i]! - v) * t) as [number, number, number]) : goal;
    const [r, g, b] = this.shown.map(Math.round) as [number, number, number];
    return (r << 16) | (g << 8) | b;
  }

  /** The sun or moon and the sky's all-round share this frame; a change of weather eases in like the grade. */
  sun(deltaMs: number): { sun: Sun; fill: number } {
    const phase = this.phase();
    const fade = this.fade();
    const goal = sunAt(phase, this.weather);
    let fill = skyFill(this.weather);
    if (fade) {
      const was = sunAt(phase, fade.from);
      goal.color = goal.color.map((v, i) => was.color[i]! + (v - was.color[i]!) * fade.t) as [number, number, number];
      fill = skyFill(fade.from) + (fill - skyFill(fade.from)) * fade.t;
    }
    const t = Math.min(1, (EASE_PER_SECOND * deltaMs) / 1000);
    const was = this.shownSun;
    this.shownSun = was
      ? { color: was.color.map((v, i) => v + (goal.color[i]! - v) * t) as [number, number, number], fill: was.fill + (fill - was.fill) * t }
      : { color: goal.color, fill };
    return { sun: { dir: goal.dir, color: this.shownSun.color }, fill: this.shownSun.fill };
  }
}
