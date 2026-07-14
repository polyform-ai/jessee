import { describe, expect, it } from "vitest";
import { FRESH_CAPTURE_AFTER_MS, shouldStartWithFreshCapture } from "../src/captureHome";
import type { RecordingSession } from "../src/types";

const session = (overrides: Partial<RecordingSession>): RecordingSession => ({
  status: "stopped",
  timeline: [],
  screenshots: [],
  ...overrides
});

describe("shouldStartWithFreshCapture", () => {
  it("starts fresh when an old completed capture is still selected", () => {
    expect(shouldStartWithFreshCapture(session({ stoppedAt: 1_000 }), 1_000 + FRESH_CAPTURE_AFTER_MS)).toBe(true);
  });

  it("keeps an active recording even when it began a long time ago", () => {
    expect(shouldStartWithFreshCapture(session({ status: "recording", startedAt: 1_000 }), 1_000 + FRESH_CAPTURE_AFTER_MS * 2)).toBe(false);
  });

  it("keeps a recent completed capture available", () => {
    expect(shouldStartWithFreshCapture(session({ stoppedAt: 1_000 }), 1_000 + FRESH_CAPTURE_AFTER_MS - 1)).toBe(false);
  });
});
