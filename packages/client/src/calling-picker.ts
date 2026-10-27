import { CALLINGS, CALLING_IDS, RACES, RACE_IDS, STAT_NAMES, type CallingId, type RaceId } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

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
