import { describe, expect, it } from "vitest";
import { clearAnnotationEvidence, visiblePageRects } from "../src/captureEvidence";
import type { RecordingSession, ScreenshotEvidence, TimelineEvent } from "../src/types";

const event = (type: TimelineEvent["type"], atMs: number, rect?: TimelineEvent["rect"]): TimelineEvent => ({
  id: `${type}-${atMs}`,
  type,
  atMs,
  url: "https://example.test",
  title: "Example",
  rect
});

describe("visiblePageRects", () => {
  it("does not carry annotations across a navigation", () => {
    const pageA = { x: 10, y: 10, width: 20, height: 20 };
    const pageB = { x: 30, y: 30, width: 40, height: 40 };
    const timeline = [event("annotation", 100, pageA), event("url-change", 200), event("annotation", 300, pageB)];

    expect(visiblePageRects(timeline, "annotation")).toEqual([pageB]);
  });
});

describe("clearAnnotationEvidence", () => {
  it("removes marked screenshots and every annotation event", () => {
    const plain = screenshot("plain", [], []);
    const highlighted = screenshot("highlighted", [{ x: 1, y: 2, width: 3, height: 4 }], []);
    const redacted = screenshot("redacted", [], [{ x: 5, y: 6, width: 7, height: 8 }]);
    const session: RecordingSession = {
      status: "recording",
      timeline: [
        event("annotation", 100, highlighted.annotations[0]),
        { ...event("screenshot", 110), screenshotId: highlighted.id },
        event("redaction", 200, redacted.redactions[0]),
        { ...event("screenshot", 210), screenshotId: redacted.id },
        { ...event("screenshot", 300), screenshotId: plain.id }
      ],
      screenshots: [plain, highlighted, redacted]
    };

    const cleared = clearAnnotationEvidence(session);

    expect(cleared.session.screenshots).toEqual([plain]);
    expect(cleared.session.timeline).toEqual([{ ...event("screenshot", 300), screenshotId: plain.id }]);
    expect(cleared.removedArtifactRefs).toEqual([highlighted.dataUrl, redacted.dataUrl]);
  });
});

function screenshot(id: string, annotations: ScreenshotEvidence["annotations"], redactions: ScreenshotEvidence["redactions"]): ScreenshotEvidence {
  return {
    id,
    capturedAtMs: 0,
    url: "https://example.test",
    title: "Example",
    dataUrl: `idb:${id}`,
    annotations,
    redactions
  };
}
