import { describe, expect, it } from 'vitest';
import { wishProgress } from '../src/content.ts';

const major = { status: 'pending', tier: 'major' } as const;

describe('wishProgress', () => {
  it('shows the God drafting as in progress', () => {
    expect(wishProgress({ ...major, draft: { state: 'drafting' } }).state).toBe('in-progress');
  });

  it('shows a failed draft or test run as an error with the reason', () => {
    const failed = wishProgress({ ...major, draft: { state: 'failed', message: 'Model timed out.' } });
    expect(failed).toMatchObject({ state: 'error', label: 'Drafting failed' });
    expect(failed.detail).toContain('Model timed out.');
    const test = wishProgress({ ...major, draft: { state: 'ready' }, test: { passed: false, errors: ['ReferenceError: x'], summary: [] } });
    expect(test).toMatchObject({ state: 'error', label: 'Test run failed' });
    expect(test.detail).toContain('ReferenceError: x');
  });

  it('shows wishes waiting for a person as needing input', () => {
    expect(wishProgress({ ...major, draft: { state: 'ready' }, test: { passed: true, errors: [], summary: [] } })).toMatchObject({ state: 'needs-input', label: 'Ready, waiting for a Steward' });
    expect(wishProgress({ status: 'pending', tier: 'engine' }).label).toBe('Waiting for the Owner');
    expect(wishProgress({ status: 'approved', tier: 'engine' }).state).toBe('needs-input');
  });

  it('shows granted wishes as done unless their rule paused', () => {
    expect(wishProgress({ status: 'granted', tier: 'minor' })).toMatchObject({ state: 'done', label: 'Done' });
    expect(wishProgress({ status: 'granted', tier: 'major', rule: { paused: true, reason: '5 errors in a minute; the last: boom' } }).state).toBe('error');
    expect(wishProgress({ status: 'granted', tier: 'major', rule: { paused: true, reason: 'Paused by egoforia.' } }).state).toBe('needs-input');
  });

  it('closes rejected and undone wishes', () => {
    expect(wishProgress({ status: 'rejected', tier: 'major' }).state).toBe('closed');
    expect(wishProgress({ status: 'rolled-back', tier: 'minor' }).label).toBe('Undone');
  });
});
