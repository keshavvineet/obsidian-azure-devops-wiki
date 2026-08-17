/**
 * Serializes file mutations so that concurrent vault events can never interleave two
 * read-modify-write cycles on the same .order file (ARCHITECTURE §6).
 */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Keep the chain alive even when a task rejects; callers still see their own rejection.
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once everything queued so far has settled. */
  async idle(): Promise<void> {
    await this.tail;
  }
}
