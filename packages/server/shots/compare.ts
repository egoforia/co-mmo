// Compares two runs of the shot runner, before (main, or an approved golden
// set) and after (this branch): one before | after | difference picture per
// shot, and report.md listing the shots by how much changed, with what must be
// seen in each and what a machine found. Run by `npm run shots -- --compare`.
//
//   tsx packages/server/shots/compare.ts --before <dir> --after <dir> --out <dir>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compare, type Difference } from './pictures.ts';

/** Below this share of changed pixels a shot reads as the same: moving creatures, water and rain make some. */
const NOISE = 0.003;
/** Above this a shot has clearly changed. */
const CLEAR = 0.02;

interface Run {
  shots: { name: string; about: string; file: string; mustSee: string[]; problems: string[] }[];
}

const read = (dir: string): Run => {
  const file = resolve(dir, 'shots.json');
  if (!existsSync(file)) throw new Error(`There are no shots in ${dir} (no shots.json). Take them first with npm run shots.`);
  return JSON.parse(readFileSync(file, 'utf8')) as Run;
};

/** What the size of a change means, in words. */
function verdict(d: Difference): string {
  if (d.resized) return 'changed size';
  if (d.changed >= CLEAR) return 'changed';
  if (d.changed >= NOISE) return 'small change';
  return 'same';
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' } } });
  if (!values.before || !values.after || !values.out) throw new Error('Give --before, --after and --out folders.');
  const before = read(values.before), after = read(values.after);
  mkdirSync(values.out, { recursive: true });
  const was = new Map(before.shots.map((s) => [s.name, s]));
  const now = new Map(after.shots.map((s) => [s.name, s]));

  const rows: { name: string; about: string; verdict: string; changed: number; box?: Difference['box']; picture: string; mustSee: string[]; problems: string[] }[] = [];
  for (const shot of after.shots) {
    const old = was.get(shot.name);
    if (!old) continue;
    const picture = `${shot.name}.png`;
    const d = await compare(resolve(values.before, old.file), resolve(values.after, shot.file), resolve(values.out, picture));
    rows.push({ name: shot.name, about: shot.about, verdict: verdict(d), changed: d.changed, ...(d.box ? { box: d.box } : {}), picture, mustSee: shot.mustSee, problems: shot.problems });
  }
  rows.sort((a, b) => b.changed - a.changed);
  const added = after.shots.filter((s) => !was.has(s.name)).map((s) => s.name);
  const gone = before.shots.filter((s) => !now.has(s.name)).map((s) => s.name);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    '# Shot comparison',
    '',
    `Before: \`${values.before}\`  `,
    `After: \`${values.after}\``,
    '',
    `Below ${pct(NOISE)} changed counts as the same (moving creatures, water and weather make some change); ${pct(CLEAR)} or more is a clear change. Every "changed" shot must be explained in the pull request.`,
    '',
    '| Shot | Verdict | Changed | Where | Machine findings |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| [${r.name}](${r.picture}) | ${r.verdict} | ${pct(r.changed)} | ${r.box ? `${r.box.x},${r.box.y} ${r.box.width}x${r.box.height}` : ''} | ${r.problems.length ? r.problems.join('; ') : 'none'} |`),
    '',
    ...(added.length ? [`New shots (nothing to compare with): ${added.join(', ')}`, ''] : []),
    ...(gone.length ? [`Shots no longer taken: ${gone.join(', ')}`, ''] : []),
    '## What must be seen',
    '',
    ...rows.filter((r) => r.verdict !== 'same').flatMap((r) => [`### ${r.name} (${r.verdict})`, '', r.about, '', ...r.mustSee.map((m) => `- [ ] ${m}`), '']),
  ];
  writeFileSync(resolve(values.out, 'report.md'), lines.join('\n'));
  writeFileSync(resolve(values.out, 'report.json'), JSON.stringify({ rows, added, gone }, null, 2));
  for (const r of rows) console.log(`${r.verdict.padEnd(13)} ${pct(r.changed).padStart(6)}  ${r.name}`);
  console.log(`\nReport: ${resolve(values.out, 'report.md')}`);
}

await main();
