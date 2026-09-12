import { describe, expect, it } from "vitest";
import { buildEditorDocument, parseEditorDocument } from "../src/storyEditor";
import type { CaptureAnalysis, CaptureStoryStep, ScreenshotEvidence } from "../src/types";

describe("visual story editor document", () => {
  it("places editable story copy and selected images in one structured document", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    expect(document.content?.map((node) => node.type)).toEqual(["storyOverview", "storyStep", "storyStep"]);
    expect(document.content?.[0].content?.[0].content?.[0].text).toBe("Explain the product");
    expect(document.content?.[1].content?.at(-1)?.type).toBe("storyImage");
    expect(document.content?.[1].content?.at(-1)?.attrs?.screenshotId).toBe("shot-1");
  });

  it("maps edited document text and image choices back to the saved story", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![0].content![0].content = [{ type: "text", text: "Share the finished explanation" }];
    document.content![0].content![0].content![0].marks = [{ type: "bold" }];
    document.content![1].content![0].content = [{ type: "text", text: "A clearer first step" }];
    document.content![1].content![1].content = [{ type: "text", text: "The edited explanation." }];
    document.content![1].content!.at(-1)!.attrs!.screenshotId = "shot-2";

    const updated = parseEditorDocument(document, analysis());
    expect(updated.userGoal).toBe("Share the finished explanation");
    expect(updated.storySteps?.[0]).toMatchObject({
      title: "A clearer first step",
      narrative: "The edited explanation.",
      transcript: "Original sentence.",
      screenshotId: "shot-2"
    });
    expect(updated.helpfulImageMoments[0].screenshotId).toBe("shot-2");
    expect(updated.editorDocument?.content?.[0].content?.[0].content?.[0].marks).toEqual([{ type: "bold" }]);
    expect(updated.editorDocument?.content?.[1].content?.at(-1)?.attrs).toEqual({ stepIndex: 0, screenshotId: "shot-2" });
  });

  it("keeps intentionally cleared overview fields empty", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![0].content![0].content = [];
    document.content![0].content![1].content = [];

    const updated = parseEditorDocument(document, analysis());

    expect(updated.userGoal).toBe("");
    expect(updated.story).toBe("");
  });
});

function analysis(): CaptureAnalysis {
  return {
    userGoal: "Explain the product",
    story: "A concise summary.",
    keyPoints: ["Keep the useful words", "Keep the useful images"],
    helpfulImageMoments: []
  };
}

function steps(): CaptureStoryStep[] {
  return [
    { startSeconds: 0, endSeconds: 4, title: "Start here", narrative: "Show the starting point.", transcript: "Original sentence.", screenshotId: "shot-1", kind: "narration" },
    { startSeconds: 4, endSeconds: 8, title: "Show the result", narrative: "Finish with the result.", transcript: "Second sentence.", screenshotId: "shot-2", kind: "action" }
  ];
}

function screenshots(): ScreenshotEvidence[] {
  return [
    { id: "shot-1", capturedAtMs: 4_000, url: "https://example.test/start", title: "Start", dataUrl: "data:image/png;base64,one", annotations: [], redactions: [] },
    { id: "shot-2", capturedAtMs: 8_000, url: "https://example.test/result", title: "Result", dataUrl: "data:image/png;base64,two", annotations: [], redactions: [] }
  ];
}
