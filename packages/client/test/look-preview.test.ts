import { describe, expect, it } from 'vitest';
import {
  buildingsForLook,
  getLookPreviewState,
  lookBiomePreviewHtml,
} from '../src/art-ui/look-preview.ts';
import { artState, type KitSheetView } from '../src/art-ui/state.ts';

describe('Building look biome preview stage', () => {
  it('resolves buildings and native biome for each kit look and renders the biome preview toolbar & canvas', () => {
    artState.buildings = [
      {
        region: 'whispering-woods',
        regionName: 'Whispering Woods',
        index: 1,
        style: 'woods-castle',
        name: 'Mossgate Castle',
        floor: [16, 26],
        stands: 'kit',
        look: 'Mossy castle stone',
        note: '',
        house: {
          building: 1,
          key: 'castle-stone-8x13-wj3nye',
          status: 'ready',
          views: {
            outside: { picture: '/wished-art/kit-houses/castle-stone-8x13-wj3nye/outside.png', normal: '', glow: '' },
            'storey-1': { picture: '/wished-art/kit-houses/castle-stone-8x13-wj3nye/storey-1.png', normal: '', glow: '' },
          },
          frame: { width: 1744, height: 1587, origin: [984, 1476], u: 100 },
        },
        furniture: [],
      },
    ];

    const castleSheet: KitSheetView = {
      look: 'castle-stone',
      name: 'Mossy castle stone',
      paintings: [{ id: 'shipped/sheet-1', shipped: true }],
      checking: false,
      textures: [],
    };

    const matched = buildingsForLook('castle-stone', 'Mossy castle stone');
    expect(matched).toHaveLength(1);
    expect(matched[0]?.name).toBe('Mossgate Castle');

    const st = getLookPreviewState(castleSheet);
    expect(st.biome).toBe('whispering-woods');
    expect(st.view).toBe('outside');

    const html = lookBiomePreviewHtml(castleSheet);
    expect(html).toContain('data-look-preview="castle-stone"');
    expect(html).toContain('data-look-canvas="castle-stone"');
    expect(html).toContain('Mossgate Castle');
    expect(html).toContain('Whispering Woods (native)');
    expect(html).toContain('Inside · Storey 1');
  });
});
