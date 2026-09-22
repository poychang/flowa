export type SaveStatus = 'saving' | 'saved' | 'failed';

/** Serial writes; failures remain dirty until a successful retry. */
export class Autosave {
  private pending: string | undefined;
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
    if (scene === this.last) return;
    this.last = scene;
    this.pending = scene;
    this.notify('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.delay);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.active) return this.active;
    this.active = this.drain();
    try { await this.active; } finally { this.active = undefined; }
  }
  private async drain() {
    while (this.pending !== undefined) {
      const scene = this.pending;
      this.notify('saving');
      try { await this.write(scene); }
      catch (error) { this.notify('failed', error); throw error; }
      if (this.pending === scene) this.pending = undefined;
    }
    this.notify('saved');
  }
  dispose() { clearTimeout(this.timer); }
}
