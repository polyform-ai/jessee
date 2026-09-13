import { describe, expect, it } from "vitest";
import { needsCaptureHistoryRecovery } from "../src/captureHistory";
import type { CaptureHistoryItem, RecordingSession } from "../src/types";

describe("capture history recovery", () => {
  it("recovers a completed retained session that predates the library", () => {
    const session: RecordingSession = {
      status: "ready",
      startedAt: 123,
      captureId: "legacy-capture",
      timeline: [],
      screenshots: [{
        id: "shot",
        capturedAtMs: 0,
        url: "https://example.test/",
        title: "Example",
        dataUrl: "artifact:shot",
        annotations: [],
        redactions: []
      }]
    };

    expect(needsCaptureHistoryRecovery(session, [])).toBe(true);
    expect(needsCaptureHistoryRecovery(session, [historyItem(session)])).toBe(false);
  });

  it("does not snapshot a recording that is still active", () => {
    const session: RecordingSession = {
      status: "recording",
      startedAt: 123,
      captureId: "active-capture",
      timeline: [],
      screenshots: []
    };

    expect(needsCaptureHistoryRecovery(session, [])).toBe(false);
  });
});

function historyItem(session: RecordingSession): CaptureHistoryItem {
  return {
    id: session.captureId!,
    title: "Recovered",
    createdAt: session.startedAt!,
    imageCount: session.screenshots.length,
    durationSeconds: 0,
    hasPlan: Boolean(session.captureAnalysis),
    hasPdf: session.status === "ready",
    session
  };
}
