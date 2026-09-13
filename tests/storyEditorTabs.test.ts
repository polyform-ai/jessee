import { afterEach, describe, expect, it, vi } from "vitest";
import { getCaptureRetentionProtection } from "../src/storage";
import { sessionIsInUse } from "../src/storyEditorTabs";
import type { RecordingSession } from "../src/types";

describe("sessionIsInUse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("protects active captures and terminal sessions only while their editor is open", async () => {
    const query = vi.fn().mockResolvedValue([]);
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://jessee/${path}` },
      tabs: { query }
    });
    const session = (status: RecordingSession["status"]): RecordingSession => ({ status, timeline: [], screenshots: [] });

    expect(await sessionIsInUse({ ...session("stopped"), autoPlanningPending: true })).toBe(true);
    expect(await sessionIsInUse({ ...session("stopped"), autoPlanningPending: false, analysisError: "Retry planning" })).toBe(false);
    expect(await sessionIsInUse(session("ready"))).toBe(false);

    query.mockResolvedValue([{ id: 7, url: "chrome-extension://jessee/plan.html" }]);
    expect(await sessionIsInUse(session("ready"))).toBe(true);
  });

  it("resets an inactive expired session instead of protecting its retained artifacts", async () => {
    let storedSession: RecordingSession = {
      status: "ready",
      captureId: "expired-capture",
      startedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      stoppedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      exportFolderName: "expired-folder",
      timeline: [],
      screenshots: []
    };
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://jessee/${path}` },
      tabs: { query: vi.fn().mockResolvedValue([]) },
      storage: {
        local: {
          get: vi.fn().mockImplementation(async () => ({ recordingSession: storedSession })),
          set: vi.fn().mockImplementation(async ({ recordingSession }) => { storedSession = recordingSession; })
        }
      }
    });

    expect(await getCaptureRetentionProtection(1)).toEqual({});
    expect(storedSession.status).toBe("idle");
    expect(storedSession.captureId).toBeUndefined();
  });
});
