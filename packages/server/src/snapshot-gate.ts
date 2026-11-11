import type { ServerMessage } from '@co-mmo/shared';

// Keeps a slow connection from falling further and further behind (docs/scale.md,
// Smooth play on any connection). Every snapshot carries everything in view, so
// one that would only wait in a queue behind older ones can be skipped: the
// next one says it all again.

/** Behind by more than this, ms, past the connection's own usual delay, snapshots are skipped. */
const BEHIND_MS = 300;
/** While skipping, one snapshot still goes this often, ms, so the player keeps seeing the world and we keep timing the line. */
const KEEP_EVERY_MS = 500;
/** More than this waiting in the socket's own buffer, bytes, and snapshots are skipped too. */
const MAX_BUFFERED = 64 * 1024;
/** How far the usual-delay estimate moves toward a slower report, per report (it drops at once to a quicker one). */
const DRIFT = 0.02;
/** Send times kept, to time the browser's reports by. */
const KEPT = 200;

/**
 * One player's connection: when each snapshot left, what the browser says it
 * has seen (SeenMessage), and from that whether the line has fallen behind.
 */
export class SnapshotGate {
  private readonly sentAt = new Map<number, number>();
  /** The quickest a snapshot has lately taken there and a report back, ms. */
  private usual?: number;
  private behind = 0;
  private lastSent = 0;
  private skippedSince = 0;
  /** Snapshots skipped in all, for the network bench and tests. */
  skipped = 0;

  /**
   * Whether a message should go now; a snapshot may be held back. A
   * snapshot that goes after some were skipped says how many.
   */
  pass(message: ServerMessage, now: number, buffered: number): ServerMessage | undefined {
    if (message.t === 'welcome') {
      // A new region counts its ticks afresh.
      this.sentAt.clear();
      this.behind = 0;
      return message;
    }
    if (message.t !== 'snapshot') return message;
    const skipped = this.allow(message.tick, now, buffered);
    if (skipped === undefined) return undefined;
    return skipped ? { ...message, skipped } : message;
  }

  /**
   * A snapshot already written as text (from a region server): the text to
   * send, with how many were skipped before it added, or undefined to hold it back.
   */
  passText(text: string, tick: number, now: number, buffered: number): string | undefined {
    const skipped = this.allow(tick, now, buffered);
    if (skipped === undefined) return undefined;
    // The text is a JSON object: one more field goes before its closing brace.
    return skipped ? `${text.slice(0, text.lastIndexOf('}'))},"skipped":${skipped}}` : text;
  }

  /** Whether the snapshot of `tick` goes now: how many were skipped before it, or undefined to skip it too. */
  private allow(tick: number, now: number, buffered: number): number | undefined {
    const late = this.behind > BEHIND_MS || buffered > MAX_BUFFERED;
    if (late && now - this.lastSent < KEEP_EVERY_MS) {
      this.skipped++;
      this.skippedSince++;
      return undefined;
    }
    this.sentAt.set(tick, now);
    if (this.sentAt.size > KEPT) this.sentAt.delete(this.sentAt.keys().next().value!);
    this.lastSent = now;
    const skipped = this.skippedSince;
    this.skippedSince = 0;
    return skipped;
  }

  /** The browser has seen the snapshot of `tick` (SeenMessage) by `now`. */
  seen(tick: number, now: number): void {
    const at = this.sentAt.get(tick);
    if (at === undefined) return;
    const took = now - at;
    if (this.usual === undefined || took < this.usual) this.usual = took;
    else this.usual += (took - this.usual) * DRIFT;
    this.behind = took - this.usual;
  }
}
