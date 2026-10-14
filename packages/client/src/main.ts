import Phaser from 'phaser';
import type { ServerMessage, WelcomeMessage } from '@co-mmo/shared';
import { MAX_NAME_LENGTH } from '@co-mmo/shared';
import { acceptInvite, checkInvite, clearToken, createInvite, loadToken, saveToken } from './api.ts';
import { GameConnection } from './net.ts';
import { ChatBox, escapeHtml, hidePanel, onInviteClick, setHud, showPanel, toast } from './ui.ts';
import { WorldScene } from './world-scene.ts';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  const token = loadToken();

  if (invite && !token) return showInvite(invite);
  if (invite && token) history.replaceState(null, '', location.pathname);
  if (token) return play(token);
  showPanel(`
    <h1>co-MMO</h1>
    <p>This world is invite-only. Ask a friend who plays for an invite link.</p>`);
}

async function showInvite(code: string): Promise<void> {
  const check = await checkInvite(code).catch(() => ({ valid: false }) as { valid: boolean; invitedBy?: string | null; role?: string });
  if (!check.valid) {
    showPanel(`<h1>co-MMO</h1><p>This invite link is not valid or was already used. Ask for a new one.</p>`);
    return;
  }
  const who = check.role === 'owner'
    ? 'You are creating the Owner account for this world.'
    : `${escapeHtml(check.invitedBy ?? 'A friend')} invited you to help build this world.`;
  const panel = showPanel(`
    <h1>Welcome to co-MMO</h1>
    <p>${who}</p>
    <form id="accept-form">
      <label for="name">Character name</label>
      <input id="name" type="text" maxlength="${MAX_NAME_LENGTH}" required autofocus />
      <label class="check"><input id="adult" type="checkbox" required /> I am 18 or older. This game has mature content.</label>
      <button type="submit">Enter the world</button>
      <p class="error" id="accept-error"></p>
    </form>`);
  const form = panel.querySelector<HTMLFormElement>('#accept-form')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = panel.querySelector<HTMLInputElement>('#name')!.value;
    const adult = panel.querySelector<HTMLInputElement>('#adult')!.checked;
    const error = panel.querySelector<HTMLElement>('#accept-error')!;
    error.textContent = '';
    try {
      const { token } = await acceptInvite(code, name, adult);
      saveToken(token);
      history.replaceState(null, '', location.pathname);
      play(token);
    } catch (err) {
      error.textContent = (err as Error).message;
    }
  });
}

function play(token: string): void {
  showPanel('<h1>co-MMO</h1><p>Entering the world...</p>');
  let scene: WorldScene | null = null;
  let chat: ChatBox | null = null;
  let name = '';

  const connection = new GameConnection(token, onMessage, (reason, code) => {
    if (code === 4001) {
      clearToken();
      showPanel('<h1>co-MMO</h1><p>Your session is no longer valid. Use an invite link to join again.</p>');
      return;
    }
    showPanel(`<h1>Disconnected</h1><p>${escapeHtml(reason || 'Lost connection to the world.')}</p><button type="button" onclick="location.reload()">Reconnect</button>`);
  });

  function onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        start(message);
        break;
      case 'snapshot':
        scene?.onSnapshot(message);
        setHud(name, message.online);
        break;
      case 'chat':
        chat?.add({ kind: 'chat', channel: message.channel, from: message.from.name, text: message.text });
        break;
      case 'system':
        chat?.add({ kind: 'system', text: message.text });
        break;
      case 'error':
        chat?.add({ kind: 'error', text: message.message });
        break;
    }
  }

  function start(welcome: WelcomeMessage): void {
    hidePanel();
    name = welcome.you.name;
    chat = new ChatBox((channel, text) => connection.send({ t: 'chat', channel, text }));
    chat.add({ kind: 'system', text: 'Move with WASD or the arrow keys. Press Enter to talk.' });
    scene = new WorldScene({
      welcome,
      send: (m) => connection.send(m),
      typing: () => chat?.typing ?? false,
    });
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#181425',
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene,
    });
    setHud(name, 1);
    onInviteClick(async () => {
      try {
        const url = await createInvite(token);
        await navigator.clipboard?.writeText(url).catch(() => undefined);
        toast(`Invite link (copied if your browser allowed it): ${url}`, 15000);
      } catch (err) {
        toast((err as Error).message);
      }
    });
  }
}

boot();
