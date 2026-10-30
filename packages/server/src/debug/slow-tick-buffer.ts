import type { SlowTickRecord } from '@co-mmo/shared';

/** Default maximum number of slow tick records kept in memory. */
export const DEFAULT_SLOW_TICK_CAPACITY = 20;

/**
 * A fixed-capacity ring buffer of recent slow-tick records.
 * Evicts the oldest records once capacity is reached.
 */
export class SlowTickBuffer {
  private readonly buffer: (SlowTickRecord | undefined)[];
  private nextId = 1;
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number = DEFAULT_SLOW_TICK_CAPACITY) {
    this.buffer = new Array(capacity);
  }

  /**
   * Records a slow tick. If an id is not provided, assigns a monotonically
   * increasing integer id.
   */
  record(entry: Omit<SlowTickRecord, 'id'> | SlowTickRecord): SlowTickRecord {
    const item: SlowTickRecord = 'id' in entry && typeof entry.id === 'number'
      ? entry
      : { ...entry, id: this.nextId++ };

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    return item;
  }

  /** Alias for record() when pushing an existing SlowTickRecord. */
  push(record: SlowTickRecord): SlowTickRecord {
    return this.record(record);
  }

  /** Returns all stored slow-tick records, newest first. */
  list(): SlowTickRecord[] {
    const result: SlowTickRecord[] = [];
    if (this.count === 0) return result;

    // Traverse backwards from the most recently inserted item
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const item = this.buffer[idx];
      if (item) result.push(item);
    }
    return result;
  }

  /** How many slow tick records are currently stored. */
  get size(): number {
    return this.count;
  }

  /** Clears all stored slow-tick records. */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
