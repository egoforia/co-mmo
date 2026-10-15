import { describe, expect, it } from 'vitest';
import { BODY_TYPES, WALK_STEPS, WALK_VIEWS, poseAt, project } from '../src/walk-rig.ts';

describe('walk rig', () => {
  it('gives every body type 8 steps, a bob per step and a track per limb', () => {
    for (const body of Object.values(BODY_TYPES)) {
      expect(body.steps).toHaveLength(WALK_STEPS);
      expect(body.bob).toHaveLength(WALK_STEPS);
      for (const limb of body.limbs) {
        expect(limb.swing).toHaveLength(WALK_STEPS);
        expect(limb.bend).toHaveLength(WALK_STEPS);
      }
    }
  });

  it('puts the left foot forward on the first step and the right foot forward half a cycle later', () => {
    const foot = (step: number, id: string) => poseAt(BODY_TYPES['two-legged']!, step).limbs.find((l) => l.id === id)!.joints[2][2];
    expect(foot(0, 'left-leg')).toBeGreaterThan(foot(0, 'right-leg'));
    expect(foot(4, 'right-leg')).toBeGreaterThan(foot(4, 'left-leg'));
  });

  it('makes every step a different pose', () => {
    for (const body of Object.values(BODY_TYPES)) {
      const poses = Array.from({ length: WALK_STEPS }, (_, i) => JSON.stringify(poseAt(body, i)));
      expect(new Set(poses).size).toBe(WALK_STEPS);
    }
  });

  it('shows the near side in each side view and the face only from the front', () => {
    const left: [number, number, number] = [3, 10, 0];
    expect(project(left, 'right').depth).toBeGreaterThan(0);
    expect(project(left, 'left').depth).toBeLessThan(0);
    const ahead: [number, number, number] = [0, 10, 5];
    expect(project(ahead, 'front').depth).toBeGreaterThan(0);
    expect(project(ahead, 'back').depth).toBeLessThan(0);
    expect(project(ahead, 'right').x).toBeGreaterThan(0);
    expect(project(ahead, 'left').x).toBeLessThan(0);
    expect(WALK_VIEWS).toEqual(['front', 'right', 'back', 'left']);
  });
});
