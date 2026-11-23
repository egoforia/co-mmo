// What went wrong while a wish was being built, kept across tries so the
// Owner can read it on the Wishes page even after pressing Try again.

/** One thing that went wrong while a wish was built: a failed run, failed checks, or GitHub refusing the issue. */
export interface BuildProblem {
  /** When the game heard about it. */
  at: number;
  /** In the words the workflow or GitHub used. */
  message: string;
  /** The issue of the try it happened on. */
  issue?: { number: number; url: string };
  /** The GitHub Actions run to read for the details. */
  run?: string;
}

/** How many problems a wish keeps; older ones are dropped. */
export const MAX_BUILD_PROBLEMS = 5;

/**
 * The problems with one more added last. The same message on the same try is
 * kept once, because a failed build is read again on every sync.
 */
export function withProblem(problems: BuildProblem[] | undefined, problem: BuildProblem): BuildProblem[] {
  const list = problems ?? [];
  const last = list[list.length - 1];
  if (last && last.message === problem.message && last.issue?.number === problem.issue?.number) return list;
  return [...list, problem].slice(-MAX_BUILD_PROBLEMS);
}
