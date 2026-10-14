import type { ChatChannel, ChatSendMessage, PartyActionMessage, ReportMessage, TradeActionMessage } from '@co-mmo/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function showPanel(html: string): HTMLElement {
  const panel = $('panel');
  panel.innerHTML = html;
  panel.hidden = false;
  return panel;
}

export function hidePanel(): void {
  $('panel').hidden = true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** True while a text field has focus, so keys type instead of acting. */
export function isTyping(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

let toastTimer: number | undefined;
export function toast(text: string, ms = 6000): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

export type ChatLine =
  /** `to` is set on whispers; `outgoing` on whispers you sent. */
  | { kind: 'chat'; channel: ChatChannel; from: string; to?: string; outgoing?: boolean; text: string }
  | { kind: 'system' | 'error'; text: string };

const PREFIX: Partial<Record<ChatChannel, string>> = { region: '[Region] ', party: '[Party] ', world: '[World] ' };

/** What a line typed in the chat box asks for. */
export type ChatIntent = ChatSendMessage | PartyActionMessage | ReportMessage | TradeActionMessage | { t: 'help' } | { t: 'problem'; text: string };

/**
 * Reads a chat line: a slash command (/w Name hi, /p, /invite Name, /report
 * Name why...) or plain words for the chosen channel. A whisper picked from
 * the channel list starts with the name.
 */
export function readChat(channel: ChatChannel, raw: string): ChatIntent {
  const text = raw.trim();
  const command = text.match(/^\/(\w+)\s*(.*)$/s);
  const nameThen = (rest: string) => rest.match(/^@?(\S+)\s*(.*)$/s);
  if (!command) {
    if (channel !== 'whisper') return { t: 'chat', channel, text };
    const m = nameThen(text);
    if (!m?.[2]) return { t: 'problem', text: 'Start a whisper with their name, then your message.' };
    return { t: 'chat', channel, to: m[1]!, text: m[2] };
  }
  const [, verb, rest] = [command[0], command[1]!.toLowerCase(), command[2]!.trim()];
  switch (verb) {
    case 'w':
    case 'whisper':
    case 'tell': {
      const m = nameThen(rest);
      if (!m?.[2]) return { t: 'problem', text: 'Write /w, their name, then your message.' };
      return { t: 'chat', channel: 'whisper', to: m[1]!, text: m[2] };
    }
    case 'r':
    case 'reply':
      return rest ? { t: 'chat', channel: 'whisper', text: rest } : { t: 'problem', text: 'Write /r and your reply.' };
    case 's':
    case 'say':
      return { t: 'chat', channel: 'say', text: rest };
    case 'region':
      return { t: 'chat', channel: 'region', text: rest };
    case 'p':
    case 'party':
      return { t: 'chat', channel: 'party', text: rest };
    case 'world':
      return { t: 'chat', channel: 'world', text: rest };
    case 'invite':
      return rest ? { t: 'party', action: 'invite', name: rest.replace(/^@/, '') } : { t: 'problem', text: 'Write /invite and their name.' };
    case 'accept':
      return { t: 'party', action: 'accept' };
    case 'decline':
      return { t: 'party', action: 'decline' };
    case 'leave':
      return { t: 'party', action: 'leave' };
    case 'trade':
      return rest ? { t: 'trade', action: 'request', name: rest.replace(/^@/, '') } : { t: 'problem', text: 'Write /trade and the name of someone nearby.' };
    case 'report': {
      const m = nameThen(rest);
      if (!m?.[2]) return { t: 'problem', text: 'Write /report, their name, and what happened.' };
      return { t: 'report', kind: 'player', target: m[1]!, reason: m[2] };
    }
    case 'help':
      return { t: 'help' };
    default:
      return { t: 'problem', text: `There is no /${verb}. Type /help to see what you can do.` };
  }
}

export const CHAT_HELP = 'Chat: /s nearby, /region everyone here, /p your party, /w Name to whisper, /r to answer a whisper, /world everyone. Party: /invite Name, /accept, /decline, /leave. /trade Name trades with someone nearby. /report Name what happened tells the Stewards.';

export class ChatBox {
  private readonly log = $<HTMLOListElement>('chat-log');
  private readonly form = $<HTMLFormElement>('chat-form');
  private readonly input = $<HTMLInputElement>('chat-input');
  private readonly channel = $<HTMLSelectElement>('chat-channel');

  constructor(onSend: (channel: ChatChannel, text: string) => void) {
    $('chat').hidden = false;
    this.channel.addEventListener('change', () => {
      this.input.placeholder = this.channel.value === 'whisper' ? 'Their name, then your message' : 'Press Enter to talk';
    });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (text) onSend(this.channel.value as ChatChannel, text);
      this.input.value = '';
      this.input.blur();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !isTyping()) {
        event.preventDefault();
        this.input.focus();
      } else if (event.key === 'Escape' && document.activeElement === this.input) {
        this.input.blur();
      }
    });
  }

  get typing(): boolean {
    const active = document.activeElement;
    return active === this.input || active === this.channel;
  }

  add(line: ChatLine): void {
    const li = document.createElement('li');
    if (line.kind === 'chat' && line.channel === 'whisper') {
      li.className = 'whisper';
      li.innerHTML = line.outgoing
        ? `[To <b>${escapeHtml(line.to ?? '')}</b>] ${escapeHtml(line.text)}`
        : `[<b>${escapeHtml(line.from)}</b> whispers] ${escapeHtml(line.text)}`;
    } else if (line.kind === 'chat') {
      li.className = line.channel;
      li.innerHTML = `${PREFIX[line.channel] ?? ''}<b>${escapeHtml(line.from)}</b>: ${escapeHtml(line.text)}`;
    } else {
      li.className = line.kind;
      li.textContent = line.text;
    }
    const atBottom = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 4;
    this.log.append(li);
    while (this.log.children.length > 200) this.log.firstElementChild?.remove();
    if (atBottom) this.log.scrollTop = this.log.scrollHeight;
  }
}

export function setHud(name: string, online: number, region: string): void {
  $('hud').hidden = false;
  $('hud-name').textContent = region ? `${name} · ${region}` : name;
  $('hud-online').textContent = `${online} online`;
}

export function onInviteClick(handler: () => void): void {
  $('invite-button').addEventListener('click', handler);
}

export function onAccountClick(handler: () => void): void {
  $('account-button').addEventListener('click', handler);
}
