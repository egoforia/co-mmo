import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { artFilePath } from '../src/art-files.ts';

describe('painted file URLs', () => {
  it('map each kind of painted file to its folder in the art directory', () => {
    expect(artFilePath('/art', '/wished-art/c-abc.png')).toBe(join('/art', 'c-abc.png'));
    expect(artFilePath('/art', '/wished-art/walks/views/mara-left.png')).toBe(join('/art', 'walks', 'views', 'mara-left.png'));
    expect(artFilePath('/art', '/wished-art/history/player-mara~walk/1a2b/strip.png')).toBe(join('/art', 'history', 'player-mara~walk', '1a2b', 'strip.png'));
    expect(artFilePath('/art', '/wished-art/sounds/hit.mp3')).toBe(join('/art', 'sounds', 'hit.mp3'));
  });

  it('name nothing outside the art directory or of another type', () => {
    expect(artFilePath('/art', '/wished-art/../world.json')).toBeUndefined();
    expect(artFilePath('/art', '/wished-art/walks/..%2F..%2Fsecret.png')).toBeUndefined();
    expect(artFilePath('/art', '/wished-art/paint-requests.json')).toBeUndefined();
    expect(artFilePath('/art', '/api/art')).toBeUndefined();
  });
});
