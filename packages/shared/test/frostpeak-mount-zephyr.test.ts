import { describe, expect, it } from 'vitest';
import { BUILDING_STYLES, Tile, WORLD_REGIONS, buildingKit, collides, floorChecks, generateRegion, glowOf, stairwayAt, storeyAt } from '../src/index.ts';
import { FROSTPEAK } from '../src/home-lands/frostpeak.ts';

const { KIT_LOOKS } = buildingKit;

describe('Mount Zephyr, Whiteledge, and The Eyrie of the First Watch', () => {
  const frostpeakDef = WORLD_REGIONS.find((r) => r.id === 'frostpeak')!;
  const map = generateRegion(frostpeakDef);

  it('spans Mount Zephyr across at least 33% of the region with mountain stone, Whiteledge town, and roads', () => {
    // 33% of 256 is ~84.5 tiles; Mount Zephyr occupies western x <= 88
    const totalTiles = map.width * map.height;
    const mountainWidth = 88;
    const mountainArea = mountainWidth * map.height;
    expect(mountainArea / totalTiles).toBeGreaterThanOrEqual(0.33);

    // Verify mountain stone is densely present across the western mountain mass:
    let mountainRocks = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x <= mountainWidth; x++) {
        if (map.tiles[y * map.width + x] === Tile.Rock) mountainRocks++;
      }
    }
    expect(mountainRocks).toBeGreaterThan(1500);

    // Verify Whiteledge buildings stand on the mountain ledges:
    expect(map.buildings.length).toBeGreaterThanOrEqual(4);
    const whiteledgeBuildings = map.buildings.filter((b) => b.x < 88);
    expect(whiteledgeBuildings.length).toBeGreaterThanOrEqual(4);

    // Verify road leads into the mountain pass and town:
    expect(map.tiles[120 * map.width + 84]).toBe(Tile.Path);
    expect(map.tiles[120 * map.width + 56]).toBe(Tile.Path);
  });

  it('connects isolated rooms with mountain tunnels across the floors above ground and underground', () => {
    // Check multiple distinct storeys (rooms + connecting tunnels) on Floor 1
    const floor1Storeys = map.storeys.filter((s) => s.floor === 1);
    expect(floor1Storeys.length, 'Floor 1 should have multiple isolated rooms and tunnels').toBeGreaterThanOrEqual(5);

    // Verify rooms span widely across the mountain (north at y ~ 34, south at y ~ 124, west at x ~ 18):
    const northRoom = floor1Storeys.find((s) => s.y < 40);
    const southRoom = floor1Storeys.find((s) => s.y > 110);
    const westTerrace = floor1Storeys.find((s) => s.x < 20);
    expect(northRoom).toBeDefined();
    expect(southRoom).toBeDefined();
    expect(westTerrace).toBeDefined();

    // Verify subterranean floors also have isolated chambers connected by mine tunnels:
    for (let f = -1; f >= -4; f--) {
      const subStoreys = map.storeys.filter((s) => s.floor === f);
      expect(subStoreys.length, `Underground floor ${f} should have multiple chambers and tunnels`).toBeGreaterThanOrEqual(5);
    }

    // Verify walkability from central hall through tunnel into north room on Floor 1:
    expect(collides(map, 42.5, 85.5, 1)).toBe(false); // central hall
    expect(collides(map, 42.5, 65.5, 1)).toBe(false); // inside north tunnel
    expect(collides(map, 42.5, 40.5, 1)).toBe(false); // inside north room
  });

  it('passes all floor and stairway validation checks with zero collisions for NPCs and monsters', () => {
    // Floor checks verify no overlapping storeys, valid stairs, and open landings
    const problems = floorChecks(map);
    expect(problems).toEqual([]);

    for (const npc of map.npcs) {
      expect(collides(map, npc.x, npc.y, npc.floor ?? 0), `NPC ${npc.name} at (${npc.x}, ${npc.y}) on floor ${npc.floor ?? 0}`).toBe(false);
    }

    for (const c of map.creatures) {
      expect(collides(map, c.x, c.y, c.floor ?? 0), `Creature ${c.name} at (${c.x}, ${c.y}) on floor ${c.floor ?? 0}`).toBe(false);
    }
  });

  it('generates the 8-storey Eyrie and 4-storey Sunken Drafts', () => {
    // Check above-ground storeys (+1 to +8)
    for (let f = 1; f <= 8; f++) {
      const storeys = map.storeys.filter((s) => s.floor === f);
      expect(storeys.length, `Expected at least one storey on floor ${f}`).toBeGreaterThan(0);
    }

    // Check open terraces/balconies
    for (const f of [4, 5, 7, 8]) {
      const storey = map.storeys.find((s) => s.floor === f);
      expect(storey?.open, `Expected floor ${f} to be an open terrace/balcony`).toBe(true);
    }

    // Check subterranean storeys (-1 to -4)
    for (let f = -1; f >= -4; f--) {
      const storeys = map.storeys.filter((s) => s.floor === f);
      expect(storeys.length, `Expected at least one storey on underground floor ${f}`).toBeGreaterThan(0);
    }
  });

  it('connects all 13 vertical levels with stairways or ladders', () => {
    // Verify a stairway connects every adjacent pair of floors from -4 up to 8
    for (let f = -4; f < 8; f++) {
      const way = map.stairways.find((s) => s.lower === f && s.upper === f + 1);
      expect(way, `Expected stairway connecting floor ${f} and ${f + 1}`).toBeDefined();
      expect(way!.bottom).toBeDefined();
      expect(way!.top).toBeDefined();
    }
  });

  it('places NPCs on their designated floors', () => {
    const npcsByFloor = new Map<string, number>();
    for (const npc of map.npcs) {
      npcsByFloor.set(npc.id, npc.floor ?? 0);
    }

    expect(npcsByFloor.get('ysolde')).toBe(0);
    expect(npcsByFloor.get('kaen')).toBe(0);
    expect(npcsByFloor.get('kip')).toBe(-1);
    expect(npcsByFloor.get('sula')).toBe(2);
    expect(npcsByFloor.get('aurius')).toBe(6);
    expect(npcsByFloor.get('vail')).toBe(8);
  });

  it('spawns subterranean monsters on floors -1 through -4', () => {
    const undergroundCreatures = map.creatures.filter((c) => (c.floor ?? 0) < 0);
    expect(undergroundCreatures.length).toBeGreaterThan(15);

    const kinds = new Set(undergroundCreatures.map((c) => c.kind));
    expect(kinds.has('ice-wisp')).toBe(true);
    expect(kinds.has('rime-stalker')).toBe(true);
    expect(kinds.has('deep-matriarch')).toBe(true);

    // Deep Crag Matriarchs should be on Floor -3
    const matriarchs = undergroundCreatures.filter((c) => c.kind === 'deep-matriarch');
    expect(matriarchs.every((c) => c.floor === -3)).toBe(true);

    // Rime Stalkers prowl floors -2 and -4
    const stalkers = undergroundCreatures.filter((c) => c.kind === 'rime-stalker');
    expect(stalkers.every((c) => c.floor === -2 || c.floor === -4)).toBe(true);
  });

  it('has a complete extended quest chain from Ysolde to the Hoarfrost Roc', () => {
    const quests = FROSTPEAK.quests;
    expect(quests['frostpeak-wisps']).toBeDefined();
    expect(quests['frostpeak-sunken-drafts']).toBeDefined();
    expect(quests['frostpeak-feather-mantle']).toBeDefined();
    expect(quests['frostpeak-roc-vigil']).toBeDefined();

    // Verify quest requirement dependencies
    expect(quests['frostpeak-sunken-drafts'].requires).toBe('frostpeak-wisps');
    expect(quests['frostpeak-feather-mantle'].requires).toBe('frostpeak-sunken-drafts');
    expect(quests['frostpeak-roc-vigil'].requires).toBe('frostpeak-feather-mantle');

    // Verify givers
    expect(quests['frostpeak-wisps'].giver).toBe('ysolde');
    expect(quests['frostpeak-sunken-drafts'].giver).toBe('kip');
    expect(quests['frostpeak-feather-mantle'].giver).toBe('sula');
    expect(quests['frostpeak-roc-vigil'].giver).toBe('vail');
  });

  it('uses dedicated building kit zephyr-marble and custom architectural styles with furniture', () => {
    // Verify building styles
    const eyrieBuilding = map.buildings.find((b) => b.style === 'frostpeak-eyrie');
    expect(eyrieBuilding, 'The Eyrie should use dedicated frostpeak-eyrie style').toBeDefined();

    const whiteledgeHouses = map.buildings.filter((b) => b.style === 'frostpeak-whiteledge-house');
    expect(whiteledgeHouses.length, 'Whiteledge town should have terrace houses').toBeGreaterThanOrEqual(3);

    // Verify dedicated building kit
    const eyrieStyle = BUILDING_STYLES['frostpeak-eyrie'];
    expect(eyrieStyle?.kit).toBe('zephyr-marble');
    expect(KIT_LOOKS['zephyr-marble']).toBeDefined();

    // Verify subterranean storeys use sunken drafts style
    for (let f = -1; f >= -4; f--) {
      const subStoreys = map.storeys.filter((s) => s.floor === f);
      expect(subStoreys.every((s) => s.style === 'frostpeak-sunken-drafts')).toBe(true);
    }

    // Verify landmarks/furniture inside buildings and mountain exterior
    const eyrieFurniture = map.landmarks.filter((l) => l.asset.startsWith('frostpeak-eyrie-furniture-'));
    expect(eyrieFurniture.length).toBeGreaterThanOrEqual(7);

    // Verify Phase 2 & 3 architectural assets: viaduct arch, tunnel portal, stone balustrades
    const portal = map.landmarks.find((l) => l.asset === 'frostpeak-eyrie-furniture-tunnel-portal');
    expect(portal, 'Expected mountain tunnel portal landmark at Eyrie approach').toBeDefined();

    const viaductArches = map.landmarks.filter((l) => l.asset === 'frostpeak-eyrie-furniture-viaduct-arch');
    expect(viaductArches.length, 'Expected viaduct bridge arches spanning the gorge').toBeGreaterThanOrEqual(2);

    const balustrades = map.landmarks.filter((l) => l.asset === 'frostpeak-eyrie-furniture-stone-balustrade');
    expect(balustrades.length, 'Expected stone balustrades on viaduct bridge and high terraces').toBeGreaterThanOrEqual(8);

    // Verify Floor 2 has the open-air viaduct bridge
    const f2Bridge = map.storeys.find((s) => s.floor === 2 && s.open && s.height >= 20);
    expect(f2Bridge, 'Expected open-air viaduct bridge storey on Floor 2').toBeDefined();

    const houseFurniture = map.landmarks.filter((l) => l.asset.startsWith('frostpeak-whiteledge-house-furniture-'));
    expect(houseFurniture.length).toBeGreaterThanOrEqual(4);

    // Verify Step 3 subterranean cavern props and mixed marble/stone transition props:
    const sunkenStyle = BUILDING_STYLES['frostpeak-sunken-drafts'];
    expect(sunkenStyle?.furniture['mine-rail-crossing']).toBeDefined();
    expect(sunkenStyle?.furniture['stalactite-watchpost']).toBeDefined();
    expect(sunkenStyle?.furniture['marble-rubble']).toBeDefined();

    const sunkenFurniture = map.landmarks.filter((l) => l.asset.startsWith('frostpeak-sunken-drafts-furniture-'));
    expect(sunkenFurniture.length).toBeGreaterThanOrEqual(15);

    const railCrossings = map.landmarks.filter((l) => l.asset === 'frostpeak-sunken-drafts-furniture-mine-rail-crossing');
    expect(railCrossings.length, 'Expected mine rail crossings in subterranean chambers').toBeGreaterThanOrEqual(4);

    const stalactiteWatchposts = map.landmarks.filter((l) => l.asset === 'frostpeak-sunken-drafts-furniture-stalactite-watchpost');
    expect(stalactiteWatchposts.length, 'Expected stalactite watch-posts in subterranean chambers').toBeGreaterThanOrEqual(3);

    const marbleRubble = map.landmarks.filter((l) => l.asset === 'frostpeak-sunken-drafts-furniture-marble-rubble');
    expect(marbleRubble.length, 'Expected marble rubble in Floor +1 transition halls and subterranean caverns').toBeGreaterThanOrEqual(4);
    expect(marbleRubble.some((l) => l.floor === 1)).toBe(true);
    expect(marbleRubble.some((l) => (l.floor ?? 0) < 0)).toBe(true);

    // Verify Step 4 & 5 cliff facades, ice cascades, cantilever decks, beacon braziers, and upper terrace furnishings:
    expect(eyrieStyle?.furniture['falcon-frieze']).toBeDefined();
    expect(eyrieStyle?.furniture['ice-cascade']).toBeDefined();
    expect(eyrieStyle?.furniture['beacon-brazier']).toBeDefined();
    expect(BUILDING_STYLES['frostpeak-whiteledge-house']?.furniture['cantilever-deck']).toBeDefined();

    const falconFriezes = map.landmarks.filter((l) => l.asset === 'frostpeak-eyrie-furniture-falcon-frieze');
    expect(falconFriezes.length, 'Expected carved falcon relief friezes along cliffs and halls').toBeGreaterThanOrEqual(5);

    const iceCascades = map.landmarks.filter((l) => l.asset === 'frostpeak-eyrie-furniture-ice-cascade');
    expect(iceCascades.length, 'Expected frozen waterfalls in chasm gorge and upper terraces').toBeGreaterThanOrEqual(3);

    const beaconBraziers = map.landmarks.filter((l) => l.asset === 'frostpeak-eyrie-furniture-beacon-brazier');
    expect(beaconBraziers.length, 'Expected monumental beacon braziers at pass, viaduct, and high peaks').toBeGreaterThanOrEqual(8);

    const cantileverDecks = map.landmarks.filter((l) => l.asset === 'frostpeak-whiteledge-house-furniture-cantilever-deck');
    expect(cantileverDecks.length, 'Expected cantilevered timber decks along Whiteledge and west terraces').toBeGreaterThanOrEqual(4);

    // Verify frozen river gorge beneath the viaduct bridge on Floor 0:
    expect(map.tiles[108 * map.width + 38]).toBe(Tile.Water);

    // Verify every upper floor (+1 through +8) has dedicated architectural landmarks/furniture:
    for (let f = 1; f <= 8; f++) {
      const floorProps = map.landmarks.filter((l) => l.floor === f);
      expect(floorProps.length, `Expected furniture/props on upper floor ${f}`).toBeGreaterThanOrEqual(3);
    }

    // Verify dynamic lighting (glowOf) for mountain braziers, hearths, and subterranean miner lanterns:
    expect(glowOf('frostpeak-eyrie-furniture-beacon-brazier')).toBeDefined();
    expect(glowOf('frostpeak-eyrie-furniture-silver-brazier')).toBeDefined();
    expect(glowOf('frostpeak-whiteledge-house-furniture-mountain-hearth')).toBeDefined();
    expect(glowOf('frostpeak-sunken-drafts-furniture-stalactite-watchpost')).toBeDefined();
    expect(glowOf('frostpeak-sunken-drafts-furniture-mining-rig')).toBeDefined();
  });
});
