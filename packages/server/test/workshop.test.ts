import { afterEach, describe, expect, it } from 'vitest';
import type { DraftUpdateMessage, GodMessage } from '@co-mmo/shared';
import type { ChatModel, ChatRequest } from '../src/ai/chat.ts';
import { artRequest } from '../src/assets/wish-art.ts';
import { FILL_REQUEST } from '../src/god.ts';
import { issueBody } from '../src/builds.ts';
import { account, api, app, joined, pray, start, stop } from './helpers.ts';

afterEach(stop);

const moth = {
  name: 'Lantern Moth',
  description: 'A soft moth that carries a lantern at dusk.',
  behavior: 'wander',
  level: 1,
  count: 2,
  hook: 'a tiny paper lantern hanging from its tongue',
  body: 'a round fuzzy moth the size of a cat',
  color: '#e8c66a',
  mood: 'gentle, sleepy',
};

const draftView = (c: Awaited<ReturnType<typeof joined>>, pred: (m: DraftUpdateMessage) => boolean = () => true) =>
  c.waitFor<DraftUpdateMessage>((m) => m.t === 'draft' && pred(m as DraftUpdateMessage));

describe('the Wish Workshop', () => {
  it('previews a creature for free, then grants it as shaped and paints exactly the previewed prompt', async () => {
    const { store, ws, painter } = await start();
    const p = account(store, 'Mara', 'owner');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);

    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'creature' });
    const empty = (await draftView(c)).view!;
    expect(empty.problems).toContain('Give it a name.');
    expect(empty.preview.art).toBeUndefined();

    await c.send({ t: 'draft', action: 'edit', fields: { ...moth, secret: 'ignored' } });
    const view = (await draftView(c)).view!;
    expect(view.problems).toEqual([]);
    expect(view.draft.fields).not.toHaveProperty('secret');
    expect(view.preview.card).toMatchObject({ tier: 'moderate', cost: 6, instant: true, title: 'Lantern Moth' });
    expect(view.preview.card.where).toMatch(/^Beside you, in /);
    expect(view.preview.world[0]).toBe('2 appear near you. Each has 22 health and hits for 4.');
    const art = view.preview.art!;
    expect(art).toMatchObject({ model: 'fake-image', placeholder: 'woods-mushroom' });
    expect(art.pictures).toHaveLength(1);
    expect(art.mine).toContain(moth.hook);
    // Previewing paints nothing and spends nothing.
    expect((painter as any).calls).toBe(0);
    expect(store.spendThisMonth(Date.now())).toHaveLength(0);

    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    expect(offered.card).toMatchObject({ tier: 'moderate', cost: 6, title: 'Lantern Moth' });
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    expect(store.draftOf(p.id)).toBeUndefined();

    const record = store.content.find((r) => r.title === 'Lantern Moth')!;
    expect(record).toMatchObject({ status: 'granted', tier: 'moderate' });
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).prompts).toEqual([art.pictures[0]!.prompt]);
    expect(art.pictures[0]!.prompt).toBe(artRequest(record.definition as any, 'sanctum').prompt);
  });

  it('sends a way-to-play wish to the Stewards with its brief, free', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Ilya');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'play', sub: 'gathering', fields: { name: 'Shore Fishing', what: 'cast a line', where: 'water', reward: 'small fish, sometimes a carp' } });
    const view = (await draftView(c, (m) => m.view !== null)).view!;
    expect(view.problems).toEqual([]);
    expect(view.preview.card).toMatchObject({ tier: 'major', cost: 0, instant: false });
    expect(view.preview.plan?.[0]).toMatch(/Stewards/);
    expect(view.preview.art).toBeUndefined();

    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    const record = store.content.find((r) => r.title === 'Shore Fishing')!;
    expect(record).toMatchObject({ status: 'pending', tier: 'major' });
    expect(record.shaped).toEqual({ category: 'Ways to play: Gathering', brief: ['Gathering: Shore Fishing', 'What you do: cast a line', 'Beside: water', 'What you get: small fish, sometimes a carp'] });
    // Players never see the brief in the public log.
    expect(app!.wishes.entries().find((e) => e.id === record.id)).not.toHaveProperty('shaped');
  });

  it('keeps a draft across a reconnect, and refuses to send one with something missing', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara');
    const first = await joined(ws, p.token);
    await first.send({ t: 'draft', action: 'start', category: 'carry', sub: 'potion', fields: { name: 'Dew Tonic' } });
    await draftView(first, (m) => m.view !== null);
    first.socket.close();

    const again = await joined(ws, p.token);
    const view = (await draftView(again, (m) => m.view !== null)).view!;
    expect(view.draft.fields).toMatchObject({ name: 'Dew Tonic' });
    await again.send({ t: 'draft', action: 'send' });
    const said = await again.waitFor<GodMessage>((m) => m.t === 'god');
    expect(said.say).toMatch(/^Not yet: /);
    expect(said.card).toBeUndefined();

    await again.send({ t: 'draft', action: 'drop' });
    await draftView(again, (m) => m.view === null);
    expect(store.draftOf(p.id)).toBeUndefined();
  });

  it('lets the offline God fill in the rest, leaving what the player wrote', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'creature' });
    await draftView(c);

    await c.send({ t: 'draft', action: 'fill', fields: { name: 'Lantern Moth', level: 2 }, locked: ['name', 'level'] });
    const view = (await draftView(c, (m) => Boolean(m.god))).view!;
    expect(view.problems).toEqual([]);
    expect(view.draft.fields).toMatchObject({ name: 'Lantern Moth', level: 2, behavior: 'wander', count: 3 });
    expect(view.draft.fields.hook).toBe('the look of lantern moth');
    expect(view.draft.locked).toEqual(['name', 'level']);
    expect(view.draft.chat?.map((l) => l.who)).toEqual(['you', 'god']);
    expect(view.draft.chat?.[0]!.text).toBe(FILL_REQUEST);
    expect(store.spendThisMonth(Date.now())).toHaveLength(0);
  });

  it('tells the God the draft and its locks, applies its changes but never to a locked field, and offers its quick answers', async () => {
    const asked: ChatRequest[] = [];
    const god: ChatModel = {
      provider: 'gemini',
      model: 'fake-chat',
      async complete(request) {
        asked.push(request);
        return {
          text: JSON.stringify({ say: 'Spookier it is. How many should haunt you?', fields: { name: 'Gloom Moth', mood: 'eerie', level: 3 }, choices: ['One', 'Three', 'Five', 'Six'] }),
          inputTokens: 100, outputTokens: 20, usd: 0.002,
        };
      },
    };
    const { store, ws } = await start({ chat: () => [god] });
    const p = account(store, 'Mara');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'creature', fields: { name: 'Lantern Moth' } });
    await draftView(c);

    await c.send({ t: 'draft', action: 'ask', say: 'make it spookier', fields: { name: 'Lantern Moth', mood: 'gentle' }, locked: ['name'] });
    const view = (await draftView(c, (m) => Boolean(m.god))).view!;
    expect(view.draft.fields).toMatchObject({ name: 'Lantern Moth', mood: 'eerie', level: 3 });
    expect(view.draft.choices).toEqual(['One', 'Three', 'Five']);
    expect(view.draft.chat?.at(-1)).toEqual({ who: 'god', text: 'Spookier it is. How many should haunt you?' });

    expect(asked).toHaveLength(1);
    expect(asked[0]!.system).toContain('Living things, Creature');
    expect(asked[0]!.system).toMatch(/- name: Name; .*Now: "Lantern Moth"\. LOCKED/);
    expect(asked[0]!.messages.at(-1)).toEqual({ role: 'user', content: 'make it spookier' });
    expect(store.spendThisMonth(Date.now())).toMatchObject([{ kind: 'chat', usd: 0.002, playerId: p.id }]);
  });

  it('carries a wish from Talk into the Workshop, with or without a card', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);

    // A card with a finished wish becomes a draft at once.
    const hat = await pray(c, 'I wish for a glowing blue hat');
    expect(hat.card).toBeDefined();
    await c.send({ t: 'draft', action: 'shape' });
    const shaped = (await draftView(c, (m) => Boolean(m.god))).view!;
    expect(shaped.draft).toMatchObject({ category: 'carry', sub: 'gear', fields: { name: 'Glowing Blue Hat', itemKind: 'head' } });
    expect(shaped.draft.chat?.[0]).toEqual({ who: 'you', text: 'I wish for a glowing blue hat' });
    expect(shaped.problems).toEqual([]);

    // A wish people build has no fields yet: the player picks its kind and the God fills it in from the talk.
    await pray(c, 'I wish for fishing in the pond');
    await c.send({ t: 'draft', action: 'shape' });
    await draftView(c, (m) => Boolean(m.pick));
    await c.send({ t: 'draft', action: 'start', category: 'play', sub: 'gathering', carry: true });
    const carried = (await draftView(c, (m) => Boolean(m.god))).view!;
    expect(carried.draft.sub).toBe('gathering');
    expect(carried.draft.chat?.some((l) => l.text === 'I wish for fishing in the pond')).toBe(true);
    expect(carried.draft.chat?.at(-1)?.who).toBe('god');
  });

  it('lets a player change their look for 2 Favor; the newer look wins, and a prayer cannot make one', async () => {
    const { store, ws } = await start();
    const p = account(store, 'Mara');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    const first = app!.wishes.grantLook({ id: p.id, name: 'Mara' }, 'a short wizard in a green hat');

    await c.send({ t: 'draft', action: 'start', category: 'living', sub: 'look', fields: { description: 'a tall fox-eared ranger in a moss-green cloak', hook: 'fox ears poking through a hood', body: 'tall and lean', color: '#4f9a4e' } });
    const view = (await draftView(c, (m) => m.view !== null)).view!;
    expect(view.problems).toEqual([]);
    expect(view.preview.card).toMatchObject({ tier: 'minor', cost: 2, title: 'Your new look', where: 'Your look, painted for everyone to see' });
    expect(view.preview.art?.pictures[0]!.prompt).toContain('Mara');

    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    const look = app!.wishes.lookOf(p.id)!;
    expect(look.id).not.toBe(first.id);
    expect(look).toMatchObject({ status: 'granted', favor: 2, definition: { kind: 'player', name: 'Mara' } });
    // Rolling the new look back brings the old one back.
    app!.wishes.rollback(look.id);
    expect(app!.wishes.lookOf(p.id)!.id).toBe(first.id);

    // The God's own cards go through validateDefinition, which never makes a look.
    const made = app!.wishes.cardFor(p.id, { tier: 'minor', title: 'Their look', summary: '', definition: { kind: 'player', name: 'Ilya', description: 'a frog', look: {} } }, 'the Sanctum');
    expect(made).toMatchObject({ card: { tier: 'major' } });
  });

  it('paints one paid sample only when the Owner allows it, and uses it as the art when the wish is sent unchanged', async () => {
    const { store, ws, painter } = await start();
    const p = account(store, 'Mara');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    const pebble = { name: 'Lucky Pebble', description: 'A smooth pebble that hums.', hook: 'a tiny glowing rune', body: 'a smooth river pebble', color: '#2c7fa8' };
    await c.send({ t: 'draft', action: 'start', category: 'carry', sub: 'keepsake', fields: pebble });
    const off = (await draftView(c, (m) => m.view !== null)).view!;
    // Switched off (the default): no sample is offered, and asking for one paints nothing.
    expect(off.preview.art?.sample).toBeUndefined();
    await c.send({ t: 'draft', action: 'sample' });
    expect((await draftView(c, (m) => Boolean(m.god))).view!.draft.chat?.at(-1)?.text).toBe('Samples are switched off in this world.');
    expect((painter as any).calls).toBe(0);

    store.updateSettings({ ...store.settings, workshop: { samples: true, sampleFavor: 1 } });
    await c.send({ t: 'draft', action: 'edit', fields: pebble });
    const on = (await draftView(c, (m) => m.view !== null)).view!;
    expect(on.preview.art?.sample).toEqual({ favor: 1 });
    const favor = app!.world.regionOf(p.id)!.character(p.id)!.favor;

    await c.send({ t: 'draft', action: 'sample' });
    const sampled = (await draftView(c, (m) => Boolean(m.god))).view!;
    expect((painter as any).calls).toBe(1);
    expect(sampled.preview.art?.sample).toMatchObject({ current: true, blocked: 'Each draft gets one sample, and this one has had it.' });
    expect(sampled.preview.art?.sample?.url).toMatch(new RegExp(`^/wished-art/samples/${p.id}\\.png`));
    expect(app!.world.regionOf(p.id)!.character(p.id)!.favor).toBe(favor - 1);
    expect(store.spendThisMonth(Date.now())).toMatchObject([{ kind: 'image', sample: true, playerId: p.id }]);

    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    await Promise.all([...app!.wishes.painting]);
    const record = store.content.find((r) => r.title === 'Lucky Pebble')!;
    // The sample became the art: nothing was painted twice.
    expect((painter as any).calls).toBe(1);
    expect(record.art).toMatch(new RegExp(`^/wished-art/${record.id}\\.png`));
    expect(record.artPrompts?.[record.id]?.prompt).toBe(sampled.preview.art!.pictures[0]!.prompt);
  });

  it('lets a Steward reword a picture\'s prompt and paint it again; a plain repaint stays the Owner\'s', async () => {
    const { store, ws, base, painter } = await start();
    const p = account(store, 'Mara');
    const steward = account(store, 'Ilya', 'steward');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'carry', sub: 'keepsake', fields: { name: 'Lucky Pebble', description: 'A smooth pebble.', hook: 'a rune', body: 'a pebble', color: '#8a8aa0' } });
    await draftView(c, (m) => m.view !== null);
    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    await Promise.all([...app!.wishes.painting]);
    const record = store.content.find((r) => r.title === 'Lucky Pebble')!;

    expect((await api(base, `/api/admin/content/${record.id}/paint`, steward.token, 'POST')).status).toBe(403);
    const words = 'A smooth grey river pebble with one glowing blue rune, on flat magenta.';
    const res = await api(base, `/api/admin/content/${record.id}/paint`, steward.token, 'POST', { picture: record.id, prompt: words });
    expect(res.status).toBe(202);
    await Promise.all([...app!.wishes.painting]);
    expect((painter as any).prompts.at(-1)).toBe(words);
    expect(store.contentById(record.id)!.artPrompts?.[record.id]?.prompt).toBe(words);
  });

  it('gives a Workshop brief to the rule drafter and to the coding agent\'s issue', async () => {
    const asked: ChatRequest[] = [];
    const compiler: ChatModel = {
      provider: 'gemini',
      model: 'fake-compiler',
      async complete(request) {
        asked.push(request);
        throw new Error('not today');
      },
    };
    const { store, ws } = await start({ compiler: () => [compiler] });
    const p = account(store, 'Ilya');
    const c = await joined(ws, p.token);
    await draftView(c, (m) => m.view === null);
    await c.send({ t: 'draft', action: 'start', category: 'play', sub: 'gathering', fields: { name: 'Shore Fishing', what: 'cast a line', where: 'water', reward: 'small fish' } });
    await draftView(c, (m) => m.view !== null);
    await c.send({ t: 'draft', action: 'send' });
    const offered = await c.waitFor<GodMessage>((m) => m.t === 'god' && Boolean((m as GodMessage).card));
    await c.send({ t: 'wish', card: offered.card!.id, confirm: true });
    await draftView(c, (m) => m.view === null);
    await Promise.allSettled([...app!.wishes.drafts]);
    expect(asked[0]!.messages[0]!.content).toContain("The player's brief, written in the Wish Workshop:\nGathering: Shore Fishing\nWhat you do: cast a line");

    const record = store.content.find((r) => r.title === 'Shore Fishing')!;
    const body = issueBody(record, { state: 'queued', at: 0 }, 'claude');
    expect(body).toContain("## The player's brief");
    expect(body).toContain('> What you get: small fish');
  });
});
