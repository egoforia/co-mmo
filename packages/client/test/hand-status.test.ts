import { describe, expect, it } from 'vitest';
import { handLink, handStatusHtml, type HandStatus } from '../src/art-ui/hand-status.ts';
import type { ArtItem, WalkerView } from '../src/art-ui/state.ts';

const mara = { id: 'player-mara', name: 'Mara', place: { tab: 'characters', page: 'Mara' }, walks: { 'front-left': {} } } as unknown as WalkerView;
const sword = { id: 'held-sword', name: 'Sword', place: { tab: 'items', page: 'Weapons' } } as unknown as ArtItem;
const idle: HandStatus = { running: false, done: 0, total: 0, waiting: 0 };

describe('the Art tab\'s "Finding hands" line', () => {
  it('is hidden when there is nothing to do', () => {
    expect(handStatusHtml(null, [mara], [sword])).toBe('');
    expect(handStatusHtml(idle, [mara], [sword])).toBe('');
  });

  it('counts a run as it goes, naming the picture being looked at, and leads to its character', () => {
    const html = handStatusHtml({ ...idle, running: true, done: 6, total: 18, waiting: 12, looking: 'player-mara-walk-front-right' }, [mara], [sword]);
    expect(html).toContain('Finding hands… 7 of 18');
    expect(html).toContain('looking at Mara walking towards us, right');
    expect(html).toContain('href="#art/characters/Mara"');
    expect(html).toContain('data-hands-focus="player-mara"');
    expect(handStatusHtml({ ...idle, running: true, done: 0, total: 18, waiting: 18, looking: 'held-sword' }, [mara], [sword])).toContain('looking at Sword');
    expect(handStatusHtml({ ...idle, running: true, done: 0, total: 18, waiting: 18, looking: 'player-mara-attack-back-left' }, [mara], [sword])).toContain('looking at Mara attacking away, left');
  });

  it('says why pictures are waiting when hands cannot be found', () => {
    const html = handStatusHtml({ ...idle, waiting: 18, blocked: 'No judge model that can read pictures is set.' }, [mara], [sword]);
    expect(html).toContain('18 pictures are waiting');
    expect(html).toContain('No judge model that can read pictures is set.');
  });

  it('leads to the first character page when a held item is being looked at', () => {
    expect(handLink({ ...idle, running: true, looking: 'held-sword' }, [mara])).toEqual({ href: '#art/characters' });
    expect(handLink({ ...idle, running: true, looking: 'player-mara-stand-front-left' }, [mara])).toEqual({ href: '#art/characters/Mara', walker: 'player-mara' });
    expect(handLink({ ...idle, running: true, looking: 'player-mara-run-front-right' }, [mara])).toEqual({ href: '#art/characters/Mara', walker: 'player-mara' });
  });
});
