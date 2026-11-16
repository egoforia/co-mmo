import { balanceReport, balanceTable } from '../balance.ts';

// npm run balance: fights every Calling at levels 1, 10 and 20 alone, in a
// crowd and in a pair, on tiles, and prints the results as Markdown
// (docs/balance.md keeps the latest).

console.log(balanceReport(balanceTable()));
