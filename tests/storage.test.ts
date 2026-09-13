import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureHistoryItem, Settings } from "../src/types";

vi.mock("../src/artifacts", () => ({ deleteSessionArtifacts: vi.fn().mockResolvedValue(undefined) }));

import { pruneCaptureHistory, saveSettings, upsertCaptureHistory } from "../src/storage";

describe("settings mutations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes profile and history writes so neither can overwrite the other", async () => {
    let stored: Settings = { uniqueId: "person", retentionDays: 30, captureHistory: [] };
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async () => ({ settings: structuredClone(stored) })),
          set: vi.fn().mockImplementation(async ({ settings }) => {
            await Promise.resolve();
            stored = structuredClone(settings);
          })
        }
      }
    });

    await Promise.all([
      upsertCaptureHistory(historyItem("capture", Date.now())),
      saveSettings({ retentionDays: 14 })
    ]);

    expect(stored.retentionDays).toBe(14);
    expect(stored.captureHistory?.map((item) => item.id)).toEqual(["capture"]);
  });

  it("keeps a protected editor autosave while pruning expired history", async () => {
    const now = Date.now();
    let stored: Settings = {
      uniqueId: "person",
      retentionDays: 30,
      captureHistory: [historyItem("open-editor", now - 3 * 86_400_000), historyItem("expired", now - 3 * 86_400_000)]
    };
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn().mockImplementation(async () => ({ settings: structuredClone(stored) })),
          set: vi.fn().mockImplementation(async ({ settings }) => { stored = structuredClone(settings); })
        }
      }
    });

    await Promise.all([
      upsertCaptureHistory({ ...historyItem("open-editor", now - 3 * 86_400_000), title: "Newest edit" }),
      pruneCaptureHistory(1, "open-editor")
    ]);

    expect(stored.captureHistory).toHaveLength(1);
    expect(stored.captureHistory?.[0]).toMatchObject({ id: "open-editor", title: "Newest edit" });
  });
});

function historyItem(id: string, createdAt: number): CaptureHistoryItem {
  return {
    id,
    title: id,
    createdAt,
    imageCount: 0,
    durationSeconds: 0,
    hasPlan: false,
    hasPdf: false,
    session: { status: "stopped", startedAt: createdAt, timeline: [], screenshots: [] }
  };
}
