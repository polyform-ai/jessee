import { describe, expect, it } from "vitest";
import { RevisionedSaveQueue } from "../src/revisionedSaveQueue";

describe("RevisionedSaveQueue", () => {
  it("persists an edit made while an older revision is still saving", async () => {
    const queue = new RevisionedSaveQueue();
    let releaseFirstSave: () => void = () => undefined;
    const firstSaveBlocked = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    const saved: number[] = [];

    queue.markChanged();
    const flushing = queue.flush(async (revision) => {
      saved.push(revision);
      if (revision === 1) await firstSaveBlocked;
    });
    queue.markChanged();
    expect(queue.dirty).toBe(true);
    releaseFirstSave();
    await flushing;

    expect(saved).toEqual([1, 2]);
    expect(queue.dirty).toBe(false);
  });

  it("shares one flush while a save is already running", async () => {
    const queue = new RevisionedSaveQueue();
    queue.markChanged();
    const save = async () => Promise.resolve();

    const first = queue.flush(save);
    const second = queue.flush(save);

    expect(second).toBe(first);
    await first;
  });
});
