import { randomBytes } from 'node:crypto';
import type { PlayerInfo } from '@co-mmo/shared';
import type { Report, Store } from './store.ts';
import type { World } from './world.ts';

/** Reports a player may send in ten minutes. */
const REPORTS_PER_WINDOW = 5;
const WINDOW_MS = 10 * 60_000;
const MAX_REASON = 300;

/**
 * Player reports (design doc, Fairness and safety: "Players can report any
 * creation"). Any player can report a wished thing or another player; the
 * Stewards see reports in God's View and roll back, suspend or dismiss.
 */
export class Reports {
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly store: Store, private readonly world: World, private readonly now: () => number = Date.now) {}

  /** Files a report and returns what the God says back to the reporter. */
  file(reporter: PlayerInfo, kind: 'content' | 'player', target: string, rawReason: string): string {
    const reason = rawReason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);
    if (!reason) return 'Tell me what is wrong, so the Stewards can understand.';
    const now = this.now();
    const times = (this.recent.get(reporter.id) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= REPORTS_PER_WINDOW) return 'The Stewards have your earlier reports. Give them a little time.';

    let subject: { id: string; name: string } | undefined;
    if (kind === 'content') {
      const record = this.store.contentById(target);
      if (record) subject = { id: record.id, name: `${record.title} (wished by ${record.wisher.name})` };
    } else {
      const account = this.store.accountByName(target);
      if (account) subject = { id: account.id, name: account.name };
    }
    if (!subject) return kind === 'player' ? `I know no one called ${target.slice(0, 40)}.` : 'I cannot find that creation.';
    if (kind === 'player' && subject.id === reporter.id) return 'You cannot report yourself.';
    if (this.store.reports.some((r) => r.status === 'open' && r.reporter.id === reporter.id && r.target.id === subject.id)) {
      return 'You have reported this already; the Stewards will look.';
    }
    times.push(now);
    this.recent.set(reporter.id, times);
    const report: Report = {
      id: `r${now.toString(36)}${randomBytes(2).toString('hex')}`,
      at: now,
      reporter: { id: reporter.id, name: reporter.name },
      kind,
      target: subject,
      reason,
      status: 'open',
    };
    this.store.addReport(report);
    for (const account of this.store.accounts) {
      if (account.role !== 'player' && account.id !== reporter.id && this.world.has(account.id)) {
        this.world.sendTo(account.id, { t: 'notice', text: `✦ ${reporter.name} reported ${subject.name}. See Reports in God's View.` });
      }
    }
    return 'Your report has reached the Stewards. Thank you for looking after this world.';
  }

  open(): Report[] {
    return this.store.reports.filter((r) => r.status === 'open');
  }

  close(id: string, by: string, status: 'resolved' | 'dismissed', action: string): Report | undefined {
    const report = this.store.reports.find((r) => r.id === id);
    if (!report || report.status !== 'open') return undefined;
    const closed = this.store.updateReport(id, { status, closed: { by, at: this.now(), action } });
    if (closed && this.world.has(report.reporter.id)) {
      this.world.sendTo(report.reporter.id, {
        t: 'god',
        say: status === 'resolved'
          ? `The Stewards acted on your report about ${report.target.name}: ${action}.`
          : `The Stewards looked at your report about ${report.target.name} and left things as they are.`,
      });
    }
    return closed;
  }
}
