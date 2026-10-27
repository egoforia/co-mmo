import { CALLINGS, CALLING_IDS, RACES, RACE_IDS, STAT_NAMES, type CallingId, type RaceId } from '@co-mmo/shared';
import { escapeHtml, showPanel } from './ui.ts';

// Choosing a people and a Calling (docs/races.md, docs/classes.md): two
// lists with a line under each that says what the choice gives. Used by the
// invite form and by the screen characters from before Callings see.

/** The two choosers' HTML, for inside a form. */
export function callingPickerHtml(): string {
  const options = (ids: readonly string[], name: (id: string) => string) =>
    `<option value="" selected disabled>Choose...</option>${ids.map((id) => `<option value="${id}">${escapeHtml(name(id))}</option>`).join('')}`;
  return `
    <label for="race">Your people <span class="hint">Your body and your family's stories.</span></label>
    <select id="race" required>${options(RACE_IDS, (id) => RACES[id as RaceId].name)}</select>
    <p class="hint" id="race-about">Five beastfolk peoples. Any people can take any Calling.</p>
    <label for="calling">Your Calling <span class="hint">How you fight and help others.</span></label>
    <select id="calling" required>${options(CALLING_IDS, (id) => `${CALLINGS[id as CallingId].name} (${CALLINGS[id as CallingId].role})`)}</select>
    <p class="hint" id="calling-about">You can change it later with a wish.</p>`;
}

/** Keeps the lines under the choosers in step with what is picked. */
export function wireCallingPicker(root: HTMLElement): void {
  const race = root.querySelector<HTMLSelectElement>('#race')!;
  const calling = root.querySelector<HTMLSelectElement>('#calling')!;
  race.addEventListener('change', () => {
    const r = RACES[race.value as RaceId];
    const lift = Object.keys(r.lift).map((k) => `${STAT_NAMES[k as keyof typeof STAT_NAMES]} +1`).join(', ');
    root.querySelector('#race-about')!.textContent = `${r.blurb} ${lift}. ${r.traitName}: ${r.traitText}`;
  });
  calling.addEventListener('change', () => {
    const c = CALLINGS[calling.value as CallingId];
    root.querySelector('#calling-about')!.textContent = `${c.blurb} Grows in ${STAT_NAMES[c.primary]} and ${STAT_NAMES[c.secondary]}.`;
  });
}

/** What is picked; empty strings until both are chosen (the server checks them). */
export function pickedCalling(root: HTMLElement): { race: string; calling: string } {
  return {
    race: root.querySelector<HTMLSelectElement>('#race')!.value,
    calling: root.querySelector<HTMLSelectElement>('#calling')!.value,
  };
}

/**
 * The screen a character from before Callings sees on joining: they keep
 * their level, things and Favor, and their attributes are rebuilt for the
 * chosen people and Calling with free points to place.
 */
export function showCallingChoice(level: number, choose: (race: RaceId, calling: CallingId) => void): void {
  const free = level - 1;
  const panel = showPanel(`
    <h1>Choose your people and Calling</h1>
    <p>The world has learned of the five peoples and the five Callings. You keep your level, your things and your Favor.
    Your attributes are set again for what you choose${free > 0 ? `, with ${free} free point${free > 1 ? 's' : ''} for you to place` : ''}.</p>
    <form id="calling-form">
      ${callingPickerHtml()}
      <button type="submit">Enter the world</button>
      <p class="error" id="calling-error"></p>
    </form>`);
  const form = panel.querySelector<HTMLFormElement>('#calling-form')!;
  wireCallingPicker(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const { race, calling } = pickedCalling(form);
    if (!race || !calling) {
      form.querySelector('#calling-error')!.textContent = 'Choose both your people and your Calling.';
      return;
    }
    showPanel('<h1>co-MMO</h1><p>Entering the world...</p>');
    choose(race as RaceId, calling as CallingId);
  });
}
