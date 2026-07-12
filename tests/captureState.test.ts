import { describe, expect, it } from "vitest";
import { acceptsContentEvent } from "../src/captureState";
import type { RecordingSession } from "../src/types";

const session = (status: RecordingSession["status"], activeTabId = 7): RecordingSession => ({
  status,
  activeTabId,
  timeline: [],
  screenshots: []
});

describe("acceptsContentEvent", () => {
  it("accepts events only from the tab currently being recorded", () => {
    expect(acceptsContentEvent(session("recording"), 7)).toBe(true);
    expect(acceptsContentEvent(session("recording"), 8)).toBe(false);
    expect(acceptsContentEvent(session("stopped"), 7)).toBe(false);
  });
});
