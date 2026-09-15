import { describe, expect, it } from "vitest";
import { formatRecordingElapsed, recordingHudShortcutMarkup, recordingHudShortcuts } from "../src/recordingHud";

describe("recording HUD", () => {
  it("formats the live recording duration without drifting below zero", () => {
    expect(formatRecordingElapsed(10_000, 9_000)).toBe("00:00");
    expect(formatRecordingElapsed(10_000, 75_000)).toBe("01:05");
    expect(formatRecordingElapsed(10_000, 3_675_000)).toBe("01:01:05");
  });

  it("keeps the complete shortcut guide in one reusable control", () => {
    expect(recordingHudShortcuts.map((shortcut) => shortcut.key)).toEqual(["B", "R", "C"]);
    expect(recordingHudShortcutMarkup()).toContain("Highlight");
    expect(recordingHudShortcutMarkup()).toContain("Redact");
    expect(recordingHudShortcutMarkup()).toContain("Clear");
  });
});
