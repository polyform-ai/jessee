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
      narrative: "The walkthrough moved to Results.",
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
          },
          {
            startSeconds: 4,
            endSeconds: 4,
            title: "External reference",
            narrative: "Mention a page without matching visual evidence.",
            transcript: "",
            pageUrl: "https://unmatched.example.test/",
            kind: "manual"
          },
          {
            startSeconds: 5,
            endSeconds: 5,
            title: "Incomplete source",
            narrative: "Use captured evidence for the source metadata.",
            transcript: "",
            pageTitle: "Unrelated model title",
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
    expect(story[2]).toMatchObject({ pageUrl: "https://unmatched.example.test/" });
    expect(story[2].pageTitle).toBeUndefined();
    expect(story[3]).toMatchObject({
      pageUrl: "https://example.test/later",
      pageTitle: "Later"
    });
  });

  it("does not pair a model URL with a title from a different screenshot", () => {
    const story = buildCaptureStory(
      {
        userGoal: "Explain the source",
        keyPoints: [],
        breakingPoints: [],
        helpfulImageMoments: [],
        story: "Explain the page.",
        storySteps: [{
          startSeconds: 1,
          endSeconds: 2,
          title: "Explain the page",
          narrative: "Show where the issue appears.",
          transcript: "Explain the page.",
          pageUrl: "https://model.example.test/source",
          kind: "narration"
        }]
      },
      { text: "Explain the page.", segments: [{ start: 1, end: 2, text: "Explain the page." }] },
      [],
      [{
        id: "different-page",
        capturedAtMs: 2_000,
        url: "https://screenshot.example.test/fallback",
        title: "Fallback screenshot"
      }]
    );

    expect(story[0]).toMatchObject({ pageUrl: "https://model.example.test/source" });
    expect(story[0].pageTitle).toBeUndefined();
  });

  it("keeps URL-like browser titles out of page-change prose", () => {
    const pageUrl = "https://private.example.test/account?token=secret";
    const story = buildCaptureStory(
      {
        userGoal: "Explain a private page",
        keyPoints: [],
        breakingPoints: [],
        helpfulImageMoments: [],
        story: "Move to the next page."
      },
      undefined,
      [{ type: "url-change", atMs: 1_000, url: pageUrl, title: pageUrl }],
      []
    );

    expect(story[0]).toMatchObject({
      title: "Page changed",
      narrative: "The walkthrough moved to a new page.",
      pageUrl
    });
    expect(story[0].pageTitle).toBeUndefined();
  });
});
