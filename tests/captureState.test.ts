import { describe, expect, it } from "vitest";
import { acceptsContentEvent, shouldRecordPageChange } from "../src/captureState";
import type { RecordingSession } from "../src/types";

const session = (status: RecordingSession["status"], activeTabId = 7): RecordingSession => ({
  status,
  activeTabId,
  timeline: [],
  screenshots: []
});

describe("shouldRecordPageChange", () => {
  it("records URL changes but deduplicates the matching completion event", () => {
    const current = session("recording");
    current.startedAt = Date.now() - 1_000;
    current.timeline = [{ id: "nav", type: "url-change", atMs: 900, url: "https://example.test/next", title: "Next" }];

    expect(shouldRecordPageChange(current, "https://example.test/next", "https://example.test/next", "loading")).toBe(true);
    expect(shouldRecordPageChange(current, "https://example.test/next", undefined, "complete")).toBe(false);
  });

  it("records a completed reload after the dedupe window", () => {
    const current = session("recording");
    current.startedAt = Date.now() - 5_000;
    current.timeline = [{ id: "nav", type: "url-change", atMs: 1_000, url: "https://example.test", title: "Example" }];

    expect(shouldRecordPageChange(current, "https://example.test", undefined, "complete")).toBe(true);
  });
});

describe("acceptsContentEvent", () => {
  it("accepts events only from the tab currently being recorded", () => {
    expect(acceptsContentEvent(session("recording"), 7)).toBe(true);
    expect(acceptsContentEvent(session("recording"), 8)).toBe(false);
    expect(acceptsContentEvent(session("stopped"), 7)).toBe(false);
  });
});
