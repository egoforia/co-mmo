// The Sky tab: how long a game day and a spell of weather last, how much of
// the day is night, and each land's weather odds (the Owner), plus "set the
// hour now" and "change the weather in a land now" for events (the Owner and
// Stewards). The server keeps the hour where it was through any change
// (shared sky-clock.ts), so nothing jumps on players' screens.

import { BIOMES, WEATHERS, dayPhase, gameHour, unwarpPhase, type BiomeId, type SkyConfig, type Weather } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { api, toast, view, type Handled, type Tab } from './core.ts';

interface SkyPage {
  sky: SkyConfig;
  saved: SkyConfig;
  envWeatherOff: boolean;
  now: number;
  gameOdds: Record<BiomeId, Partial<Record<Weather, number>>>;
  naturalNightShare: number;
  lands: { id: string; name: string; biome: BiomeId; weather: Weather; fixed?: boolean }[];
}

/** Day lengths offered as one click, in real minutes. */
const PRESETS = [60, 120, 180, 360, 1440];

const WEATHER_NAMES: Record<Weather, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog', snow: 'Snow', sandstorm: 'Sandstorm' };

/** Real minutes as a person says them. */
function length(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

const hourWords = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

/** The day's four parts at this night share, as shares of a real day, in order from midnight. */
function parts(share: number): { part: string; label: string; share: number }[] {
  const light = 1 - share;
  return [
    { part: 'night', label: 'Night', share: (share * 5) / 9 },
    { part: 'dawn', label: 'Dawn', share: (light * 2) / 15 },
    { part: 'day', label: 'Day', share: (light * 11) / 15 },
    { part: 'dusk', label: 'Dusk', share: (light * 2) / 15 },
    { part: 'night', label: 'Night', share: (share * 4) / 9 },
  ];
}

/** A strip of one real day: dawn, day, dusk and night at the chosen share, with where the day is now. */
function strip(sky: SkyConfig, now: number, natural: number): string {
  const share = sky.nightShare ?? natural;
  const at = unwarpPhase(dayPhase(now, sky), share) * 100;
  const cells = parts(share).map((p) => `<span class="sky-${p.part}" style="flex:${p.share}" title="${p.label}: ${length(p.share * sky.dayMinutes)}">${p.share > 0.08 ? p.label : ''}</span>`).join('');
  const total = (part: string) => parts(share).filter((p) => p.part === part).reduce((s, p) => s + p.share, 0) * sky.dayMinutes;
  return `
    <div class="sky-strip">${cells}<i style="left:${at}%" title="Now"></i></div>
    <p class="note">Now: ${hourWords(gameHour(dayPhase(now, sky)))} game time. Each day: dawn ${length(total('dawn'))}, day ${length(total('day'))}, dusk ${length(total('dusk'))}, night ${length(total('night'))} of real time.</p>`;
}

function oddsTable(p: SkyPage): string {
  const biomes = Object.keys(p.gameOdds) as BiomeId[];
  const fixed = p.lands.filter((l) => l.fixed);
  const rows = biomes.map((b) => {
    const odds = p.saved.odds?.[b] ?? p.gameOdds[b];
    const cells = WEATHERS.map((w) => `<td><input name="odds.${b}.${w}" type="range" min="0" max="10" step="1" value="${odds[w] ?? 0}" title="${WEATHER_NAMES[w]}: ${odds[w] ?? 0}" aria-label="${escapeHtml(BIOMES[b]?.name ?? b)}, ${WEATHER_NAMES[w]}"${view.owner ? '' : ' disabled'}></td>`).join('');
    return `<tr><th>${escapeHtml(BIOMES[b]?.name ?? b)}${p.saved.odds?.[b] ? ' <small>(yours)</small>' : ''}</th>${cells}</tr>`;
  }).join('');
  return `
    <h3>Weather odds by land type</h3>
    <p class="note">How likely each weather is, from 0 (never) to 10. Each spell picks one by these odds.${fixed.length ? ` Fixed in the editor, so these odds don't change them: ${fixed.map((l) => escapeHtml(l.name)).join(', ')}.` : ''}</p>
    <div class="scroll"><table class="log sky-odds"><thead><tr><th>Land</th>${WEATHERS.map((w) => `<th>${WEATHER_NAMES[w]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function page(): Promise<string> {
  const p = (lastPage = await api<SkyPage>('sky'));
  const s = p.saved;
  const owner = view.owner;
  const off = owner ? '' : ' disabled';
  const hours = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hourWords(h)}</option>`).join('');
  const lands = p.lands.filter((l) => !l.fixed).map((l) => `<option value="${l.id}">${escapeHtml(l.name)} (now ${WEATHER_NAMES[l.weather].toLowerCase()})</option>`).join('');
  const weathers = WEATHERS.map((w) => `<option value="${w}">${WEATHER_NAMES[w]}</option>`).join('');
  return `
    <h2>Sky</h2>
    <p class="note">How day, night and weather turn in every land. Changes reach every screen at once, and the hour carries on from where it is.${p.envWeatherOff ? ' <b>Weather is switched off on this server (WEATHER=off), so every land stays clear whatever is saved here.</b>' : ''}</p>
    ${strip(p.sky, p.now, p.naturalNightShare)}
    ${owner ? '' : '<p class="note">Only the Owner can change the lengths and odds. You can set the hour or the weather now, below.</p>'}
    <form id="sky-form" class="form">
      <label>Day length<span>${PRESETS.map((m) => `<button type="button" data-sky-day="${m}"${off}${Math.abs(s.dayMinutes - m) < 0.01 ? ' class="on"' : ''}>${length(m)}</button>`).join('')}<button type="button" data-sky-follow${off}>Follow the real day</button></span></label>
      <label>Real minutes in one game day<span><input name="dayMinutes" type="number" min="10" max="10080" step="1" value="${Math.round(s.dayMinutes)}"${off}></span></label>
      <label>How much of the day is night: <b id="sky-night-share">${Math.round((s.nightShare ?? p.naturalNightShare) * 100)}%</b><span><input name="nightShare" type="range" min="15" max="60" step="1" value="${Math.round((s.nightShare ?? p.naturalNightShare) * 100)}"${off}></span></label>
      <label>Real minutes a spell of weather lasts<span><input name="weatherMinutes" type="number" min="2" max="1440" step="1" value="${Math.round(s.weatherMinutes)}"${off}></span></label>
      <label>Seconds a new weather takes to roll in<span><input name="fadeSeconds" type="number" min="0" max="600" step="5" value="${s.fadeSeconds ?? 0}"${off}></span></label>
      <label class="check"><input type="checkbox" name="weather"${s.weather ? ' checked' : ''}${off}> Weather comes and goes (off keeps every land clear)</label>
      ${oddsTable(p)}
      ${owner ? `<span class="row"><button type="submit">Save</button> <button type="button" data-sky-odds-reset>Back to the game's odds</button></span>` : ''}
    </form>
    <h3 class="sky-event">For an event</h3>
    <form id="sky-hour-form" class="form inline">
      <label>Set the hour now, in every land<span><select name="hour">${hours}</select><button type="submit">Set the hour</button></span></label>
    </form>
    <form id="sky-weather-form" class="form inline">
      <label>Change the weather in a land now, for one spell<span><select name="region">${lands}</select><select name="weather">${weathers}</select><button type="submit">Change the weather</button></span></label>
    </form>`;
}

/** The Owner's odds from the form, only for lands that differ from the game's own. */
function oddsFrom(f: Record<string, string>, game: SkyPage['gameOdds']): SkyConfig['odds'] {
  const out: NonNullable<SkyConfig['odds']> = {};
  for (const b of Object.keys(game) as BiomeId[]) {
    const odds: Partial<Record<Weather, number>> = {};
    for (const w of WEATHERS) {
      const n = Number(f[`odds.${b}.${w}`] ?? 0);
      if (n > 0) odds[w] = n;
    }
    const same = WEATHERS.every((w) => (odds[w] ?? 0) === (game[b][w] ?? 0));
    if (!same) out[b] = odds;
  }
  return out;
}

let lastPage: SkyPage | undefined;

async function submit(form: HTMLFormElement, f: Record<string, string>): Promise<Handled> {
  if (form.id === 'sky-form') {
    const game = (lastPage ?? (await api<SkyPage>('sky'))).gameOdds;
    const odds = oddsFrom(f, game);
    await api('sky', 'PUT', {
      dayMinutes: Number(f.dayMinutes),
      nightShare: Number(f.nightShare) / 100,
      weatherMinutes: Number(f.weatherMinutes),
      fadeSeconds: Number(f.fadeSeconds),
      weather: f.weather === 'on',
      odds: Object.keys(odds ?? {}).length ? odds : null,
    });
    toast('Saved. The sky turns this way in every land now.');
    return true;
  }
  if (form.id === 'sky-hour-form') {
    await api('sky/now', 'POST', { hour: Number(f.hour) });
    toast(`It is ${hourWords(Number(f.hour))} in every land now.`);
    return true;
  }
  if (form.id === 'sky-weather-form') {
    await api('sky/now', 'POST', { region: f.region, weather: f.weather });
    toast('The weather there is changing now. It rolls in over the next minute.');
    return true;
  }
  return false;
}

async function click(t: HTMLButtonElement): Promise<Handled> {
  if (t.dataset.skyDay) {
    await api('sky', 'PUT', { dayMinutes: Number(t.dataset.skyDay) });
    toast(`Saved. A game day now lasts ${length(Number(t.dataset.skyDay))}.`);
    return true;
  }
  if (t.dataset.skyFollow !== undefined) {
    const p = lastPage ?? (await api<SkyPage>('sky'));
    const d = new Date();
    // Noon in the game at noon on this computer's clock.
    await api('sky', 'PUT', { dayMinutes: 1440, nightShare: p.naturalNightShare, hourNow: d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 });
    toast("Saved. The game's day follows the real day on your clock.");
    return true;
  }
  if (t.dataset.skyOddsReset !== undefined) {
    await api('sky', 'PUT', { odds: null });
    toast("Every land has the game's own weather odds again.");
    return true;
  }
  return false;
}

/** Shows the night share as the slider moves. */
function change(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.name !== 'nightShare') return false;
  const out = document.getElementById('sky-night-share');
  if (out) out.textContent = `${el.value}%`;
  return true;
}

export const skyTab: Tab = { id: 'sky', label: 'Sky', page, submit, click, change };
