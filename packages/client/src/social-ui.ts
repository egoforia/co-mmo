import type { AwayMessage, PartyActionMessage, PartyInviteMessage, PartyMessage } from '@co-mmo/shared';
import { escapeHtml } from './ui.ts';

const $ = (id: string) => document.getElementById(id)!;

/** Your party: who is in it and where, plus inviting and leaving. */
export class PartyUi {
  private readonly box = $('party');
  private readonly prompt = $('party-invite');
  private myId = '';

  constructor(private readonly send: (message: PartyActionMessage) => void) {
    this.box.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.box.querySelector<HTMLInputElement>('input');
      const name = input?.value.trim();
      if (name) this.send({ t: 'party', action: 'invite', name });
      if (input) {
        input.value = '';
        input.blur();
      }
    });
    this.box.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).id === 'party-leave') this.send({ t: 'party', action: 'leave' });
    });
    this.prompt.addEventListener('click', (event) => {
      const answer = (event.target as HTMLElement).dataset.answer as 'accept' | 'decline' | undefined;
      if (!answer) return;
      this.send({ t: 'party', action: answer });
      this.prompt.hidden = true;
    });
  }

  /** Shows the box with just the invite field until a party forms. */
  start(myId: string): void {
    this.myId = myId;
    this.show(null);
  }

  show(party: PartyMessage['party']): void {
    const invite = '<input placeholder="Invite to party: name" maxlength="24" aria-label="Invite a player to your party" />';
    if (!party) {
      this.box.innerHTML = invite;
      this.box.hidden = false;
      return;
    }
    const members = party.members.map((m) => `
      <li class="${m.online ? '' : 'away'}"><span>${m.id === party.leader ? '★ ' : ''}<b>${escapeHtml(m.name)}</b>${m.id === this.myId ? ' (you)' : ''}</span>
        <span class="where">${m.online ? escapeHtml(m.region ?? '') : 'away'}</span></li>`).join('');
    this.box.innerHTML = `<h3>Party <button type="button" id="party-leave" class="quiet">Leave</button></h3><ol>${members}</ol>${invite}`;
    this.box.hidden = false;
  }

  /** Someone asked us to join: a small card to say yes or no. */
  invited(message: PartyInviteMessage): void {
    this.prompt.innerHTML = `<p><b>${escapeHtml(message.from.name)}</b> invites you to their party. Party members share XP and a chat.</p>
      <button type="button" data-answer="accept">Join</button> <button type="button" class="quiet" data-answer="decline">No thanks</button>`;
    this.prompt.hidden = false;
  }
}

/** "While you were away": what happened since you last played. */
export function showAway(message: AwayMessage): void {
  const el = $('away');
  const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `
    <h2>While you were away <button type="button" class="close" aria-label="Close">×</button></h2>
    <ul>${message.items.map((i) => `<li><span>${escapeHtml(when(i.at))}</span> ${escapeHtml(i.text)}</li>`).join('')}</ul>
    ${message.more ? `<p class="note">And ${message.more} more before that. The Bible's Chronicle has every wish.</p>` : ''}
    <button type="button" class="ok">Into the world</button>`;
  el.hidden = false;
  const close = () => (el.hidden = true);
  el.querySelector('.close')!.addEventListener('click', close);
  el.querySelector('.ok')!.addEventListener('click', close);
}
