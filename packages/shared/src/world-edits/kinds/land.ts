import type { Weather } from '../../sky.ts';
import { isBlocking } from '../../world.ts';
import type { EditKind } from '../kind.ts';
import { OFF_EDGE, inside, tileOf } from '../tiles.ts';

// The land's own settings: where players arrive, and weather that stays
// whatever the sky does elsewhere (a land of endless snow, a lab kept
// clear). The latest setting of each wins.

const WEATHER_NAMES: Record<Weather | 'sky', string> = {
  sky: 'As the sky turns',
  clear: 'Always clear',
  cloudy: 'Always cloudy',
  rain: 'Always raining',
  storm: 'Always stormy',
  fog: 'Always foggy',
  snow: 'Always snowing',
  sandstorm: 'Always a sandstorm',
};

/** Where players arrive on the land, and its weather. */
export const LAND: EditKind<'land'> = {
  kind: 'land',
  name: 'Land settings',
  hint: 'Choose the land’s weather, and tick “Players arrive here” to move where they come in; then click open ground (where they arrive, when ticked).',
  pointer: 'click',
  fields: [
    { key: 'weather', label: 'Weather', type: 'choice', choices: () => Object.entries(WEATHER_NAMES).map(([id, name]) => ({ id, name })) },
    { key: 'arrive', label: 'Players arrive here', type: 'flag', default: false },
  ],
  shape: '{"kind":"land","at":[x,y],"weather":"snow"|"sky","arrive":true}',
  make: (use, v) => ({ kind: 'land', at: use.at, weather: String(v.weather) as Weather | 'sky', ...(v.arrive ? { arrive: true } : {}) }),
  check(map, edit) {
    if (!inside(map, edit.at)) return OFF_EDGE;
    if (!Object.hasOwn(WEATHER_NAMES, edit.weather)) return 'Pick weather from the list.';
    return edit.arrive && isBlocking(tileOf(map, edit.at)) ? 'Players must arrive on open ground.' : undefined;
  },
  apply(map, edit) {
    if (edit.weather === 'sky') delete map.weather;
    else map.weather = edit.weather;
    if (edit.arrive) {
      if (isBlocking(tileOf(map, edit.at))) return false;
      map.spawn = { x: edit.at[0] + 0.5, y: edit.at[1] + 0.5 };
    }
    return true;
  },
  keep: (d) => ({ kind: 'land', at: d.at, weather: d.weather, ...(d.arrive ? { arrive: true } : {}) }),
  words: (e) => `Land settings: ${WEATHER_NAMES[e.weather]?.toLowerCase() ?? e.weather}${e.arrive ? `, players arrive at ${e.at.join(', ')}` : ''}`,
};
