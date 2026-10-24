import { BUILDING_STYLES, buildingKit, landmarkAt, type Building, type RegionMap, type TilePoint } from '@co-mmo/shared';
import type { KitHouses } from './assets/building-kit/kit-houses.ts';
import type { World } from './world.ts';

// The Art tab's Buildings page: every building in the world, how it stands
// in the isometric camera (a kit house in its look, or tall walls in its own
// wall texture), the kit house's views once drawn, and the furniture inside
// with the tiles each piece blocks, which the Owner can change from there
// (a 'footprint' world edit, so it can be taken back like any other).

/** A piece of furniture in a building: what it is, where it stands and the tiles it blocks. */
export interface FurnitureView {
  asset: string;
  name: string;
  /** A tile it covers, for the 'footprint' edit; on the ground floor only, as the editor works there. */
  at: TilePoint;
  footprint: [width: number, height: number];
  /** The floor it stands on, 0 for the ground. */
  floor: number;
  /** False when it is on another floor, where the editor does not reach yet. */
  editable: boolean;
}

/** One building as the Buildings page shows it. */
export interface BuildingView {
  region: string;
  regionName: string;
  /** Its place in the land's list of buildings. */
  index: number;
  style: string;
  name: string;
  /** Its floor inside the walls, in tiles. */
  floor: [width: number, height: number];
  stands: 'kit' | 'walls';
  /** The kit look's name, for a kit house. */
  look?: string;
  /** Why it stands as it does, in words for the Owner. */
  note: string;
  /** The kit house's views and checks, for a kit house. */
  house?: buildingKit.KitHouseInfo;
  furniture: FurnitureView[];
}

/** Every building in every land, for the Buildings page. */
export async function buildingsOverview(world: World, houses: KitHouses | undefined): Promise<BuildingView[]> {
  const out: BuildingView[] = [];
  for (const region of world.regions.values()) {
    const { map, def } = region;
    for (const [index, b] of map.buildings.entries()) {
      const style = BUILDING_STYLES[b.style];
      const house = buildingKit.kitHouse(b);
      const look = style?.kit ? buildingKit.KIT_LOOKS[style.kit] : undefined;
      out.push({
        region: def.id,
        regionName: def.name,
        index,
        style: b.style,
        name: style?.name ?? b.style,
        floor: [b.width - 2, b.height - 2],
        stands: house ? 'kit' : 'walls',
        ...(house && look ? { look: look.name } : {}),
        note: standsNote(b, Boolean(look), Boolean(house)),
        ...(house && houses ? { house: await houses.info(house, index) } : {}),
        furniture: furnitureIn(map, b),
      });
    }
  }
  return out;
}

/** Why a building stands as a kit house or as tall walls. */
function standsNote(b: Building, look: boolean, house: boolean): string {
  if (house) return 'Stands as a kit house: its outside from afar, and a cutaway of the storey you are on inside.';
  if (b.art) return 'Built from its kit pieces, with walls standing in its rock face.';
  if (!look) return 'Stands as tall walls in its own wall texture: it has no kit look.';
  return "Stands as tall walls: its floor or doorway does not fall on the kit's two-tile bays.";
}

/** The furniture standing in a building, on every floor. */
function furnitureIn(map: RegionMap, b: Building): FurnitureView[] {
  const style = BUILDING_STYLES[b.style];
  const prefix = `${b.style}-furniture-`;
  return map.landmarks
    .filter((l) => l.asset.startsWith(prefix) && l.x > b.x && l.x < b.x + b.width && l.y > b.y && l.y <= b.y + b.height)
    .map((l) => {
      const at: TilePoint = [Math.floor(l.x - 0.01), Math.floor(l.y - 0.01)];
      const floor = l.floor ?? 0;
      return {
        asset: l.asset,
        name: style?.furniture[l.asset.slice(prefix.length)]?.name ?? l.asset,
        at,
        footprint: [l.footprint.width, l.footprint.height],
        floor,
        editable: floor === 0 && landmarkAt(map, at) === l,
      };
    });
}
