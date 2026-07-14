import { afterEach, describe, expect, it, vi } from "vitest";
import { dataUrlToBlob } from "../src/dataUrl";
import { alignAnalysisToSentenceEnds, analyzeCapture, selectPlanningScreenshots, testOpenAiSetup, transcribeAudio } from "../src/openai";
import type { RecordingSession } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

it("selects a bounded set of transition screenshots for planning", () => {
  const session = captureSession(30);
  session.timeline.push({ id: "change", type: "url-change", atMs: 5_000, url: "https://example.test/two", title: "Second page" });

  const selected = selectPlanningScreenshots(session);

  expect(selected).toHaveLength(20);
  expect(selected[0].id).toBe("shot-0");
  expect(selected.at(-1)?.id).toBe("shot-29");
  expect(selected.some((shot) => shot.capturedAtMs >= 5_000)).toBe(true);
});

it("tests GPT-5.6 Sol and transcription without selecting an older fallback", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));

  await testOpenAiSetup("sk-test");

  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.openai.com/v1/models/gpt-5.6-sol",
    "https://api.openai.com/v1/models/gpt-4o-transcribe-diarize"
  ]);
});

it("requests sentence-level timestamped transcription", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    text: "Open settings. Save the change.",
    segments: [{ start: 1.2, end: 3.8, text: "Open settings. Save the change.", speaker: "A" }]
  }), { status: 200 }));

  const result = await transcribeAudio("sk-test", "data:audio/webm;base64,aGVsbG8=");

  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(body.get("model")).toBe("gpt-4o-transcribe-diarize");
  expect(body.get("response_format")).toBe("diarized_json");
  expect(result.segments).toEqual([
    { start: 1.2, end: 2.413, text: "Open settings." },
    { start: 2.413, end: 3.8, text: "Save the change." }
  ]);
});

it("aligns a narrated moment to the first screenshot after the sentence ends", () => {
  const analysis = alignAnalysisToSentenceEnds(
    { userGoal: "Document the flow", helpfulImageMoments: [{ screenshotId: "shot-start", atSeconds: 1, reason: "Shows the save flow" }], story: "Open settings and save." },
    { text: "Open settings and save.", segments: [{ start: 1, end: 3.2, text: "Open settings and save." }] },
    [
      { id: "shot-start", capturedAtMs: 1_000, url: "https://example.test", title: "Start" },
      { id: "shot-before-end", capturedAtMs: 3_000, url: "https://example.test", title: "Before" },
      { id: "shot-after-end", capturedAtMs: 3_500, url: "https://example.test", title: "After" }
    ]
  );

  expect(analysis.helpfulImageMoments[0]).toEqual(expect.objectContaining({ atSeconds: 3.2, screenshotId: "shot-after-end" }));
});

describe("analyzeCapture", () => {
  it("uses GPT-5.6 Sol with medium reasoning and transition images", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        userGoal: "Explain the save flow",
        keyPoints: ["Saving fails"],
        story: "The user opens settings and encounters a save error.",
        storySteps: [{ startSeconds: 1, endSeconds: 2, title: "Save fails", narrative: "The save action fails.", transcript: "Saving fails.", screenshotId: "shot-2", kind: "narration" }]
      }),
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
    }), { status: 200 }));
    const session = captureSession(3);
    session.timeline.push({ id: "change", type: "url-change", atMs: 1_500, url: "https://example.test/two", title: "Results" });

    const result = await analyzeCapture("sk-test", { text: "Saving fails.", segments: [{ start: 1, end: 2, text: "Saving fails." }] }, session);

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.model).toBe("gpt-5.6-sol");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(request.input[1].content.some((item: { type: string }) => item.type === "input_image")).toBe(true);
    expect(request.input[1].content[0].text).toContain("shownTransitionScreenshotIds");
    expect(result.analysis.keyPoints).toEqual(["Saving fails"]);
    expect(result.analysis.storySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ transcript: "Saving fails.", screenshotId: "shot-2" }),
      expect.objectContaining({ kind: "page-change", pageUrl: "https://example.test/two" })
    ]));
  });

  it("never sends screenshot pixels in Private Mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ userGoal: "Private plan", keyPoints: [], story: "", storySteps: [] }),
      usage: {}
    }), { status: 200 }));

    await analyzeCapture("sk-test", { text: "", segments: [] }, captureSession(2), true);

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(JSON.stringify(request)).not.toContain("data:image");
    expect(request.input[1].content).toHaveLength(1);
    expect(request.input[1].content[0].text).toContain('"shownTransitionScreenshotIds": []');
  });
});

it("decodes media recorder data urls with mime parameters", async () => {
  const blob = dataUrlToBlob("data:audio/webm;codecs=opus;base64,aGVsbG8=");
  expect(blob.type).toBe("audio/webm;codecs=opus");
  expect(await blob.text()).toBe("hello");
});

function captureSession(count: number): RecordingSession {
  return {
    status: "stopped",
    timeline: [],
    screenshots: Array.from({ length: count }, (_, index) => ({
      id: `shot-${index}`,
      capturedAtMs: index * 1_000,
      url: index >= Math.ceil(count / 2) ? "https://example.test/two" : "https://example.test/one",
      title: `State ${index}`,
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
      annotations: [],
      redactions: []
    }))
  };
}
