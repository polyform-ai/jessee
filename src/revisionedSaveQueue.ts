export class RevisionedSaveQueue {
  private changedRevision = 0;
  private savedRevision = 0;
  private running: Promise<void> | undefined;

  get dirty(): boolean {
    return this.savedRevision < this.changedRevision;
  }

  markChanged(): void {
    this.changedRevision += 1;
  }

  flush(save: (revision: number) => Promise<void>): Promise<void> {
    if (this.running) return this.running;
    const work = (async () => {
      while (this.savedRevision < this.changedRevision) {
        const revision = this.changedRevision;
        await save(revision);
        this.savedRevision = revision;
      }
    })();
    const tracked = work.finally(() => {
      if (this.running === tracked) this.running = undefined;
    });
    this.running = tracked;
    return tracked;
  }
}
