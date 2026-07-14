import { describe, expect, it } from "vitest";
import { createPlanPdf, planPdfFilename } from "../src/pdf";
import type { RecordingSession } from "../src/types";

describe("createPlanPdf", () => {
  it("creates a PDF directly from the reviewed visual story", () => {
    const blob = createPlanPdf(planSession());
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("creates a dated useful filename", () => {
    const filename = planPdfFilename("Checkout Save Button Fails!", new Date("2026-07-09T12:00:00Z"));
    expect(filename).toBe("2026-07-09T12-00-00-checkout-save-button-fails.pdf");
  });

  it("embeds a selected screenshot in its timestamped story step", async () => {
    const text = await createPlanPdf(planSession(true)).text();
    expect(text).toContain("Story step 1");
    expect(text).toContain("0:12");
  });
});

function planSession(withImage = false): RecordingSession {
  const screenshot = {
    id: "shot-1",
    capturedAtMs: 12_000,
    url: "https://example.test",
    title: "Example",
    dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AR//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AR//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/If/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8hH//Z",
    annotations: [],
    redactions: []
  };
  return {
    status: "ready",
    timeline: [],
    screenshots: withImage ? [screenshot] : [],
    captureAnalysis: {
      userGoal: "Explain the save failure",
      keyPoints: ["The save action fails"],
      story: "The user attempts to save and sees a failure.",
      helpfulImageMoments: withImage ? [{ screenshotId: "shot-1", atSeconds: 12, reason: "The failure is visible." }] : [],
      storySteps: [{
        startSeconds: 10,
        endSeconds: 12,
        title: "Save fails",
        narrative: "The save action does not complete.",
        transcript: "The save is failing here.",
        screenshotId: withImage ? "shot-1" : undefined,
        kind: "narration"
      }]
    }
  };
}
