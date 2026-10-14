import type { ChatChannel } from '@co-mmo/shared';

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

let toastTimer: number | undefined;
export function toast(text: string, ms = 6000): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}

export type ChatLine =
  | { kind: 'chat'; channel: ChatChannel; from: string; text: string }
  | { kind: 'system' | 'error'; text: string };

export class ChatBox {
  private readonly log = $<HTMLOListElement>('chat-log');
  private readonly form = $<HTMLFormElement>('chat-form');
  private readonly input = $<HTMLInputElement>('chat-input');
  private readonly channel = $<HTMLSelectElement>('chat-channel');

  constructor(onSend: (channel: ChatChannel, text: string) => void) {
    $('chat').hidden = false;
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (text) onSend(this.channel.value as ChatChannel, text);
      this.input.value = '';
      this.input.blur();
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && document.activeElement !== this.input) {
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
    if (line.kind === 'chat') {
      li.className = line.channel;
      const prefix = line.channel === 'world' ? '[World] ' : '';
      li.innerHTML = `${prefix}<b>${escapeHtml(line.from)}</b>: ${escapeHtml(line.text)}`;
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

export function setHud(name: string, online: number): void {
  $('hud').hidden = false;
  $('hud-name').textContent = name;
  $('hud-online').textContent = `${online} online`;
}

export function onInviteClick(handler: () => void): void {
  $('invite-button').addEventListener('click', handler);
}
