import { afterEach, describe, expect, it } from 'vitest';
import type { DraftUpdateMessage, GodMessage } from '@co-mmo/shared';
import { artRequest } from '../src/assets/wish-art.ts';
import { account, app, joined, start, stop } from './helpers.ts';

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
});
