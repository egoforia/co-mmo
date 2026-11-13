import { describe, expect, it } from 'vitest';
import { EDIT_KINDS } from '@co-mmo/shared';
import { EditorCore } from '../src/editor/core.ts';
import { FOLDED, groups } from '../src/editor/rail.ts';

// The rail holds the making tools; the ones that change a thing already
// there live in Select's inspector, and none is lost.

describe('the editor rail', () => {
  it('leaves the inspector\'s kinds off the rail, and every other tool on it', () => {
    const core = new EditorCore();
    const onRail = groups(core).flatMap((g) => g.tools);
    for (const t of FOLDED) expect(onRail).not.toContain(t);
    for (const t of core.tools()) if (!FOLDED.includes(t.id)) expect(onRail).toContain(t.id);
    expect(groups(core).map((g) => g.name)).toEqual(['Select', 'Ground', 'Build', 'Furnish', 'Life', 'Places']);
  });

  it('changes each folded kind from the inspector, or Select itself', () => {
    for (const t of FOLDED) if (t !== 'move' && t !== 'remove') expect(EDIT_KINDS[t as keyof typeof EDIT_KINDS].inspects, t).toBeDefined();
  });
});
