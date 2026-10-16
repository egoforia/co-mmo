import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { BUILDING_STYLES, ITEMS, WALK_DIRECTIONS, addItem, buildingArtIds, equipmentBonus, heldBehind, heldItem, itemFromWish, newCharacter, offHandItem, regionDef, validateDefinition, walkArt, type PlayerInfo, type ServerMessage } from '@co-mmo/shared';
import type { ChatModel, ChatRequest } from '../src/ai/chat.ts';
import { findPoint, steadyHands, stripFrames } from '../src/assets/points.ts';
import { HandFinder, type PointSource } from '../src/hand-finder.ts';
import { Region, type Connection } from '../src/region.ts';
import { account, api, app, start } from './helpers.ts';

/** A vision model that answers points from a script and keeps what it was shown. */
function fakeEye(answers: string[]): ChatModel & { asked: ChatRequest[] } {
  return {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    asked: [],
    async complete(request) {
      this.asked.push(request);
      return { text: answers.shift() ?? '{"point": null}', inputTokens: 300, outputTokens: 10, usd: 0.001 };
    },
  };
}

const picture = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: { r: 40, g: 90, b: 160, alpha: 1 } } }).png().toBuffer();

describe('finding points', () => {
  it('turns the model\'s [y, x] out of 1000 into fractions of the picture, and ignores nonsense', async () => {
    const eye = fakeEye(['{"point": [750, 250]}', '{"point": null}', '{"point": [1200, 5]}']);
    const png = await picture(128, 192);
    expect(await findPoint(eye, png, 'the hand')).toEqual({ point: [0.25, 0.75], usd: 0.001 });
    expect(await findPoint(eye, png, 'the hand')).toEqual({ usd: 0.001 });
    expect(await findPoint(eye, png, 'the hand')).toEqual({ usd: 0.001 });
    expect(eye.asked[0]!.messages[0]!.images).toHaveLength(1);
  });

  it('cuts a walk strip into its frames', async () => {
    const frames = await stripFrames(await picture(1024, 192), 8);
    expect(frames).toHaveLength(8);
    expect((await sharp(frames[3]!).metadata()).width).toBe(128);
  });
});

