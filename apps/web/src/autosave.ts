export type SaveStatus = 'saving' | 'saved' | 'failed';

/** Serial writes; failures remain dirty until a successful retry. */
export class Autosave {
  private pending: { read: () => string } | undefined;
  private active: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string | undefined;
  constructor(
    private write: (scene: string) => Promise<void>,
    private notify: (status: SaveStatus, error?: unknown) => void,
    private delay = 500,
  ) {}
  get dirty() { return this.pending !== undefined || this.active !== undefined; }
  seed(scene: string) { this.last = scene; }
  enqueue(scene: string) {
    if (scene === this.last && !this.dirty) return;
    this.enqueueLazy(() => scene);
  }
  /** Read the latest scene at flush time, rather than serializing every pointer event. */
  enqueueLazy(read: () => string) {
    this.pending = { read };
    this.notify('saving');
    // Keep the first deadline: continuous drawing must not postpone saving forever.
    if (this.timer === undefined && !this.active) {
      this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.delay);
    }
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) return this.active;
    this.active = this.drain();
    try { await this.active; } finally { this.active = undefined; }
  }
  private async drain() {
    while (this.pending !== undefined) {
      const pending = this.pending;
      this.notify('saving');
      try {
        const scene = pending.read();
        if (scene !== this.last) { await this.write(scene); this.last = scene; }
      }
      catch (error) { this.notify('failed', error); throw error; }
      if (this.pending === pending) this.pending = undefined;
    }
    this.notify('saved');
  }
  dispose() { clearTimeout(this.timer); this.timer = undefined; }
}
