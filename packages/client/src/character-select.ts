import { MAX_LOOK_LENGTH, MAX_NAME_LENGTH } from '@co-mmo/shared';
import { chooseCharacter, createCharacter, deleteCharacter, listCharacters, type CharacterCard, type Roster } from './api.ts';
import { callingPickerHtml, pickedCalling, wireCallingPicker } from './calling-picker.ts';
import { escapeHtml, showPanel, toast } from './ui.ts';

// The character screen (docs/characters.md): every character on your
// account, which one to play, a new one, and deleting one. It shows after
// sign-in when an account has more than one character, and from Account >
// Switch character. The server remembers the choice, so the game socket
// enters the world as the chosen one.

/** Shows your characters; `play` enters the world once one is chosen. */
export async function showCharacters(token: string, play: () => void, message = ''): Promise<void> {
  showPanel('<h1>Your characters</h1><p>Loading...</p>');
  let roster: Roster;
  try {
    roster = await listCharacters(token);
  } catch (err) {
    showPanel(`<h1>Your characters</h1><p class="error">${escapeHtml((err as Error).message)}</p><button type="button" onclick="location.reload()">Try again</button>`);
    return;
  }
  const room = roster.characters.length < roster.max;
  const panel = showPanel(`
    <h1>Your characters</h1>
    <p>Choose who enters the world. Each character has their own Favor, things, look and wishes.</p>
    <ul class="characters">${roster.characters.map((c) => cardHtml(c, c.id === roster.playing, roster.characters.length > 1)).join('')}</ul>
    ${room
      ? '<button type="button" class="quiet" id="new-character">New character</button>'
      : `<p class="hint">You have ${roster.max} characters, the most one account may have. Delete one to make room.</p>`}
    <p class="error" id="characters-error">${escapeHtml(message)}</p>`);
  const error = panel.querySelector<HTMLElement>('#characters-error')!;
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-play]')) {
    button.addEventListener('click', async () => {
      try {
        await chooseCharacter(token, button.dataset.play!);
        play();
      } catch (err) {
        error.textContent = (err as Error).message;
      }
    });
  }
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-delete]')) {
    button.addEventListener('click', () => {
      const c = roster.characters.find((x) => x.id === button.dataset.delete)!;
      showDelete(token, c, play);
    });
  }
  panel.querySelector('#new-character')?.addEventListener('click', () => showNewCharacter(token, play));
}

/** One character's line: picture, name, people and Calling, level, where they are. */
function cardHtml(c: CharacterCard, last: boolean, canDelete: boolean): string {
  const what = [c.race, c.calling].filter(Boolean).join(' ');
  const where = c.online ? 'In the world now' : c.region ? `In ${c.region}` : '';
  return `
    <li class="character${last ? ' last' : ''}">
      ${c.art ? `<img src="${escapeHtml(c.art)}" alt="">` : '<span class="no-art"></span>'}
      <div class="about">
        <b>${escapeHtml(c.name)}</b>
        <span>Level ${c.level}${what ? ` ${escapeHtml(what)}` : ''}</span>
        <span class="hint">${escapeHtml(where)}${last ? ' · played last' : ''}</span>
      </div>
      <div class="actions">
        <button type="button" data-play="${c.id}">Play</button>
        ${canDelete ? `<button type="button" class="quiet" data-delete="${c.id}" aria-label="Delete ${escapeHtml(c.name)}">Delete</button>` : ''}
      </div>
    </li>`;
}

/** The form for a new character: a name, a people and Calling, and a look. */
function showNewCharacter(token: string, play: () => void): void {
  const panel = showPanel(`
    <h1>New character</h1>
    <p>They start in the Sanctum at level 1, with their own things and Favor.</p>
    <form id="character-form">
      <label for="name">Character name</label>
      <input id="name" type="text" maxlength="${MAX_NAME_LENGTH}" required autofocus />
      ${callingPickerHtml()}
      <label for="look">How do they look? <span class="hint">Their first wish, free: the God paints them as one of their people.</span></label>
      <textarea id="look" maxlength="${MAX_LOOK_LENGTH}" rows="3" placeholder="Lean and grey-muzzled, in a patched travelling cloak"></textarea>
      <button type="submit">Make this character</button>
      <button type="button" class="quiet" id="back">Back to your characters</button>
      <p class="error" id="character-error"></p>
    </form>`);
  const form = panel.querySelector<HTMLFormElement>('#character-form')!;
  wireCallingPicker(form);
  panel.querySelector('#back')!.addEventListener('click', () => void showCharacters(token, play));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = (id: string) => panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value;
    const error = panel.querySelector<HTMLElement>('#character-error')!;
    error.textContent = '';
    const { race, calling } = pickedCalling(form);
    if (!race || !calling) {
      error.textContent = 'Choose both their people and their Calling.';
      return;
    }
    try {
      const { notes } = await createCharacter(token, { name: field('name'), look: field('look'), race, calling });
      if (notes.length) toast(notes.join(' '), 12000);
      play();
    } catch (err) {
      error.textContent = (err as Error).message;
    }
  });
}

/** Asks for the character's name before deleting them for good. */
function showDelete(token: string, c: CharacterCard, play: () => void): void {
  const panel = showPanel(`
    <h1>Delete ${escapeHtml(c.name)}?</h1>
    <p>${escapeHtml(c.name)} and everything they carry, wear and have saved up are gone for good. This cannot be undone.</p>
    <form id="delete-form">
      <label for="confirm-name">Type <b>${escapeHtml(c.name)}</b> to delete them</label>
      <input id="confirm-name" type="text" autocomplete="off" required autofocus />
      <button type="submit" class="danger">Delete ${escapeHtml(c.name)}</button>
      <button type="button" class="quiet" id="back">Keep them</button>
      <p class="error" id="delete-error"></p>
    </form>`);
  panel.querySelector('#back')!.addEventListener('click', () => void showCharacters(token, play));
  panel.querySelector<HTMLFormElement>('#delete-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await deleteCharacter(token, c.id, panel.querySelector<HTMLInputElement>('#confirm-name')!.value);
      toast(`${c.name} is gone.`);
      void showCharacters(token, play);
    } catch (err) {
      panel.querySelector('#delete-error')!.textContent = (err as Error).message;
    }
  });
}
