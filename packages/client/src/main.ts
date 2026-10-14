import Phaser from 'phaser';
import type { ArtManifest, ServerMessage, WelcomeMessage } from '@co-mmo/shared';
import { MAX_NAME_LENGTH } from '@co-mmo/shared';
import { acceptInvite, checkInvite, clearToken, createInvite, loadToken, saveToken } from './api.ts';
import { GameConnection } from './net.ts';
import { ChatBox, escapeHtml, hidePanel, onInviteClick, setHud, showPanel, toast } from './ui.ts';
import { RpgUi } from './rpg-ui.ts';
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
  let rpg: RpgUi | null = null;
  let name = '';
  let region = '';
  // Art loads alongside the connection; the world waits for both.
  const art: Promise<ArtManifest> = fetch('/art/manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<ArtManifest>) : {}))
    .catch(() => ({}));

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
        region = message.region.name;
        rpg?.setCharacter(message.character);
        if (scene) scene.enterRegion(message);
        else void art.then((manifest) => start(message, manifest));
        break;
      case 'snapshot':
        scene?.onSnapshot(message);
        rpg?.setHp(message.hp);
        scene?.setWeakened(rpg?.weakened ?? false);
        setHud(name, message.online, region);
        break;
      case 'chat':
        chat?.add({ kind: 'chat', channel: message.channel, from: message.from.name, text: message.text });
        break;
      case 'system':
        chat?.add({ kind: 'system', text: message.text });
        break;
      case 'hit':
        scene?.onHit(message);
        break;
      case 'character':
        rpg?.setCharacter(message.character);
        break;
      case 'notice':
        chat?.add({ kind: 'system', text: message.text });
        break;
      case 'dialogue':
        rpg?.showDialogue(message);
        break;
      case 'error':
        chat?.add({ kind: 'error', text: message.message });
        break;
    }
  }

  function start(welcome: WelcomeMessage, manifest: ArtManifest): void {
    hidePanel();
    name = welcome.you.name;
    chat = new ChatBox((channel, text) => connection.send({ t: 'chat', channel, text }));
    chat.add({ kind: 'system', text: 'Move with WASD or the arrow keys. Space strikes, E talks, I opens your bag, B opens the Bible. Press Enter to chat.' });
    rpg = new RpgUi(welcome.character, {
      attack: () => {
        connection.send({ t: 'attack' });
        scene?.swing();
      },
      interact: () => connection.send({ t: 'interact' }),
      use: (item) => connection.send({ t: 'use', item }),
      accept: (quest) => connection.send({ t: 'accept', quest }),
      typing: () => chat?.typing ?? false,
    });
    scene = new WorldScene({
      welcome,
      art: manifest,
      send: (m) => connection.send(m),
      typing: () => chat?.typing ?? false,
    });
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#181425',
      antialias: true,
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene,
    });
    setHud(name, 1, region);
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
