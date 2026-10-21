import type { BuildingSpec } from './spec.ts';

/**
 * The kit's sample buildings: the layouts the art direction tests were
 * painted and checked with, used by the tests and as previews of a kit.
 */
export const SAMPLE_BUILDINGS: Record<string, BuildingSpec> = {
  cottage: {
    W: 3, D: 2, chimney: [2.4, 1.25],
    storeys: [{ front: { 0: 'window', 1: 'door', 2: 'window' }, left: { 1: 'window' }, right: { 0: 'window' }, back: { 1: 'window' } }],
  },
  'two-storey house': {
    W: 3, D: 2, stairs: true, chimney: [0.6, 1.25],
    storeys: [
      { front: { 0: 'door', 2: 'window' }, left: { 0: 'window' }, back: { 2: 'window' }, right: { 0: 'window' } },
      { front: { 0: 'window', 1: 'window', 2: 'window' }, left: { 1: 'window' }, back: { 0: 'window', 2: 'window' }, right: { 0: 'window' } },
    ],
  },
  'long house': {
    W: 5, D: 2, chimney: [1.5, 1.25],
    storeys: [{ front: { 0: 'window', 1: 'door', 2: 'window', 3: 'door', 4: 'window' }, left: { 0: 'window', 1: 'window' } }],
  },
  shed: { W: 2, D: 1, storeys: [{ front: { 0: 'door' }, left: { 0: 'window' } }] },
  'cottage, door on the side': {
    W: 2, D: 3, chimney: [1.25, 2.4],
    storeys: [{ left: { 1: 'door' }, front: { 0: 'window', 1: 'window' }, right: { 2: 'window' }, back: { 0: 'window' } }],
  },
  tower: {
    W: 2, D: 2, stairs: true,
    storeys: [
      { front: { 0: 'door' }, left: { 0: 'window' } },
      { front: { 1: 'window' }, right: { 0: 'window' } },
      { front: { 0: 'window', 1: 'window' }, back: { 0: 'window' }, right: { 1: 'window' } },
    ],
  },
  temple: {
    W: 4, D: 3, roof: 'flat', dome: { finial: true },
    storeys: [{ left: { 1: 'door' }, front: { 1: 'window', 3: 'window' }, right: { 1: 'window' }, back: { 1: 'window', 3: 'window' } }],
  },
  castle: {
    W: 4, D: 4, roof: 'flat', battlements: true,
    towers: [{ corner: 'front-left', round: true, top: 'cone' }, { corner: 'back-right' }],
    storeys: [{ left: { 2: 'door' }, front: { 2: 'window' }, right: { 1: 'window' }, back: { 1: 'window' } }],
  },
};
