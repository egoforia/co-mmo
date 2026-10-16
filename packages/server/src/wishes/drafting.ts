import type { AiServices } from '../ai/services.ts';
import type { Budget } from '../budget.ts';
import { compileRule } from '../compiler.ts';
import { testRule } from '../rule-test.ts';
import type { ContentRecord, Store } from '../store.ts';
import type { WishNews } from './news.ts';

/**
 * The God's compiler drafting scripted rules for Major wishes, each draft
 * tried in the sandbox before a Steward sees it (design doc, How wishes
 * become mechanics).
 */
export class RuleDrafts {
  /** Major wishes whose rule is being drafted. */
  private readonly drafting = new Set<string>();
  /** Drafts in flight, so tests and shutdown can wait for them. */
  readonly drafts = new Set<Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly ai: AiServices,
    private readonly budget: Budget,
    private readonly news: WishNews,
    private readonly now: () => number,
  ) {}

  /** True while a wish's rule is being drafted. */
  busy(id: string): boolean {
    return this.drafting.has(id);
  }

  /**
   * Asks the God's compiler to draft a scripted rule for a Major wish, runs
   * it through the automated test, and tries once more with the problems if
   * the test fails. A Steward's note asks for a revision.
   */
  draft(id: string, note?: string): Promise<ContentRecord | undefined> {
    const record = this.store.contentById(id);
    if (!record || record.status !== 'pending' || record.tier !== 'major' || this.drafting.has(id)) return Promise.resolve(undefined);
    this.drafting.add(id);
    const job = this.runDraft(record, note?.trim().slice(0, 500) || undefined).finally(() => {
      this.drafting.delete(id);
      this.drafts.delete(job);
    });
    this.drafts.add(job);
    return job;
  }

  private async runDraft(record: ContentRecord, note: string | undefined): Promise<ContentRecord | undefined> {
    const id = record.id;
    this.store.updateContent(id, { draft: { state: 'drafting', at: this.now(), ...(note ? { note } : {}) } });
    this.news.changed(id);
    let previous = record.definition?.kind === 'rule' ? record.definition : undefined;
    let problems = record.test && !record.test.passed ? [...record.test.errors, ...record.test.summary] : undefined;
    let usd = 0;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await compileRule(
          this.ai.compilerModels(),
          { title: record.title, summary: record.summary, conversation: record.conversation, ...(record.shaped?.brief ? { brief: record.shaped.brief } : {}), ...(note || previous ? { revise: { note: note ?? '', previous, problems } } : {}) },
          (r, model) => {
            usd += r.usd;
            this.budget.spend('chat', model, r.usd, record.wisher.id);
          },
        );
        if (!result.ok) {
          this.store.updateContent(id, {
            usd: record.usd + usd,
            draft: { state: result.impossible ? 'impossible' : 'failed', at: this.now(), message: result.reason, ...(result.model ? { model: `${result.model.provider}/${result.model.model}` } : {}), ...(note ? { note } : {}) },
          });
          this.news.notifyStewards(`The God could not draft a rule for "${record.title}": ${result.reason}`);
          this.news.tellWisher(record, `The God could not finish your wish "${record.title}" yet. The Stewards will decide what happens next.`);
          this.news.changed(id);
          return this.store.contentById(id);
        }
        const test = await testRule(id, result.definition, this.now());
        // Only the latest draft counts; a review may have happened meanwhile.
        if (this.store.contentById(id)?.status !== 'pending') return undefined;
        this.store.updateContent(id, {
          definition: result.definition,
          test,
          usd: record.usd + usd,
          draft: { state: 'ready', at: this.now(), model: `${result.model.provider}/${result.model.model}`, ...(note ? { note } : {}) },
        });
        if (test.passed) break;
        previous = result.definition;
        problems = [...test.errors, ...test.summary];
        note = note ?? 'The automated test run did not pass; fix the problems.';
      }
      const done = this.store.contentById(id)!;
      this.news.changed(id);
      if (!done.test?.passed) this.news.tellWisher(done, `The God's first try at your wish "${record.title}" did not pass its test run. The Stewards can ask for another.`);
      this.news.notifyStewards(done.test?.passed
        ? `A scripted rule waits for your review: "${record.title}". Open God's View.`
        : `The God's rule for "${record.title}" did not pass its test run. Open God's View to revise or reject it.`);
      return done;
    } catch (err) {
      console.error(`Drafting ${id} failed:`, err);
      this.store.updateContent(id, { draft: { state: 'failed', at: this.now(), message: (err as Error).message } });
      this.news.changed(id);
      return this.store.contentById(id);
    }
  }
}
