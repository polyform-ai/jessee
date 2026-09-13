import { jsPDF } from "jspdf";
import { describe, expect, it, vi } from "vitest";
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
    expect(text).toContain("Step 1 - selected visual");
    expect(text).toContain("0:12");
    expect(text).not.toContain("What the user said");
    expect(text).not.toContain("The save is failing here");
  });

  it("renders the complete story on one continuous PDF page", async () => {
    const session = planSession(true);
    const firstStep = session.captureAnalysis!.storySteps![0];
    session.captureAnalysis!.storySteps = Array.from({ length: 4 }, (_, index) => ({
      ...firstStep,
      startSeconds: index * 12,
      endSeconds: (index + 1) * 12,
      title: `Story step ${index + 1}`
    }));
    const text = await createPlanPdf(session).text();
    const mediaBox = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(text).toContain("/Count 1");
    expect(Number(mediaBox?.[2])).toBeGreaterThan(792);
  });

  it("preserves editor emphasis in the PDF font runs", async () => {
    const session = planSession();
    session.captureAnalysis!.editorDocument = {
      type: "doc",
      content: [
        {
          type: "storyOverview",
          content: [
            { type: "storyTitle", content: [{ type: "text", text: "Explain the save failure", marks: [{ type: "italic" }] }] },
            { type: "storySummary", content: [{ type: "text", text: "Saving does not complete", marks: [{ type: "italic" }] }] },
            { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "The save action fails" }] }] }] }
          ]
        },
        {
          type: "storyStep",
          content: [
            { type: "heading", content: [{ type: "text", text: "Save fails", marks: [{ type: "italic" }] }] },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "The save action" },
                { type: "hardBreak" },
                { type: "hardBreak" },
                { type: "text", text: "does not complete." },
                { type: "text", text: " Important.", marks: [{ type: "bold" }] }
              ]
            },
            { type: "storyImage" }
          ]
        }
      ]
    };
    const firstStep = session.captureAnalysis!.storySteps![0];
    session.captureAnalysis!.storySteps = Array.from({ length: 14 }, (_, index) => ({
      ...firstStep,
      startSeconds: index,
      endSeconds: index + 1,
      title: `Formatting step ${index + 1}`
    }));
    const singleBreakSession = structuredClone(session);
    const singleBreakParagraph = singleBreakSession.captureAnalysis!.editorDocument!.content![1].content![1];
    singleBreakParagraph.content!.splice(2, 1);
    const singleBreakText = await createPlanPdf(singleBreakSession).text();
    const text = await createPlanPdf(session).text();
    const singleBreakHeight = Number(singleBreakText.match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/)?.[1]);
    const doubleBreakHeight = Number(text.match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/)?.[1]);
    expect(text).toContain("/F2 ");
    expect(text).toContain("/F3 ");
    expect(text).toContain("/F4 ");
    expect(text).not.toContain("The save actiondoes not complete.");
    expect(doubleBreakHeight).toBeGreaterThan(singleBreakHeight);
  });

  it("renders surviving overview points and lists inside story steps", async () => {
    const nestedLongToken = "W".repeat(55);
    const session = planSession();
    session.captureAnalysis!.keyPoints = ["Second point remains"];
    session.captureAnalysis!.editorDocument = {
      type: "doc",
      content: [
        {
          type: "storyOverview",
          content: [
            { type: "storyTitle", content: [{ type: "text", text: "Explain the save failure" }] },
            { type: "storySummary", content: [{ type: "text", text: "Saving does not complete" }] },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [] }] },
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second point remains" }] }] }
              ]
            }
          ]
        },
        {
          type: "storyStep",
          content: [
            { type: "heading", content: [{ type: "text", text: "Save fails" }] },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Open settings" }] }] },
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Deploy to:" }] },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [{
                            type: "paragraph",
                            content: [
                              { type: "text", text: "Staging" },
                              { type: "hardBreak" },
                              { type: "text", text: "Production" },
                              { type: "hardBreak" },
                              { type: "text", text: nestedLongToken }
                            ]
                          }]
                        }
                      ]
                    }
                  ]
                },
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Retry save" }] }] }
              ]
            },
            { type: "storyImage" }
          ]
        }
      ]
    };

    const text = await createPlanPdf(session).text();

    expect(text).toContain("Second point remains");
    expect(text).toContain("Open settings");
    expect(text).toContain("Deploy to:");
    expect(text).toContain("Staging");
    expect(text).toContain("Production");
    expect(text).not.toContain("Deploy to:Staging");
    expect(text).toContain("Retry save");
    const nestedBulletX = Number(text.match(/([\d.]+) [\d.]+ Td\n\(- Staging\) Tj/)?.[1]);
    const nestedContinuationX = Number(text.match(/([\d.]+) [\d.]+ Td\n\(Production\) Tj/)?.[1]);
    const productionY = Number(text.match(/[\d.]+ ([\d.]+) Td\n\(Production\) Tj/)?.[1]);
    const firstLongTokenY = Number(text.match(/[\d.]+ ([\d.]+) Td\n\(W+\) Tj/)?.[1]);
    expect(nestedBulletX).toBeGreaterThan(44);
    expect(nestedContinuationX).toBe(nestedBulletX);
    expect(productionY - firstLongTokenY).toBeCloseTo(13, 5);
    expect(text).not.toContain(`(${nestedLongToken}) Tj`);
    expect(text.match(/\(W+\) Tj/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders callouts and honors hidden step source URLs", async () => {
    const session = planSession();
    const step = session.captureAnalysis!.storySteps![0];
    session.captureAnalysis!.storySteps = [{
      ...step,
      pageUrl: "https://example.test/private-source",
      pageTitle: "Private source",
      showPageUrl: false
    }];
    session.captureAnalysis!.editorDocument = {
      type: "doc",
      content: [
        {
          type: "storyOverview",
          content: [
            { type: "storyTitle", content: [{ type: "text", text: "Explain the save failure" }] },
            { type: "storySummary", content: [{ type: "text", text: "Saving does not complete" }] }
          ]
        },
        {
          type: "storyStep",
          content: [
            { type: "heading", content: [{ type: "text", text: "Save fails" }] },
            {
              type: "blockquote",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Check this before sharing." }] },
                { type: "paragraph", content: [{ type: "text", text: "Keep the source private." }] }
              ]
            },
            {
              type: "orderedList",
              attrs: { start: 5 },
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Continue from the prior procedure" }] }] }
              ]
            },
            { type: "storySource", attrs: { pageUrl: "https://example.test/private-source", visible: false } },
            { type: "storyImage" }
          ]
        }
      ]
    };

    const text = await createPlanPdf(session).text();

    expect(text).toContain("Check this before sharing.");
    expect(text).toContain("Keep the source private.");
    expect(text).not.toContain("sharing.Keep");
    expect(text).toContain("5. Continue from the prior procedure");
    expect(text).not.toContain("private-source");
  });

  it("keeps editor-cleared key points out of the PDF", async () => {
    const session = planSession();
    session.captureAnalysis!.keyPoints = ["Stale structured point"];
    session.captureAnalysis!.editorDocument = {
      type: "doc",
      content: [
        {
          type: "storyOverview",
          content: [
            { type: "storyTitle", content: [{ type: "text", text: "Explain the save failure" }] },
            { type: "storySummary", content: [{ type: "text", text: "Saving does not complete" }] }
          ]
        },
        {
          type: "storyStep",
          content: [
            { type: "heading", content: [{ type: "text", text: "Save fails" }] },
            { type: "paragraph", content: [{ type: "text", text: "Retry the save" }] },
            { type: "storyImage" }
          ]
        }
      ]
    };

    const text = await createPlanPdf(session).text();

    expect(text).not.toContain("Key points");
    expect(text).not.toContain("Stale structured point");
  });

  it("scales an unusually long story without clipping its final step", async () => {
    const imageProperties = vi.spyOn(
      jsPDF.API as unknown as { getImageProperties: (imageData: string) => unknown },
      "getImageProperties"
    );
    const session = planSession(true);
    const firstStep = session.captureAnalysis!.storySteps![0];
    session.captureAnalysis!.storySteps = Array.from({ length: 80 }, (_, index) => ({
      ...firstStep,
      startSeconds: index * 12,
      endSeconds: (index + 1) * 12,
      title: index === 79 ? "Final visible step" : `Detailed story step ${index + 1}`,
      narrative: "This explanation remains visible even when a continuous document contains many words and selected images."
    }));
    const text = await createPlanPdf(session).text();
    const mediaBox = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(text).toContain("/Count 1");
    expect(Number(mediaBox?.[2])).toBeLessThanOrEqual(14_400);
    expect(text).toContain("Final visible step");
    expect(imageProperties).toHaveBeenCalledTimes(1);
    imageProperties.mockRestore();
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
      story: "Saving does not complete and the failure is visible.",
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
