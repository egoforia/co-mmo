import { MAX_FLOORS, floorName, type Weather } from '@co-mmo/shared';
import { escapeHtml } from '../ui.ts';
import { historyHtml, type EditList } from './core.ts';

// The edit mode's frame around the world: the top bar (land, World or Plan
// camera, floor, hour and weather, what the editor marks, drafts and Publish, Done) and the status
// strip (what is under the pointer, the last thing that happened, Undo and
// Redo). The game's own HUD steps back while the editor is open (the
// `editing` class on the page), so the world gets the room. Plain HTML from
// state; in-game.ts listens to the inputs by their names and data keys.

/** The hours the editor can show a land at, as phases of the day (sky.ts: dawn from 5, day from 7, dusk from 18, night from 20). */
export const PREVIEW_HOURS: Record<string, { name: string; phase?: number }> = {
  '': { name: 'Hour: now' },
  dawn: { name: 'Dawn', phase: 6 / 24 },
  day: { name: 'Midday', phase: 12 / 24 },
  dusk: { name: 'Dusk', phase: 19 / 24 },
  night: { name: 'Midnight', phase: 0 },
};
/** The weather the editor can show a land in ('' is as it is). */
export const PREVIEW_WEATHER: (Weather | '')[] = ['', 'clear', 'cloudy', 'rain', 'storm', 'fog', 'snow', 'sandstorm'];

/** The hour and weather the editor shows a land in ('' and none: as they are). */
export interface SkyChoice {
  hour: string;
  weather?: Weather;
}

/** Sets the hour or the weather chosen (left as they were when not given); what the scene's previewSky is asked to show. */
export function chooseSky(sky: SkyChoice, hour?: string, weather?: string): { phase?: number; weather?: Weather } {
  if (hour !== undefined) sky.hour = Object.hasOwn(PREVIEW_HOURS, hour) ? hour : '';
  if (weather !== undefined) sky.weather = (PREVIEW_WEATHER as string[]).includes(weather) && weather ? (weather as Weather) : undefined;
  const phase = PREVIEW_HOURS[sky.hour]?.phase;
  return { ...(phase !== undefined ? { phase } : {}), ...(sky.weather ? { weather: sky.weather } : {}) };
}

/** What the status strip says after a change was sent. */
export function doneWords(action: object, live: boolean): string {
  return 'undo' in action ? 'Taken back.' : 'redo' in action ? 'Made again.' : 'remove' in action ? 'Taken out.'
    : 'publish' in action ? 'Published. Everyone here sees it now.' : 'discard' in action ? 'Drafts thrown away. Redo brings them back.'
    : live ? 'Done. Everyone here sees it now.' : 'Drafted. Only editors see it until you publish.';
}

/** What the top bar shows. */
export interface BarState {
  /** The land whose edits the editor works on. */
  land: string;
  /** The floor shown, and whether it is chosen (false: it follows the one we stand on). */
  floor: number;
  floorChosen: boolean;
  sky: SkyChoice;
  /** The camera looking: the World or the Plan. */
  camera: 'world' | 'plan';
  showGrid: boolean;
  showHitboxes: boolean;
  list: EditList;
  live: boolean;
  busy: boolean;
  /** The drafts pill's menu is open (it stays open when the bar is drawn again). */
  menuOpen?: boolean;
}

/** What the status strip shows. */
export interface StripState {
  /** What is under the pointer, or empty when it is off the world. */
  here: string;
  status: string;
  list: EditList;
  busy: boolean;
  chatOpen: boolean;
}

const option = (value: string, label: string, chosen: boolean) => `<option value="${escapeHtml(value)}"${chosen ? ' selected' : ''}>${escapeHtml(label)}</option>`;