describe('the hand finder', () => {
  it('finds a hand in every walk frame and an item\'s grip once, and looks again only at pictures painted again', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'co-mmo-points-'));
    const strip = await picture(256, 192);
    let sword = await picture(128, 128);
    // Hands come back as both hands; walking left, the right hand is the far one and the left the near one.
    const eye = fakeEye(['{"near": [100, 100], "far": [800, 600]}', '{"near": [100, 100], "far": null}', '{"point": [700, 300]}', '{"far": [810, 610]}', '{"far": [820, 620]}']);
    let walkFile = 'wished-art/walks/player-mara-walk-front.png';
    const spent: number[] = [];
    const sources = (): PointSource[] => [
      { id: 'player-mara-walk-front', kind: 'hands', file: walkFile, frames: 2, facing: 'left', read: async () => strip },
      { id: 'item-wooden-sword', kind: 'grip', file: 'art/item-wooden-sword.png', frames: 1, read: async () => sword },
    ];
    let model: ChatModel | undefined;
    const finder = new HandFinder({ artDir, model: () => model, sources: async () => sources(), paused: () => false, spend: (usd) => spent.push(usd) });

    // No model that can see: nothing is asked or guessed.
    await finder.start();
    expect(await finder.manifest()).toEqual({});

    model = eye;
    await finder.start();
    expect(await finder.manifest()).toEqual({
      'player-mara-walk-front': { hands: [[0.6, 0.8], null], leftHands: [[0.1, 0.1], [0.1, 0.1]] },
      'item-wooden-sword': { grip: [0.3, 0.7] },
    });
    expect(eye.asked[2]!.messages[0]!.content).toMatch(/handle/);
    // Both hands are asked for by where they are in the picture, and the right hand is picked from them, so it never jumps to the other hand.
    expect(eye.asked[0]!.messages[0]!.content).toMatch(/"near" is the hand/);
    expect(eye.asked[0]!.system).toMatch(/"far"/);
    expect(spent).toHaveLength(3);
    expect(JSON.parse(await readFile(join(artDir, 'points.json'), 'utf8'))['item-wooden-sword'].from).toMatch(/^art\/item-wooden-sword\.png#[0-9a-f]{12}#v4$/);

    // Nothing new: nothing asked. The walk painted again: its frames are looked at again.
    await finder.start();
    expect(eye.asked).toHaveLength(3);
    walkFile = `${walkFile}?v=2`;
    await finder.start();
    expect(eye.asked).toHaveLength(5);
    expect((await finder.manifest())['player-mara-walk-front']).toEqual({ hands: [[0.61, 0.81], [0.62, 0.82]], leftHands: [null, null] });
    // A new picture under the same file name (shipped art updated with the game) is looked at again too.
    sword = await picture(64, 128);
    await finder.start();
    expect(eye.asked).toHaveLength(6);

    // Kept on disk for the next start.
    const again = new HandFinder({ artDir, model: () => undefined, sources: async () => [], paused: () => false, spend: () => {} });
    expect(Object.keys(await again.manifest())).toEqual(['player-mara-walk-front', 'item-wooden-sword']);
  });

  it('keeps each hand on its side walking towards us, swapping a frame the model mixed up', () => {
    const r = (x: number) => [x, 0.5] as [number, number];
    // The right hand is on the picture's left in most frames; frame 3 came back the other way round.
    expect(steadyHands('front', [{ right: r(0.3), left: r(0.7) }, { right: r(0.32), left: r(0.68) }, { right: r(0.7), left: r(0.31) }, {}])).toEqual({ right: [r(0.3), r(0.32), r(0.31), null], left: [r(0.7), r(0.68), r(0.7), null] });
    // Side-on the hands cross, so nothing is swapped.
    expect(steadyHands('left', [{ right: r(0.3), left: r(0.7) }, { right: r(0.7), left: r(0.3) }])).toEqual({ right: [r(0.3), r(0.7)], left: [r(0.7), r(0.3)] });
  });

  it('asks the Owner\'s own question, and looks again at one frame or a whole walk when asked', async () => {
    const artDir = await mkdtemp(join(tmpdir(), 'co-mmo-points-'));
    const eye = fakeEye(['{"left": [500, 300], "right": [500, 700]}', '{"left": [500, 310], "right": [500, 690]}', '{"left": [520, 320], "right": [520, 680]}']);
    const strip = await picture(256, 192);
    const finder = new HandFinder({ artDir, model: () => eye, paused: () => false, spend: () => {}, sources: async () => [{ id: 'player-mara-walk-front', kind: 'hands', file: 'w.png', frames: 2, facing: 'front', read: async () => strip }] });
    await finder.start();
    expect((await finder.manifest())['player-mara-walk-front']).toEqual({ hands: [[0.3, 0.5], [0.31, 0.5]], leftHands: [[0.7, 0.5], [0.69, 0.5]] });
    expect((await finder.questions()).find((q) => q.facing === 'front')).toMatchObject({ own: false, system: expect.stringContaining('"left"') });

    await finder.setQuestion('front', 'Find the hands, follow the arms.');
    expect((await finder.questions()).find((q) => q.facing === 'front')).toMatchObject({ own: true, prompt: 'Find the hands, follow the arms.' });
    // Saving words looks at nothing; asking again for frame 2 looks at that frame only, with the new words.
    expect(eye.asked).toHaveLength(2);
    expect(await finder.findAgain(['player-mara-walk-front'], 1)).toBe(1);
    expect(eye.asked).toHaveLength(3);
    expect(eye.asked[2]!.messages[0]!.content).toBe('Find the hands, follow the arms.');
    expect((await finder.manifest())['player-mara-walk-front']).toEqual({ hands: [[0.3, 0.5], [0.32, 0.52]], leftHands: [[0.7, 0.5], [0.68, 0.52]] });
    await finder.setQuestion('front', '');
    expect((await finder.questions()).find((q) => q.facing === 'front')!.own).toBe(false);
  });

  it('stops while today\'s spending is paused', async () => {
    const eye = fakeEye([]);
    const finder = new HandFinder({
      artDir: await mkdtemp(join(tmpdir(), 'co-mmo-points-')),
      model: () => eye,
      sources: async () => [{ id: 'item-x', kind: 'grip', file: 'x.png', frames: 1, read: async () => picture(64, 64) }],
      paused: () => true,
      spend: () => {},
    });
    await finder.start();
    expect(eye.asked).toHaveLength(0);
  });
});

