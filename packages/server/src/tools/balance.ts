import { appendFileSync } from 'node:fs';
import { balanceProblems, balanceReport, balanceTable, levelTimes } from '../balance.ts';

// npm run balance: fights every Calling at levels 1, 10 and 20 alone, in a
// crowd, in a pair and against a training post, on tiles, and prints the
// results as Markdown (docs/balance.md keeps the latest). With --check it
// also says whether the balance pass still holds (balanceProblems) and fails
// when it does not; the balance workflow runs it that way on pull requests
// and puts the tables in the run's summary.

const results = balanceTable();
const problems = balanceProblems(results);
const verdict = problems.length
  ? ['## Balance is off', '', ...problems.map((p) => `- ${p}`), '']
  : ['## Balance holds', '', 'The damage Callings are within 15% of each other, and crowds are still deadly.', ''];
const report = [...(process.argv.includes('--check') ? verdict : []), balanceReport(results), levelTimes(results)].join('\n');
console.log(report);
if (process.argv.includes('--check')) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (problems.length) process.exitCode = 1;
}
