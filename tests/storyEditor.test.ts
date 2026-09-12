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

  it("preserves hard breaks and intentionally cleared step headings", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![0].content![1].content = [
      { type: "text", text: "First summary line" },
      { type: "hardBreak" },
      { type: "text", text: "Second summary line" }
    ];
    document.content![1].content![0].content = [];
    document.content![1].content![1].content = [
      { type: "text", text: "First detail" },
      { type: "hardBreak" },
      { type: "text", text: "Second detail" }
    ];

    const updated = parseEditorDocument(document, analysis());

    expect(updated.story).toBe("First summary line\nSecond summary line");
    expect(updated.storySteps?.[0].title).toBe("");
    expect(updated.storySteps?.[0].narrative).toBe("First detail\nSecond detail");
  });

  it("preserves leading, trailing, and break-only editor lines", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![0].content![1].content = [
      { type: "hardBreak" },
      { type: "text", text: "Summary" },
      { type: "hardBreak" }
    ];
    document.content![1].content![0].content = [
      { type: "hardBreak" },
      { type: "text", text: "Step title" },
      { type: "hardBreak" }
    ];
    document.content![1].content![1].content = [{ type: "hardBreak" }];

    const updated = parseEditorDocument(document, analysis());

    expect(updated.story).toBe("\nSummary\n");
    expect(updated.storySteps?.[0].title).toBe("\nStep title\n");
    expect(updated.storySteps?.[0].narrative).toBe("\n");
  });

  it("maps bullet lists in step bodies back to readable story text", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![1].content![1] = {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "First detail" }] },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested detail" }] }] }
              ]
            }
          ]
        },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second detail" }] }] }
      ]
    };

    const updated = parseEditorDocument(document, analysis());

    expect(updated.storySteps?.[0].narrative).toBe("- First detail\n  - Nested detail\n- Second detail");
  });

  it("keeps nested overview bullets as separate saved key points", () => {
    const document = buildEditorDocument(analysis(), steps(), screenshots());
    document.content![0].content![2].content![0] = {
      type: "listItem",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Deploy to:" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Staging" }] }] }
          ]
        }
      ]
    };

    const updated = parseEditorDocument(document, analysis());

    expect(updated.keyPoints).toEqual(["Deploy to:", "Staging", "Keep the useful images"]);
  });

  it("keeps an editable key-point list when the generated draft has no points", () => {
    const emptyAnalysis = { ...analysis(), keyPoints: [], breakingPoints: [] };
    const document = buildEditorDocument(emptyAnalysis, steps(), screenshots(), true);
    const overview = document.content?.find((node) => node.type === "storyOverview");
    const list = overview?.content?.find((node) => node.type === "bulletList");

    expect(list?.content).toEqual([{ type: "listItem", content: [{ type: "paragraph" }] }]);
    expect(parseEditorDocument(document, emptyAnalysis).keyPoints).toEqual([]);
  });

  it("restores the editable key-point affordance without mutating a saved cleared list", () => {
    const savedDocument = buildEditorDocument(analysis(), steps(), screenshots());
    savedDocument.content![0].content = savedDocument.content![0].content?.filter((node) => node.type !== "bulletList");
    const savedAnalysis = { ...analysis(), keyPoints: [], editorDocument: savedDocument };

    const editableDocument = buildEditorDocument(savedAnalysis, steps(), screenshots(), true);

    expect(savedDocument.content![0].content?.some((node) => node.type === "bulletList")).toBe(false);
    expect(editableDocument.content![0].content?.find((node) => node.type === "bulletList")?.content).toHaveLength(1);
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