describe('held items', () => {
  it('shows others the weapon a player wears, else their charm', () => {
    const c = newCharacter();
    expect(heldItem(c)).toBeUndefined();
    c.equipment.charm = 'scarab-charm';
    expect(heldItem(c)).toBe('scarab-charm');
    c.equipment.weapon = 'wooden-sword';
    expect(heldItem(c)).toBe('wooden-sword');

    const region = new Region(regionDef('sanctum')!, undefined, () => 1_000_000, () => 0.5);
    const conns: Record<string, ServerMessage[]> = { a: [], b: [] };
    const conn = (id: string): Connection => ({ send: (m) => conns[id]!.push(m), close() {} });
    const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
    const mara = newCharacter();
    addItem(mara, 'wooden-sword');
    region.join(info('a'), conn('a'), { x: null, y: null }, mara);
    region.join(info('b'), conn('b'), { x: null, y: null }, newCharacter());
    region.placePlayer('a', 10, 10);
    region.placePlayer('b', 11, 10);
    region.handle('a', { t: 'equip', item: 'wooden-sword' });
    region.tick();
    const seen = conns.b!.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(seen.players.find((p) => p.id === 'a')).toMatchObject({ held: 'wooden-sword' });
    expect(seen.players.find((p) => p.id === 'a')!.offHeld).toBeUndefined();
  });

  it('draws each hand\'s item behind the body only when that hand is on the far side', () => {
    expect((['front', 'right', 'back', 'left'] as const).map((f) => heldBehind(f, 'right'))).toEqual([false, false, true, true]);
    expect((['front', 'right', 'back', 'left'] as const).map((f) => heldBehind(f, 'left'))).toEqual([false, true, true, false]);
  });

  it('wears a wished shield in the off hand, shown in the left hand beside the weapon', () => {
    const def = validateDefinition({ kind: 'item', name: 'Oak Buckler', description: 'A round oak shield.', itemKind: 'offhand', rarity: 'uncommon' });
    expect(def).toMatchObject({ itemKind: 'offhand' });
    ITEMS['w-buckler'] = itemFromWish('w-buckler', def as Parameters<typeof itemFromWish>[1]);
    try {
      expect(ITEMS['w-buckler']).toMatchObject({ slot: 'offhand', bonus: equipmentBonus('offhand', 'uncommon') });
      expect(equipmentBonus('offhand', 'uncommon').armor).toBeGreaterThan(0);

      const region = new Region(regionDef('sanctum')!, undefined, () => 1_000_000, () => 0.5);
      const seen: ServerMessage[] = [];
      const info = (id: string): PlayerInfo => ({ id, name: id, color: 0xffffff, role: 'player' });
      const mara = newCharacter();
      addItem(mara, 'wooden-sword');
      addItem(mara, 'w-buckler');
      region.join(info('a'), { send() {}, close() {} }, { x: null, y: null }, mara);
      region.join(info('b'), { send: (m) => seen.push(m), close() {} }, { x: null, y: null }, newCharacter());
      region.placePlayer('a', 10, 10);
      region.placePlayer('b', 11, 10);
      region.handle('a', { t: 'equip', item: 'wooden-sword' });
      region.handle('a', { t: 'equip', item: 'w-buckler' });
      region.tick();
      const last = seen.filter((m) => m.t === 'snapshot').at(-1) as Extract<ServerMessage, { t: 'snapshot' }>;
      expect(last.players.find((p) => p.id === 'a')).toMatchObject({ held: 'wooden-sword', offHeld: 'w-buckler' });
      expect(offHandItem({ equipment: { offhand: 'w-buckler' } })).toBe('w-buckler');
    } finally {
      delete ITEMS['w-buckler'];
    }
  });
});

describe('the art points the game serves', () => {
  it('finds hands in shipped walks and the walking looks, and grips of weapons and charms', async () => {
    const root = await mkdtemp(join(tmpdir(), 'co-mmo-public-'));
    await mkdir(join(root, 'art'));
    const entry = (id: string, kind = 'prop', frames?: number) => [id, { file: `art/${id}.png`, kind, width: 256, height: 192, ...(frames ? { frames } : {}) }];
    const manifest = Object.fromEntries([
      ...Object.values(BUILDING_STYLES).flatMap(buildingArtIds).map((id) => entry(id)),
      ...['player-mara', 'player-ilya'].flatMap((look) => WALK_DIRECTIONS.map((d) => entry(walkArt(look, d), 'walk', 2))),
      entry('player-mara', 'player'),
      entry('item-wooden-sword', 'item'),
    ]);
    await writeFile(join(root, 'art/manifest.json'), JSON.stringify(manifest));
    for (const id of [walkArt('player-mara', 'front'), 'player-mara', 'item-wooden-sword']) await writeFile(join(root, `art/${id}.png`), await picture(256, 192));
    const eye = fakeEye(Array(20).fill('{"point": [500, 500], "left": [500, 500], "right": [500, 500], "near": [500, 500], "far": [500, 500]}'));
    const { base, store } = await start({ shippedArt: join(root, 'art/manifest.json'), judge: () => eye, sound: { start: false } });
    await app!.hands.start();
    await app!.hands.job;
    const owner = account(store, 'Ego', 'owner');
    const { body } = await api(base, '/api/art-points', owner.token);
    expect(body[walkArt('player-mara', 'front')]).toEqual({ hands: [[0.5, 0.5], [0.5, 0.5]], leftHands: [[0.5, 0.5], [0.5, 0.5]] });
    expect(body['player-mara']).toEqual({ hands: [[0.5, 0.5]], leftHands: [[0.5, 0.5]] });
    expect(body['item-wooden-sword']).toEqual({ grip: [0.5, 0.5] });
    // God's View shows the questions and looks again at a walk when asked.
    expect((await api(base, '/api/admin/art/hands', owner.token)).body.questions).toHaveLength(4);
    const again = await api(base, '/api/admin/art/hands/find', owner.token, 'POST', { ids: [walkArt('player-mara', 'front')], frame: 0 });
    expect(again.body).toMatchObject({ ok: true, looked: 1 });
    // Pictures whose files are missing are left for later.
    expect(body[walkArt('player-ilya', 'back')]).toBeUndefined();
  });
});
