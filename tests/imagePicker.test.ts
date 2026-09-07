import { describe, expect, it } from "vitest";
import { rankScreenshotsForStep, screenshotTimingLabel } from "../src/imagePicker";
import type { CaptureStoryStep, ScreenshotEvidence } from "../src/types";

const step: CaptureStoryStep = {
  startSeconds: 8,
  endSeconds: 10,
  title: "Save the form",
  narrative: "The completed form is visible.",
  transcript: "Save the form.",
  pageUrl: "https://example.test/form",
  kind: "action"
};

function shot(id: string, capturedAtMs: number, url = "https://example.test/form", marked = false): ScreenshotEvidence {
  return {
    id,
    capturedAtMs,
    url,
    title: id,
    dataUrl: "data:image/png;base64,image",
    annotations: marked ? [{ x: 1, y: 1, width: 10, height: 10 }] : [],
    redactions: []
  };
}

describe("rankScreenshotsForStep", () => {
  it("prefers the resulting state on the same page", () => {
    const ranked = rankScreenshotsForStep(step, [
      shot("old", 5_000),
      shot("before", 9_600),
      shot("after", 10_300),
      shot("other-page", 10_100, "https://example.test/other")
    ]);

    expect(ranked[0].shot.id).toBe("after");
    expect(ranked[0].reason).toContain("Resulting state");
    expect(ranked[0].reason).toContain("Same page");
  });

  it("keeps the currently selected image in a short list", () => {
    const selectedStep = { ...step, screenshotId: "selected" };
    const ranked = rankScreenshotsForStep(selectedStep, [
      shot("one", 10_000),
      shot("two", 10_100),
      shot("three", 10_200),
      shot("selected", 50_000)
    ], 3);

    expect(ranked).toHaveLength(3);
    expect(ranked.some((candidate) => candidate.shot.id === "selected")).toBe(true);
  });

  it("explains image timing relative to the story step", () => {
    expect(screenshotTimingLabel(shot("same", 10_100), step)).toBe("At this moment");
    expect(screenshotTimingLabel(shot("after", 11_200), step)).toBe("1s after");
    expect(screenshotTimingLabel(shot("before", 8_000), step)).toBe("2s before");
  });
});
