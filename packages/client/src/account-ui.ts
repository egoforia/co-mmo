import { MAX_LOOK_LENGTH } from '@co-mmo/shared';
import { accountInfo, describeLook, emailSignIn, linkUrl, setEmail, signInOptions, signOut, type AccountInfo } from './api.ts';
import { escapeHtml, showPanel } from './ui.ts';

const PROVIDER_NAME = { google: 'Google', github: 'GitHub' } as const;

/** The front door: sign in by email link, Google or GitHub; new players need an invite. */
export async function showSignIn(message = ''): Promise<void> {
  const options = await signInOptions().catch(() => ({ email: 'log' as const, google: false, github: false }));
  const buttons = (['google', 'github'] as const)
    .filter((p) => options[p])
    .map((p) => `<a class="button quiet" href="/api/auth/${p}/start">Sign in with ${PROVIDER_NAME[p]}</a>`)
    .join('');
  const panel = showPanel(`
    <h1>co-MMO</h1>
    <p>This world is invite-only. New here? Ask a friend who plays for an invite link.</p>
    <form id="signin-form">
      <label for="signin-email">Already playing? Get a sign-in link by email</label>
      <input id="signin-email" type="email" autocomplete="email" required />
      <button type="submit">Send me a link</button>
      ${buttons}
      <p class="error" id="signin-message">${escapeHtml(message)}</p>
    </form>`);
  const form = panel.querySelector<HTMLFormElement>('#signin-form')!;
  const note = panel.querySelector<HTMLElement>('#signin-message')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    note.className = 'error';
    note.textContent = '';
    try {
      note.textContent = await emailSignIn(panel.querySelector<HTMLInputElement>('#signin-email')!.value);
      if (options.email === 'log') note.textContent += ' (Email is not set up on this server yet: the link is printed in its console.)';
      note.className = 'note';
    } catch (err) {
      note.textContent = (err as Error).message;
    }
  });
}

/** The Account window: sign-in email, linked Google and GitHub, your look, signing out. */
export class AccountWindow {
  private readonly el = document.getElementById('account')!;

  constructor(private readonly token: string) {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.el.hidden) this.el.hidden = true;
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  async toggle(show = this.el.hidden): Promise<void> {
    if (!show) {
      this.el.hidden = true;
      return;
    }
    this.el.innerHTML = '<h2>Account</h2><p>Loading...</p>';
    this.el.hidden = false;
    try {
      this.render(await accountInfo(this.token));
    } catch (err) {
      this.el.innerHTML = `<h2>Account <button type="button" class="close" aria-label="Close">×</button></h2><p>${escapeHtml((err as Error).message)}</p>`;
      this.el.querySelector('.close')!.addEventListener('click', () => this.toggle(false));
    }
  }

  private render(info: AccountInfo): void {
    const providers = (['google', 'github'] as const).filter((p) => info.providers[p] || info.logins.includes(p));
    const lookHtml = info.look
      ? `<p class="look">${info.look.art ? `<img src="${escapeHtml(info.look.art)}" alt="">` : ''}${escapeHtml(info.look.description)}</p>`
      : `<p>Describe how you look and the God will paint you. It is your first wish, and it is free.</p>
         <textarea id="look-words" maxlength="${MAX_LOOK_LENGTH}" rows="3" placeholder="A tall elf with a green hood, a fox-fur cape and a lantern"></textarea>
         <button type="button" id="look-send">Describe my look</button>`;
    this.el.innerHTML = `
      <h2>${escapeHtml(info.name)} <button type="button" class="close" aria-label="Close">×</button></h2>
      <h3>Your look</h3>
      ${lookHtml}
      <h3>Signing in</h3>
      <p>${info.email ? `Sign-in links go to <b>${escapeHtml(info.email)}</b>.` : 'Add an email to sign in from any device.'}</p>
      <form id="email-form" class="row">
        <input id="email-input" type="email" autocomplete="email" placeholder="${info.email ? 'A new email' : 'you@example.com'}" required />
        <button type="submit">${info.email ? 'Change' : 'Add'}</button>
      </form>
      ${providers.map((p) => info.logins.includes(p)
        ? `<p>✓ ${PROVIDER_NAME[p]} is linked.</p>`
        : `<button type="button" class="quiet" data-link="${p}">Link ${PROVIDER_NAME[p]}</button>`).join('')}
      <p class="note" id="account-note"></p>
      <button type="button" class="quiet" id="sign-out">Sign out on this device</button>`;
    const note = this.el.querySelector<HTMLElement>('#account-note')!;
    const say = (text: string, error = false) => {
      note.textContent = text;
      note.className = error ? 'error' : 'note';
    };
    this.el.querySelector('.close')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelector('#look-send')?.addEventListener('click', async () => {
      try {
        say(await describeLook(this.token, this.el.querySelector<HTMLTextAreaElement>('#look-words')!.value));
        this.el.querySelector('#look-words')?.setAttribute('disabled', '');
      } catch (err) {
        say((err as Error).message, true);
      }
    });
    this.el.querySelector<HTMLFormElement>('#email-form')!.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        say(await setEmail(this.token, this.el.querySelector<HTMLInputElement>('#email-input')!.value));
        if (info.providers.email === 'log') say(`${note.textContent} (Email is not set up on this server yet: the link is printed in its console.)`);
      } catch (err) {
        say((err as Error).message, true);
      }
    });
    for (const button of this.el.querySelectorAll<HTMLButtonElement>('[data-link]')) {
      button.addEventListener('click', async () => {
        try {
          location.href = await linkUrl(this.token, button.dataset.link as 'google' | 'github');
        } catch (err) {
          say((err as Error).message, true);
        }
      });
    }
    this.el.querySelector('#sign-out')!.addEventListener('click', async () => {
      await signOut(this.token);
      location.href = '/';
    });
  }
}
