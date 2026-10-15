import { describe, expect, it } from 'vitest';
import { WISH_CATEGORIES, checkDraft, cleanDraftFields, cleanLocks, draftCost, draftFromDefinition, mergeGodFields, wishSubcategory, worldLines } from '../src/index.ts';

const look = { hook: 'a glowing seal', body: 'small and round', color: '#e8c66a', mood: 'calm' };
/** One filled-in draft per subcategory, as a player might write it. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  potion: { name: 'Dew Tonic', description: 'Morning dew in a flask.', heal: 30, ...look },
  keepsake: { name: 'Lucky Pebble', description: 'A smooth pebble.', ...look },
  material: { name: 'Moth Dust', description: 'Shimmering dust.', ...look },
  gear: { name: 'Dew Blade', description: 'A wet sword.', itemKind: 'weapon', rarity: 'rare', focus: 'agility', ...look },
  recipe: { name: 'Double Tonic', description: 'Two horns make a tonic.', materials: [{ item: 'goat-horn', qty: 2 }], result: 'tonic', qty: 1 },
  ability: { name: 'Moonbolt', description: 'A bolt of moonlight.', effect: 'bolt', ...look },
  creature: { name: 'Lantern Moth', description: 'A moth.', behavior: 'chase', level: 2, count: 3, drops: ['tonic'], ...look },
  person: { name: 'Old Wren', description: 'A birdwatcher.', greeting: 'Shh, the wrens!', ...look },
  gathering: { name: 'Fishing', what: 'cast a line', where: 'water', reward: 'fish' },
  'item-magic': { name: 'Gull Whistle', item: 'a seashell', what: 'a gull brings a fish' },
  hunting: { name: 'Scarab Gems', which: 'sun scarabs', reward: 'a gem sometimes' },
  gifts: { name: 'Shore Gift', when: 'each morning', what: 'a shell' },
  region: { name: 'Frost Hollow', description: 'A cold hollow.', biome: 'frostpeak', danger: 3, creature: 'walking-mushroom', npcName: 'Yeti Jo', npcGreeting: 'Brr!' },
  building: { name: 'Mossy Cottage', where: 'by the pond', outside: 'stone and moss', inside: 'one warm room' },
  screen: { name: 'World Map', what: 'see every region', where: 'press M' },
  world: { name: 'Rain', what: 'rain in the Woods' },
};

describe('the Wish Workshop categories', () => {
  it('turns a filled-in draft of every subcategory into a wish with no problems', () => {
    for (const category of WISH_CATEGORIES) {
      for (const sub of category.subs) {
        const fields = cleanDraftFields(sub, SAMPLES[sub.id]);
        const checked = checkDraft({ category: category.id, sub: sub.id, fields });
        expect(checked.problems, sub.id).toEqual([]);
        expect(checked.tier, sub.id).toBe(sub.tier);
        if (sub.makes === 'rule' || sub.makes === 'engine') expect(checked.brief?.length, sub.id).toBeGreaterThan(1);
        else {
          expect(checked.definition?.kind, sub.id).toBe(sub.makes);
          expect(worldLines(checked.definition!).length, sub.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it('says plainly what is missing, and never throws', () => {
    expect(checkDraft({ category: 'carry', sub: 'potion', fields: {} }).problems).toEqual([
      'Give it a name.', 'Fill in "What it is, in a sentence or two".', 'Describe the one feature you would know it by.', 'Describe its body and shape.',
    ]);
    expect(checkDraft({ category: 'nope', sub: 'nope', fields: {} }).problems).toEqual(['Pick what kind of wish this is.']);
    const recipe = checkDraft({ category: 'know', sub: 'recipe', fields: { ...SAMPLES.recipe, result: 'goat-horn' } });
    expect(recipe.problems).toEqual(['A recipe cannot use what it makes.']);
  });

  it('keeps only known fields, trimmed and clamped', () => {
    const sub = wishSubcategory('living', 'creature')!;
    const fields = cleanDraftFields(sub, { name: '  Moth  ', level: 99, count: '2', behavior: 'fly', drops: ['a', 'b', 'c', 'd'], extra: 'x' });
    expect(fields).toEqual({ name: 'Moth', level: 6, count: 2, drops: ['a', 'b', 'c'] });
  });

  it('prices wishes as the God does: regions cost more, reviewed wishes are free to ask', () => {
    const region = wishSubcategory('places', 'region')!;
    expect(draftCost(checkDraft({ category: 'places', sub: 'region', fields: cleanDraftFields(region, SAMPLES.region) }))).toBe(12);
    expect(draftCost(checkDraft({ category: 'places', sub: 'region', fields: {} }))).toBe(12);
    expect(draftCost(checkDraft({ category: 'play', sub: 'gifts', fields: SAMPLES.gifts! }))).toBe(0);
    expect(worldLines(checkDraft({ category: 'carry', sub: 'gear', fields: SAMPLES.gear! }).definition!)[0]).toBe('Rare weapon: +4 damage, +2 Agility.');
  });

  it('never lets the God change a locked field, and cleans what it suggests', () => {
    const sub = wishSubcategory('living', 'creature')!;
    const fields = { name: 'Lantern Moth', level: 1 };
    const locked = cleanLocks(sub, ['name', 'nonsense', 3]);
    expect(locked).toEqual(['name']);
    const merged = mergeGodFields(sub, fields, { name: 'Gloom Moth', level: 9, behavior: 'sneak', hook: 'a lantern', secret: 1 }, locked);
    expect(merged.fields).toEqual({ name: 'Lantern Moth', level: 6, hook: 'a lantern' });
    expect(merged.changed.sort()).toEqual(['hook', 'level']);
  });

  it('turns every finished wish back into the draft that makes it', () => {
    for (const category of WISH_CATEGORIES) {
      for (const sub of category.subs) {
        const checked = checkDraft({ category: category.id, sub: sub.id, fields: cleanDraftFields(sub, SAMPLES[sub.id]) });
        if (!checked.definition) continue;
        const back = draftFromDefinition(checked.definition)!;
        expect(back, sub.id).toMatchObject({ category: category.id, sub: sub.id });
        expect(checkDraft(back).definition, sub.id).toEqual(checked.definition);
      }
    }
  });
});
