import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { hydrateSession } from "../src/artifacts";
import type { RecordingSession } from "../src/types";

describe("hydrateSession", () => {
  it("does not leave unresolved artifact refs in media fields", async () => {
    const session: RecordingSession = {
      status: "stopped",
      timeline: [],
      screenshots: [
        {
          id: "shot-1",
          capturedAtMs: 0,
          url: "https://example.test",
          title: "Example",
          dataUrl: "idb:missing-shot",
          annotations: [],
          redactions: []
        }
      ],
      videoDataUrl: "idb:missing-video",
      audioDataUrl: "idb:missing-audio"
    };

    const hydrated = await hydrateSession(session);

    expect(hydrated.videoDataUrl).toBeUndefined();
    expect(hydrated.audioDataUrl).toBeUndefined();
    expect(hydrated.screenshots[0].dataUrl).toBe("");
  });
});
