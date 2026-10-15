import { afterEach, describe, expect, it } from 'vitest';
import type { DraftUpdateMessage, GodMessage } from '@co-mmo/shared';
import type { ChatModel, ChatRequest } from '../src/ai/chat.ts';
import { artRequest } from '../src/assets/wish-art.ts';
import { FILL_REQUEST } from '../src/god.ts';
import { account, app, joined, pray, start, stop } from './helpers.ts';

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
    expect(record.conversation[0]!.content).toContain('What you get: small fish, sometimes a carp');
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
});