/** The top bar: land, floor stepper, hour and weather, the marks, drafts and Publish, Done. */
export function barHtml(s: BarState): string {
  const floors = Array.from({ length: MAX_FLOORS.up + MAX_FLOORS.down + 1 }, (_, i) => MAX_FLOORS.up - i);
  const up = s.floor < MAX_FLOORS.up ? '' : ' disabled';
  const down = s.floor > -MAX_FLOORS.down ? '' : ' disabled';
  const floor = `<span class="floor-step" role="group" aria-label="Floor">
      <button type="button" class="quiet" data-floor-step="1" title="The floor above" aria-label="The floor above"${up}>▲</button>
      <select name="view-floor" class="floor-name" aria-label="The floor shown">${floors.map((f) => option(String(f), capital(floorName(f)), f === s.floor)).join('')}</select>
      <button type="button" class="quiet" data-floor-step="-1" title="The floor below" aria-label="The floor below"${down}>▼</button>
      ${s.floorChosen ? '<button type="button" class="quiet" data-floor-mine title="Show the floor you stand on again">My floor</button>' : ''}
    </span>`;
  const hours = Object.entries(PREVIEW_HOURS).map(([id, h]) => option(id, h.name, s.sky.hour === id)).join('');
  const weathers = PREVIEW_WEATHER.map((w) => option(w, w === '' ? 'Weather: now' : w[0]!.toUpperCase() + w.slice(1), (s.sky.weather ?? '') === w)).join('');
  const sky = `<span class="sky-pick" title="See the land at another hour or in other weather. Only you see this.">
      <select name="view-hour" aria-label="See it at">${hours}</select><select name="view-weather" aria-label="In weather">${weathers}</select></span>`;
  const marks = `<span class="view-toggles">
      <label class="toggle" title="Thin lines around every tile near you"><input type="checkbox" name="tile-grid"${s.showGrid ? ' checked' : ''} /> Tiles</label>
      <label class="toggle" title="Tiles nobody can walk on"><input type="checkbox" name="hitboxes"${s.showHitboxes ? ' checked' : ''} /> Hitboxes</label></span>`;
  const camera = `<span class="seg camera-pick" role="group" aria-label="Camera" title="Switch cameras (Tab)">${([['world', 'World'], ['plan', 'Plan']] as const).map(([id, name]) =>
    `<button type="button" data-camera="${id}" class="${s.camera === id ? 'on' : 'quiet'}" aria-pressed="${s.camera === id}">${name}</button>`).join('')}</span>`;
  // The plan has its own tiles and hitboxes switches, and no sky.
  return `<span class="land-name" title="The land you are editing">✎ <b>${escapeHtml(s.land)}</b></span>
    ${camera}${floor}${s.camera === 'world' ? `${sky}${marks}` : ''}<span class="spacer"></span>${draftsPillHtml(s.list, s.live, s.busy, s.menuOpen)}
    <button type="button" class="quiet done" data-done title="Close the editor (Esc)">Done <kbd>Esc</kbd></button>`;
}

/**
 * The drafts pill: how many changes only editors see, Publish (`data-publish`),
 * and a menu with Throw away (`data-discard`) and whether new changes go live at once (`name="live"`).
 */
export function draftsPillHtml(list: EditList, live: boolean, busy = false, menuOpen = false): string {
  const drafts = list.edits.filter((e) => e.draft).length;
  const off = busy ? ' disabled' : '';
  const words = live ? 'Changes go live at once' : drafts ? `${drafts} draft${drafts === 1 ? '' : 's'}` : 'No drafts';
  const title = drafts ? `Only editors see ${drafts === 1 ? 'it' : 'them'} until you publish.` : live ? 'Everyone sees each change as you make it.' : 'New changes wait as drafts that only editors see.';
  return `<span class="drafts-pill${drafts ? ' has-drafts' : ''}" title="${escapeHtml(title)}">
      ${drafts ? '<span class="dot" aria-hidden="true"></span>' : ''}<span>${escapeHtml(words)}</span>
      ${drafts ? `<button type="button" data-publish${off}>Publish</button>` : ''}
      <details class="publish-menu"${menuOpen ? ' open' : ''}><summary aria-label="Draft settings" title="Draft settings">▾</summary><div class="menu">
        <label class="check"><input type="checkbox" name="live"${live ? ' checked' : ''} /> Make my changes live at once</label>
        ${drafts ? `<button type="button" class="quiet" data-discard${off}>Throw ${drafts === 1 ? 'the draft' : `all ${drafts} drafts`} away</button>` : ''}
      </div></details></span>`;
}

/** The status strip: what is under the pointer, the last thing that happened, the camera's keys and buttons, chat, Undo and Redo. */
export function stripHtml(s: StripState): string {
  return `<span class="here" aria-label="Under the pointer">${escapeHtml(s.here || 'Point at the world')}</span>
    <span class="status" aria-live="polite">${escapeHtml(s.status)}</span>
    <span class="camera-keys note" title="W A S D or the arrow keys pan (Shift: faster), the wheel or + and − zoom, a right-drag pans">Pan WASD · Zoom wheel</span>
    <button type="button" class="quiet" data-me title="The camera goes back to you (Home)">Back to me</button>
    <button type="button" class="quiet" data-bring title="Moves you to the middle of the screen">Bring me here</button>
    <button type="button" class="quiet" data-chat aria-pressed="${s.chatOpen}" title="Show or hide the chat">Chat</button>
    <button type="button" class="quiet" data-keys title="Every key the editor knows (?)">Keys <kbd>?</kbd></button>
    ${historyHtml(s.list, s.busy)}`;
}

/** A phrase with its first letter made a capital, to stand alone as a label. */
function capital(words: string): string {
  return words ? words[0]!.toUpperCase() + words.slice(1) : words;
}
