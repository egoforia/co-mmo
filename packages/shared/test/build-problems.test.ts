import { describe, expect, it } from 'vitest';
import { MAX_BUILD_PROBLEMS, withProblem } from '../src/build-problems.ts';

describe('build problems', () => {
  const issue = (number: number) => ({ number, url: `https://github.com/egoforia/co-mmo/issues/${number}` });

  it('keeps the same problem on the same try once', () => {
    const one = withProblem(undefined, { at: 1, message: 'Invalid API key', issue: issue(1) });
    expect(withProblem(one, { at: 2, message: 'Invalid API key', issue: issue(1) })).toBe(one);
    expect(withProblem(one, { at: 3, message: 'Invalid API key', issue: issue(2) })).toHaveLength(2);
  });

  it('keeps only the newest few', () => {
    let list = withProblem(undefined, { at: 0, message: 'p0' });
    for (let i = 1; i < MAX_BUILD_PROBLEMS + 3; i++) list = withProblem(list, { at: i, message: `p${i}` });
    expect(list).toHaveLength(MAX_BUILD_PROBLEMS);
    expect(list[list.length - 1]!.message).toBe(`p${MAX_BUILD_PROBLEMS + 2}`);
  });
});
