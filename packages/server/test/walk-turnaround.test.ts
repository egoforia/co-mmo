import { describe, expect, it } from 'vitest';
import {
  ISO_WAYS,
  calculateIsometricRotation,
  generateAngleTurnaroundPrompt,
  type IsoWay,
} from '@co-mmo/shared';

describe('Isometric Angle Turnaround Prompt Generator', () => {
  it('correctly calculates turntable rotations across all 12 angle pairs', () => {
    // 90 degrees clockwise pairs
    const clockwisePairs: [IsoWay, IsoWay][] = [
      ['front-left', 'front-right'],
      ['front-right', 'back-right'],
      ['back-right', 'back-left'],
      ['back-left', 'front-left'],
    ];
    for (const [s, t] of clockwisePairs) {
      const res = calculateIsometricRotation(s, t);
      expect(res.deltaDegrees).toBe(90);
      expect(res.rotationSummary).toContain('90° clockwise');
      expect(res.rotationInstruction).toContain('90 degrees clockwise');
    }

    // 90 degrees counter-clockwise pairs
    const counterClockwisePairs: [IsoWay, IsoWay][] = [
      ['front-right', 'front-left'],
      ['back-right', 'front-right'],
      ['back-left', 'back-right'],
      ['front-left', 'back-left'],
    ];
    for (const [s, t] of counterClockwisePairs) {
      const res = calculateIsometricRotation(s, t);
      expect(res.deltaDegrees).toBe(-90);
      expect(res.rotationSummary).toContain('90° counter-clockwise');
      expect(res.rotationInstruction).toContain('90 degrees counter-clockwise');
    }

    // 180 degrees opposite diagonal pairs
    const oppositePairs: [IsoWay, IsoWay][] = [
      ['front-left', 'back-right'],
      ['front-right', 'back-left'],
      ['back-right', 'front-left'],
      ['back-left', 'front-right'],
    ];
    for (const [s, t] of oppositePairs) {
      const res = calculateIsometricRotation(s, t);
      expect(res.deltaDegrees).toBe(180);
      expect(res.rotationSummary).toContain('180° to opposite diagonal');
      expect(res.rotationInstruction).toContain('180 degrees to the opposite diagonal');
    }
  });

  it('generates prompt to copy single standing image into another isometric angle (front-right to front-left)', () => {
    const result = generateAngleTurnaroundPrompt({
      name: 'Deep Crag Matriarch',
      sourceDirection: 'front-right',
      targetDirection: 'front-left',
      referenceType: 'standing',
      targetType: 'standing',
      body: 'four-legged',
      kind: 'creature',
    });

    expect(result.sourceLabel).toBe('towards us, right');
    expect(result.targetLabel).toBe('towards us, left');
    expect(result.sourceCorner).toBe('lower-right corner');
    expect(result.targetCorner).toBe('lower-left corner');
    expect(result.deltaDegrees).toBe(-90);

    // Prompt content checks
    expect(result.prompt).toContain('Deep Crag Matriarch');
    expect(result.prompt).toContain('single attached standing image (showing Deep Crag Matriarch standing, facing towards us, right)');
    expect(result.prompt).toContain('LOWER-LEFT corner');
    expect(result.prompt).toContain('Rotate 90 degrees counter-clockwise on the isometric turntable');
    expect(result.prompt).toContain('Copy Deep Crag Matriarch from the reference with 100% fidelity');
    expect(result.prompt).toContain('#FF00FF');
    expect(result.prompt).toContain('facing the lower-right corner'); // WRONG_CORNER for front-left in avoid
  });

  it('generates prompt to copy single walking clip into another isometric angle (front-right to front-left)', () => {
    const result = generateAngleTurnaroundPrompt({
      name: 'Deep Crag Matriarch',
      sourceDirection: 'front-right',
      targetDirection: 'front-left',
      referenceType: 'clip',
      targetType: 'clip',
      body: 'four-legged',
      kind: 'creature',
    });

    expect(result.prompt).toContain('walking animation clip (showing Deep Crag Matriarch walking towards us, right)');
    expect(result.prompt).toContain('walks in place along the isometric diagonal');
    expect(result.prompt).toContain('steady four-legged quadruped walk with legs stepping in alternating pairs');
    expect(result.prompt).toContain('planted firmly where it lands until it lifts again, with no sliding');
    expect(result.prompt).toContain('Rotate 90 degrees counter-clockwise on the isometric turntable');
    expect(result.prompt).toContain('background MUST stay one flat, even, solid pure magenta colour (#FF00FF)');
  });

  it('adapts anatomy instructions between four-legged and two-legged characters', () => {
    const quadruped = generateAngleTurnaroundPrompt({
      name: 'Deep Crag Matriarch',
      sourceDirection: 'front-right',
      targetDirection: 'front-left',
      referenceType: 'standing',
      targetType: 'standing',
      body: 'four-legged',
    });
    expect(quadruped.prompt).toContain('flank');
    expect(quadruped.prompt).toContain('hooves');

    const biped = generateAngleTurnaroundPrompt({
      name: 'Mara',
      sourceDirection: 'front-right',
      targetDirection: 'front-left',
      referenceType: 'standing',
      targetType: 'standing',
      body: 'two-legged',
    });
    expect(biped.prompt).toContain('shoulder');
    expect(biped.prompt).toContain('toes');
  });

  it('supports cross-media turnarounds (standing reference to walk clip target, and vice versa)', () => {
    const clipFromImage = generateAngleTurnaroundPrompt({
      name: 'Frost Ram',
      sourceDirection: 'front-right',
      targetDirection: 'back-right',
      referenceType: 'standing',
      targetType: 'clip',
      body: 'four-legged',
    });
    expect(clipFromImage.prompt).toContain('single attached standing image');
    expect(clipFromImage.prompt).toContain('walks in place');

    const imageFromClip = generateAngleTurnaroundPrompt({
      name: 'Frost Ram',
      sourceDirection: 'front-right',
      targetDirection: 'back-left',
      referenceType: 'clip',
      targetType: 'standing',
      body: 'four-legged',
    });
    expect(imageFromClip.prompt).toContain('single attached walking animation clip');
    expect(imageFromClip.prompt).toContain('standing in a relaxed pose');
  });
});
