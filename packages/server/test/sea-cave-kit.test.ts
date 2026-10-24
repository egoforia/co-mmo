import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { SEA_CAVE_MOD, SEA_CAVE_PIECES, isoSpan, switchMod } from '@co-mmo/shared';
import { BIOME_KIT } from '../src/assets/kit.ts';
import { pictureName } from '../src/assets/names.ts';
import { SEA_CAVE_KIT, kitPieces, seaCaveBox } from '../src/assets/sea-cave-kit.ts';
import type { ImageRequest } from '../src/assets/provider.ts';
import { TILE_FRAMING, buildPrompt, footprintWords } from '../src/assets/style.ts';
import { STYLE } from '../src/assets/style-profile.ts';
import { paintKitAsset } from '../src/assets/wild-kit.ts';

describe("the Smugglers' Sea Cave Art Kit pictures", () => {
  afterEach(() => switchMod(SEA_CAVE_MOD, true));

  it('describes cavern tiles and a picture for every prop the editor places', () => {
    expect(SEA_CAVE_KIT.filter((a) => a.kind === 'tile').map((a) => a.id)).toEqual(['sea-cave-floor', 'sea-cave-wall', 'sea-cave-planks', 'sea-cave-rock-face']);
    for (const p of SEA_CAVE_PIECES) {
      const asset = SEA_CAVE_KIT.find((a) => a.id === p.id)!;
      expect(asset).toMatchObject({ kind: 'prop', biome: 'sunlit-shore', name: p.name });
      expect(buildPrompt(asset)).toContain(asset.silhouetteHook);
    }
    // No piece shares an id with the shipped kit, so nothing shipped is painted over.
    expect(SEA_CAVE_KIT.filter((a) => BIOME_KIT.some((b) => b.id === a.id))).toEqual([]);
  });

  it('fits tiles as the biome kit does and props by the tiles they stand on', () => {
    expect(seaCaveBox('sea-cave-floor')).toEqual({ width: 128, height: 128 });
    expect(seaCaveBox('sea-cave-boulder')).toEqual({ width: 192, height: 160 });
    expect(seaCaveBox('sea-cave-lantern')).toEqual({ width: 128, height: 192 });
    expect(seaCaveBox('shore-rock')).toBeUndefined();
  });

  it('lists the kit with the scenery only while the wish is on', () => {
    expect(kitPieces()).toHaveLength(BIOME_KIT.length + SEA_CAVE_KIT.length);
    expect(pictureName('sea-cave-crates')).toBe("Smugglers' crates");
    switchMod(SEA_CAVE_MOD, false);
    expect(kitPieces()).toBe(BIOME_KIT);
    expect(pictureName('sea-cave-crates')).toBe('sea-cave-crates');
  });

  it('paints the rock face seen from the front, from the cave pictures already painted', async () => {
    const face = SEA_CAVE_KIT.find((a) => a.id === 'sea-cave-rock-face')!;
    const prompt = buildPrompt(face);
    expect(prompt).toContain('the upright face of a rock wall seen straight on from the front');
    expect(prompt).not.toContain(TILE_FRAMING);
    // Every other tile keeps the ground's framing, word for word.
    expect(buildPrompt(SEA_CAVE_KIT.find((a) => a.id === 'sea-cave-wall')!)).toContain(TILE_FRAMING);
    // The cave's rock was painted in the Art tab, so it is found among the pictures painted there.
    const [anchors, painted] = [await mkdtemp(join(tmpdir(), 'anchors-')), await mkdtemp(join(tmpdir(), 'painted-'))];
    const png = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#8a6a4a' } }).png().toBuffer();
    await mkdir(join(painted, 'raw'), { recursive: true });
    await writeFile(join(painted, 'raw', 'sea-cave-wall.png'), png);
    await writeFile(join(painted, 'sea-cave-floor.png'), png);
    const asked: ImageRequest[] = [];
    const provider = { id: 'gemini', model: 'gemini-3.1-flash-image', generate: async (r: ImageRequest) => (asked.push(r), { mimeType: 'image/png', data: png }) };
    const { references } = await paintKitAsset(face, provider, anchors, painted);
    expect(references).toEqual(['sea-cave-wall', 'sea-cave-floor']);
    expect(asked[0]!.references).toHaveLength(2);
  });

  it('paints a prop standing on its tiles in the isometric style, sized to their diamond', async () => {
    const boulder = SEA_CAVE_KIT.find((a) => a.id === 'sea-cave-boulder')!;
    const dir = await mkdtemp(join(tmpdir(), 'painted-'));
    // A grey boulder on magenta, as the model paints it.
    const rock = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#7a7a80' } }).png().toBuffer();
    const png = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#ff00ff' } }).composite([{ input: rock, left: 106, top: 200 }]).png().toBuffer();
    const asked: ImageRequest[] = [];
    const provider = { id: 'gemini', model: 'gemini-3.1-flash-image', generate: async (r: ImageRequest) => (asked.push(r), { mimeType: 'image/png', data: png }) };
    const { entry } = await paintKitAsset(boulder, provider, dir, dir);
    if (STYLE.camera !== 'isometric') {
      expect(asked[0]!.prompt).not.toContain('Footprint:');
      expect(entry.view).toBeUndefined();
      return;
    }
    expect(asked[0]!.prompt).toContain(footprintWords({ width: 2, height: 1 }));
    expect(entry).toMatchObject({ width: isoSpan(2, 1), height: 120, view: 'isometric' });
  });
});
