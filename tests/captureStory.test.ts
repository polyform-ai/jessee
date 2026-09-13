import { describe, expect, it } from "vitest";
import { buildCaptureStory, splitTranscriptIntoSentences } from "../src/captureStory";
import type { CaptureAnalysis, TimelineEvent } from "../src/types";

describe("splitTranscriptIntoSentences", () => {
  it("gives every sentence its own proportional timestamp", () => {
    expect(splitTranscriptIntoSentences([
      { start: 2, end: 8, text: "Open settings. Then save the change!" }
    ])).toEqual([
      { start: 2, end: 4.4, text: "Open settings." },
      { start: 4.4, end: 8, text: "Then save the change!" }
    ]);
  });
});

describe("buildCaptureStory", () => {
  it("keeps every sentence and page change in the story with resulting screenshots", () => {
    const analysis: CaptureAnalysis = {
      userGoal: "Explain the save flow",
      keyPoints: ["Saving fails"],
      breakingPoints: [],
      helpfulImageMoments: [],
      story: "Open settings, then review the result.",
      storySteps: [{
        startSeconds: 1,
        endSeconds: 2,
        title: "Open settings",
        narrative: "The user opens settings before saving.",
        transcript: "Open settings.",
        screenshotId: "shot-settings",
        kind: "narration"
      }]
    };
    const timeline: TimelineEvent[] = [{
      id: "page-change",
      type: "url-change",
      atMs: 2_500,
      url: "https://example.test/results",
      title: "Results"
    }];

    const story = buildCaptureStory(
      analysis,
      { text: "Open settings. The save fails.", segments: [
        { start: 1, end: 2, text: "Open settings." },
        { start: 3, end: 4, text: "The save fails." }
      ] },
      timeline,
      [
        { id: "shot-settings", capturedAtMs: 2_000, url: "https://example.test/settings", title: "Settings" },
        { id: "shot-results", capturedAtMs: 3_000, url: "https://example.test/results", title: "Results" },
        { id: "shot-error", capturedAtMs: 4_000, url: "https://example.test/results", title: "Save error" }
      ]
    );

    expect(story.map((step) => step.kind)).toEqual(["narration", "page-change", "narration"]);
    expect(story.every((step) => Boolean(step.pageUrl) && step.showPageUrl === true)).toBe(true);
    expect(story[1]).toEqual(expect.objectContaining({
      title: "Opened Results",
      pageUrl: "https://example.test/results",
      screenshotId: "shot-results"
    }));
    expect(story[2]).toEqual(expect.objectContaining({
      transcript: "The save fails.",
      screenshotId: "shot-error"
    }));
  });

  it("fills an early text-only step from the earliest page instead of a later sourced step", () => {
    const story = buildCaptureStory(
      {
        userGoal: "Explain the page",
        keyPoints: [],
        breakingPoints: [],
        helpfulImageMoments: [],
        story: "Introduce the page.",
        storySteps: [
          {
            startSeconds: 0,
            endSeconds: 0,
            title: "Introduction",
            narrative: "Set up the walkthrough.",
            transcript: "",
            kind: "manual"
          },
          {
            startSeconds: 3,
            endSeconds: 3,
            title: "Later page",
            narrative: "Continue on the next page.",
            transcript: "",
            pageUrl: "https://example.test/later",
            pageTitle: "Later",
            kind: "manual"
          }
        ]
      },
      undefined,
      [],
      [
        { id: "first-shot", capturedAtMs: 1_000, url: "https://example.test/start", title: "Start" },
        { id: "later-shot", capturedAtMs: 3_000, url: "https://example.test/later", title: "Later" }
      ]
    );

    expect(story[0]).toMatchObject({
      pageUrl: "https://example.test/start",
      pageTitle: "Start",
      showPageUrl: true
    });
    expect(story[1]).toMatchObject({ pageUrl: "https://example.test/later", pageTitle: "Later" });
  });
});
