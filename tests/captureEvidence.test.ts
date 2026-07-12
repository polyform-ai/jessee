import { describe, expect, it } from "vitest";
import { visiblePageRects } from "../src/captureEvidence";
import type { TimelineEvent } from "../src/types";

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
