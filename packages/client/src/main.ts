import Phaser from 'phaser';
import type { ArtManifest, ArtPointsManifest, Character, ContentEntry, DraftView, ServerMessage, SoundId, WelcomeMessage } from '@co-mmo/shared';
import { MAX_LOOK_LENGTH, MAX_NAME_LENGTH, heldItem, offHandItem } from '@co-mmo/shared';
import { acceptInvite, accountInfo, checkInvite, clearToken, createInvite, kitHouses, loadToken, perfStats, redeemLogin, rejoinWhenBack, reloadWhenBack, saveToken } from './api.ts';
import { AccountWindow, showSignIn } from './account-ui.ts';
import { callingPickerHtml, pickedCalling, wireCallingPicker } from './calling-picker.ts';
import { GameConnection } from './net.ts';
import { PartyUi, showAway } from './social-ui.ts';
import { CHAT_HELP, ChatBox, escapeHtml, hidePanel, isTyping, onAccountClick, onInviteClick, readChat, setHud, showPanel, toast } from './ui.ts';
import { RpgUi } from './rpg-ui.ts';
import { KitUi } from './kit-ui.ts';
import { LootUi } from './loot-ui.ts';
import { PrayerUi } from './prayer-ui.ts';
import { onContent, updateContent } from './wished.ts';
import { GameSound, soundControls } from './sound.ts';
import { WorldScene } from './world-scene.ts';
import { EditorUi } from './editor-ui.ts';
import { MiniMap } from './mini-map.ts';
import { chooseCamera } from './camera.ts';
import { PerfOverlay } from './perf-overlay.ts';
import { LIT, LIT_FIGURE, LitFigurePipeline, LitPipeline } from './lit-pipeline.ts';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  const login = params.get('login');
  const signInError = params.get('signin_error');
  const linked = params.get('linked');
  if (invite || login || signInError || linked) history.replaceState(null, '', location.pathname);

  // A sign-in link from an email, or the way back from Google or GitHub.
  if (login) {
    showPanel('<h1>co-MMO</h1><p>Signing you in...</p>');
    try {
      saveToken(await redeemLogin(login));
    } catch (err) {
      return showSignIn((err as Error).message);
    }
  }
  const token = loadToken();
  if (invite && !token) return showInvite(invite);
  if (token) {
    if (linked) toast(`${linked === 'google' ? 'Google' : 'GitHub'} is linked. You can sign in with it from now on.`);
    if (signInError) toast(signInError, 10000);
    return play(token);
  }
  return showSignIn(signInError ?? '');
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
      ${callingPickerHtml()}
      <label for="look">How do you look? <span class="hint">Your first wish, free: the God paints you as one of your people.</span></label>
      <textarea id="look" maxlength="${MAX_LOOK_LENGTH}" rows="3" placeholder="Broad-shouldered, with a braided red mane and a copper helmet"></textarea>
      <label for="email">Email <span class="hint">(optional) to sign in from other devices</span></label>
      <input id="email" type="email" autocomplete="email" />
      <label class="check"><input id="adult" type="checkbox" required /> I am 18 or older. This game has mature content.</label>
      <button type="submit">Enter the world</button>
      <p class="error" id="accept-error"></p>
    </form>`);
  const form = panel.querySelector<HTMLFormElement>('#accept-form')!;
  wireCallingPicker(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = (id: string) => panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value;
    const adult = panel.querySelector<HTMLInputElement>('#adult')!.checked;
    const error = panel.querySelector<HTMLElement>('#accept-error')!;
    error.textContent = '';
    try {
      const { token, notes } = await acceptInvite(code, { name: field('name'), adult, email: field('email'), look: field('look'), ...pickedCalling(form) });
      saveToken(token);
      if (notes?.length) toast(notes.join(' '), 12000);
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
  let kit: KitUi | null = null;
  let loot: LootUi | null = null;
  let prayer: PrayerUi | null = null;
  let draft: DraftView | null = null;
  let party: PartyUi | null = null;
  let perf: PerfOverlay | null = null;
  let myId = '';
  const sound = new GameSound();
  soundControls(sound);
  void sound.refresh(true);
  let character: Character | null = null;
  /** Wishes of yours already granted, so only a new one rings. */
  const granted = new Set<string>();
  onContent(() => {
    scene?.refreshWishes();
    rpg?.refresh();
    kit?.refresh();
  });
  let name = '';
  let region = '';
  let regionId = '';
  /** The world editor, for the Owner and Stewards. */
  let editor: EditorUi | undefined;
  // Art loads alongside the connection; the world waits for both.
  // The art shipped with the game, and building art the server painted since
  // (say, for a building a wish added); shipped art wins.
  const manifest = (url: string): Promise<ArtManifest> =>
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<ArtManifest>) : {}))
      .catch(() => ({}));
  // Where hands and grips are in painted pictures, for held items; found by the server over time.
  const points = (): Promise<ArtPointsManifest> =>
    fetch('/api/art-points')
      .then((r) => (r.ok ? (r.json() as Promise<ArtPointsManifest>) : {}))
      .catch(() => ({}));
  const artPoints = points();
  // Hands and grips found since: a newly painted look or a new sword shows in hand without a reload.
  setInterval(() => void points().then((p) => scene?.setPoints(p)), 3 * 60_000);
  // Shipped art wins over painted art, except what the Owner had painted again in God's View.
  const allArt = (): Promise<ArtManifest> => Promise.all([manifest('/api/art'), manifest('/art/manifest.json')]).then(([painted, shipped]) => ({
    ...painted,
    ...shipped,
    ...Object.fromEntries(Object.entries(painted).filter(([, e]) => e.redone)),
  }));
  const art = allArt();

  const connection = new GameConnection(token, onMessage, (reason, code) => {
    if (code === 4003) {
      showPanel(`<h1>Suspended</h1><p>${escapeHtml(reason || 'Your account is suspended.')}</p>`);
      return;
    }
    if (code === 4010) {
      showPanel(`<h1>The world is updating</h1><p>${escapeHtml(reason || 'Back in a moment.')} This page reloads by itself.</p>`);
      void reloadWhenBack();
      return;
    }
    if (code === 4001) {
      clearToken();
      void showSignIn('You were signed out. Sign in again to keep playing.');
      return;
    }
    if (code === 4000) {
      // Replaced by another window: rejoining here would kick that one out.
      showPanel(`<h1>Disconnected</h1><p>${escapeHtml(reason || 'Lost connection to the world.')}</p><button type="button" onclick="location.reload()">Reconnect</button>`);
      return;
    }
    // The server restarted or the network dropped: rejoin once it answers again.
    showPanel('<h1>Reconnecting...</h1><p>Lost connection to the world. Rejoining as soon as it is back.</p><button type="button" onclick="location.reload()">Reconnect now</button>');
    void rejoinWhenBack();
  });

  function onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        region = message.region.name;
        regionId = message.region.id;
        character = message.character;
        sound.music(message.region.def.biome);
        rpg?.setCharacter(message.character);
        kit?.setCharacter(message.character);
        prayer?.setFavor(message.character.favor);
        // A body's loot stays behind in the region you left.
        loot?.show(null);
        if (scene) scene.enterRegion(message);
        editor?.regionChanged();
        if (!scene) void Promise.all([art, artPoints]).then(([manifest, found]) => start(message, manifest, found));
        break;
      case 'sky':
        scene?.setWeather(message.weather);
        break;
      case 'snapshot':
        scene?.onSnapshot(message);
        rpg?.setVitals(message.hp, message.energy);
        kit?.setEnergy(message.energy);
        scene?.setWeakened(rpg?.weakened ?? false);
        setHud(name, message.online, region, scene?.skyText());
        break;
      case 'chat':
        if (message.channel === 'whisper' && message.from.id !== myId) sound.play('notify');
        chat?.add({
          kind: 'chat', channel: message.channel, from: message.from.name, text: message.text,
          ...(message.to ? { to: message.to.name, outgoing: message.from.id === myId } : {}),
        });
        break;
      case 'party':
        party?.show(message.party);
        break;
      case 'party-invite':
        sound.play('notify');
        party?.invited(message);
        chat?.add({ kind: 'system', text: `${message.from.name} invites you to their party. Type /accept or /decline.` });
        break;
      case 'away':
        showAway(message);
        break;
      case 'system':
        chat?.add({ kind: 'system', text: message.text });
        break;
      case 'hit':
        if (message.target === myId) sound.play('hurt');
        else if (message.by === myId) sound.play(message.defeated ? 'defeat' : 'hit');
        scene?.onHit(message);
        break;
      case 'character':
        if (character) {
          const change = characterSound(character, message.character);
          if (change) sound.play(change);
        }
        character = message.character;
        rpg?.setCharacter(message.character);
        kit?.setCharacter(message.character);
        prayer?.setFavor(message.character.favor);
        scene?.setMyHeld(heldItem(message.character), offHandItem(message.character));
        break;
      case 'god':
        sound.play('god-speaks');
        prayer?.onGod(message);
        if (!prayer?.open) chat?.add({ kind: 'system', text: `✦ The God: ${message.say}` });
        break;
      case 'content':
        if (grantedNow(message.entries, message.replace)) sound.play('wish-granted');
        updateContent(message.entries, message.replace);
        break;
      case 'draft':
        // It can arrive while the art is still loading, before the prayer window exists.
        if (!message.pick) draft = message.view;
        prayer?.onDraft(message.view, message);
        break;
      case 'notice':
        chat?.add({ kind: 'system', text: message.text });
        break;
      case 'art':
        // New walks were painted: walkers on screen pick them up without a reload.
        void allArt().then((m) => scene?.updateWalks(m, message.walks));
        break;
      case 'loot':
        loot?.show(message.loot);
        break;
      case 'dialogue':
        sound.play('talk');
        rpg?.showDialogue(message);
        break;
      case 'cooldown':
        kit?.cooldown(message.ability, message.seconds);
        break;
      case 'trade':
        kit?.showTrade(message.trade);
        break;
      case 'trade-request':
        sound.play('notify');
        kit?.tradeRequested(message);
        chat?.add({ kind: 'system', text: `${message.from.name} wants to trade with you.` });
        break;
      case 'pong':
        perf?.pong(message.n);
        break;
      case 'error':
        chat?.add({ kind: 'error', text: message.message });
        break;
    }
  }

  /** Whether one of your wishes was granted just now (the first list only says what was granted before). */
  function grantedNow(entries: ContentEntry[], replace: boolean): boolean {
    let now = false;
    for (const e of entries) {
      if (e.wisher.id !== myId || e.status !== 'granted' || granted.has(e.id)) continue;
      granted.add(e.id);
      if (!replace) now = true;
    }
    return now;
  }

  function start(welcome: WelcomeMessage, manifest: ArtManifest, found: ArtPointsManifest): void {
    hidePanel();
    name = welcome.you.name;
    myId = welcome.you.id;
    chat = new ChatBox((channel, text) => {
      const intent = readChat(channel, text);
      if (intent.t === 'help') chat?.add({ kind: 'system', text: CHAT_HELP });
      else if (intent.t === 'problem') chat?.add({ kind: 'error', text: intent.text });
      else if (intent.t !== 'chat' || intent.text) connection.send(intent);
    });
    chat.add({ kind: 'system', text: 'Move with WASD or the arrow keys. Space strikes, 1 to 4 use abilities, E talks or opens the loot of a fallen creature, I opens your bag, C crafts, B opens the Bible, G prays to the God. Press Enter to chat; type /help for chat commands.' });
    party = new PartyUi((m) => connection.send(m));
    party.start(myId);
    const account = new AccountWindow(token, welcome.you.role !== 'player' ? () => perf : undefined);
    onAccountClick(() => void account.toggle());
    void accountInfo(token).then((info) => {
      if (!info.look) chat?.add({ kind: 'system', text: '✦ You have not described your look yet. Open Account to make your first wish, free: the God paints you as you describe.' });
    }, () => undefined);
    prayer = new PrayerUi({
      pray: (text) => connection.send({ t: 'pray', text }),
      answer: (card, confirm) => connection.send({ t: 'wish', card, confirm }),
      draft: (m) => connection.send({ t: 'draft', ...m }),
    });
    prayer.setFavor(welcome.character.favor);
    prayer.onDraft(draft);
    if (welcome.you.role !== 'player') {
      const link = document.getElementById('gods-view-link')!;
      link.hidden = false;
      // The Owner and Stewards can change the world where they stand.
      const edit = document.getElementById('edit-world-button')!;
      const opened = new EditorUi({ token, scene: () => scene ?? undefined, region: () => ({ id: regionId, name: region }) });
      editor = opened;
      edit.hidden = false;
      edit.addEventListener('click', () => opened.toggle());
    }
    rpg = new RpgUi(welcome.character, {
      attack: () => {
        connection.send({ t: 'attack' });
        sound.play('swing');
        scene?.swing();
      },
      interact: () => connection.send({ t: 'interact' }),
      use: (item) => connection.send({ t: 'use', item }),
      unequip: (slot) => connection.send({ t: 'equip', slot }),
      openShop: (npc) => kit?.openShop(npc),
      accept: (quest) => connection.send({ t: 'accept', quest }),
      report: (kind, target, reason) => connection.send({ t: 'report', kind, target, reason }),
      typing: isTyping,
      prayer: () => prayer?.toggle(true),
      spendPoint: (stat) => connection.send({ t: 'spendPoint', stat }),
    });
    loot = new LootUi({ send: (m) => connection.send(m), typing: isTyping });
    kit = new KitUi(welcome.character, {
      ability: (ability) => {
        connection.send({ t: 'ability', ability });
        sound.play('spell');
      },
      craft: (recipe) => connection.send({ t: 'craft', recipe }),
      shop: (action, npc, id, qty) => connection.send({ t: 'shop', action, npc, id, ...(qty ? { qty } : {}) }),
      trade: (m) => connection.send(m),
      typing: isTyping,
    });
    // Set the isometric camera before creating the scene.
    chooseCamera(welcome.you.role);
    scene = new WorldScene({
      welcome,
      art: manifest,
      points: found,
      send: (m) => connection.send(m),
      // Kit houses stand in the isometric camera, drawn on the server the first time they are asked for.
      houses: (region: string) => kitHouses(token, region),
      // The arrow keys choose loot while its window is open, so the player stands still.
      typing: () => isTyping() || !!loot?.open,
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game',
      backgroundColor: '#181425',
      antialias: true,
      // The world's lighting: the sun, the sky and lamps, with a rim light on characters.
      // Room for the lamps, fires and lit windows near us, not just a few.
      render: { maxLights: 16 },
      pipeline: { [LIT]: LitPipeline, [LIT_FIGURE]: LitFigurePipeline } as unknown as Phaser.Types.Core.PipelineConfig,
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene,
    });
    // The mini map of your floor.
    new MiniMap({ view: () => scene?.miniMapView() });
    // The performance overlay, for Stewards and the Owner checking where the game is slow.
    if (welcome.you.role !== 'player') {
      const world = scene;
      perf = new PerfOverlay({
        game,
        counts: () => world.counts(),
        received: connection.received,
        ping: (n) => connection.send({ t: 'ping', n }),
        server: () => perfStats(token),
        camera: 'isometric',
        region: () => region,
      });
    }
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

/** The sound for what changed on your character, if any: the biggest news wins. */
function characterSound(before: Character, after: Character): SoundId | undefined {
  if (after.level > before.level) return 'level-up';
  if (after.favor > before.favor) return 'favor';
  if (after.gold !== before.gold) return 'coin';
  const count = (c: Character) => c.inventory.reduce((n, slot) => n + slot.qty, 0);
  if (count(after) > count(before)) return 'pickup';
  return undefined;
}

boot();
