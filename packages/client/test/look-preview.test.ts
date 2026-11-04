import { describe, expect, it } from 'vitest';
import { artDirectorPage, loadArtDirector } from '../src/art-ui/art-director.ts';
import {
  buildingsForLook,
  getLookPreviewState,
  lookBiomePreviewHtml,
} from '../src/art-ui/look-preview.ts';
import { artState, type ArtOverview, type KitSheetView } from '../src/art-ui/state.ts';

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

  it('renders artDirectorPage with server rubric audit entries without throwing on undefined dimensions.facets', async () => {
    artState.data = {
      imageModel: 'imagen-4',
      videoModel: 'veo-2',
      budget: { monthlyUsd: 25, spentUsd: 1.2, paused: false, warn: false },
      jobs: [],
      items: [
        {
          id: 'sanctum-meadow',
          name: 'Sanctum meadow',
          place: { tab: 'biomes', page: 'the Sanctum' },
          url: '/art/sanctum-meadow.png',
          source: 'shipped',
          estimateUsd: 0.04,
          repaintable: true,
          takesNote: true,
        },
      ],
      groups: [],
      walkers: [],
      bodies: [],
      sounds: [],
      effectsModel: null,
      musicModel: null,
    } as ArtOverview;

    artState.ctx = {
      api: async () =>
        ({
          version: '1',
          basePrompt: 'Low-poly faceted style',
          negatives: ['outlines', 'gradients'],
          biomes: {
            sanctum: { name: 'the Sanctum', colors: ['#F5EFE0'], mood: 'peaceful', anchors: ['sanctum-meadow'] },
          },
          fashionStyles: {
            pilgrim: { name: 'Pilgrim', biome: 'sanctum', colors: ['#F5EFE0'], feel: 'linen', anchors: [] },
          },
          goldenAnchors: {},
          audits: {
            'sanctum-meadow': {
              asset: 'sanctum-meadow',
              score: 88,
              status: 'coherent',
              rubric: { facets: 92, palette: 92, projection: 94, scale: 69, silhouette: 92 },
              findings: ['Subject touches edge.'],
              suggestedNote: 'Keep broad unlit colour facets.',
              auditedAt: 1793808334349,
            },
          },
          consultations: [
            { role: 'user', text: 'How should Frostpeak look?', at: 1793808334000 },
            { role: 'director', text: 'Use crisp blue-white facets.', at: 1793808335000 },
          ],
          overallScore: 88,
          auditedCount: 1,
          flaggedCount: 0,
        }) as never,
      rerender: () => {},
      toast: () => {},
    };

    await loadArtDirector();
    const html = artDirectorPage();
    expect(html).toContain('Facets 92/100');
    expect(html).toContain('88/100 · coherent');
    expect(html).toContain('Use crisp blue-white facets.');
  });
});
