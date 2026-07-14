import { afterEach, describe, expect, it, vi } from "vitest";
import { dataUrlToBlob } from "../src/dataUrl";
import { alignAnalysisToSentenceEnds, generateTicket, parseTicket, selectScreenshotsForAnalysis, testOpenAiSetup, transcribeAudio } from "../src/openai";
import type { RecordingSession, TicketTemplate } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

it("uses representative screenshots when a plan has no visual moments", () => {
  const screenshots = Array.from({ length: 30 }, (_, index) => ({
    id: `shot-${index}`,
    capturedAtMs: index * 500,
    url: "https://example.test",
    title: "Example",
    dataUrl: "data:image/jpeg;base64,aGVsbG8=",
    annotations: [],
    redactions: []
  }));
  const selected = selectScreenshotsForAnalysis(screenshots, {
    userGoal: "", bestDelivery: "", breakingPoints: [], helpfulImageMoments: [], story: ""
  });

  expect(selected).toHaveLength(30);
  expect(selected[0].id).toBe("shot-0");
  expect(selected.at(-1)?.id).toBe("shot-29");
});

it("tests both required models without selecting an older fallback", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));

  await testOpenAiSetup("sk-test");

  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.openai.com/v1/models/gpt-5.6-terra",
    "https://api.openai.com/v1/models/gpt-4o-transcribe-diarize"
  ]);
});

it("requests timestamped transcription segments", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    text: "Open settings. Save the change.",
    segments: [{ start: 1.2, end: 3.8, text: "Open settings. Save the change.", speaker: "A" }]
  }), { status: 200 }));

  const result = await transcribeAudio("sk-test", "data:audio/webm;base64,aGVsbG8=");

  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(body.get("model")).toBe("gpt-4o-transcribe-diarize");
  expect(body.get("response_format")).toBe("diarized_json");
  expect(body.get("chunking_strategy")).toBe("auto");
  expect(result.segments).toEqual([
    { start: 1.2, end: 2.413, text: "Open settings." },
    { start: 2.413, end: 3.8, text: "Save the change." }
  ]);
});

it("aligns a narrated moment to the first screenshot after the sentence ends", () => {
  const analysis = alignAnalysisToSentenceEnds(
    {
      userGoal: "Document the flow",
      bestDelivery: "Guide",
      breakingPoints: [],
      story: "Open settings and save.",
      helpfulImageMoments: [{ screenshotId: "shot-start", atSeconds: 1, reason: "Shows the save flow" }]
    },
    { text: "Open settings and save.", segments: [{ start: 1, end: 3.2, text: "Open settings and save." }] },
    [
      { id: "shot-start", capturedAtMs: 1_000 },
      { id: "shot-before-end", capturedAtMs: 3_000 },
      { id: "shot-after-end", capturedAtMs: 3_500 }
    ]
  );

  expect(analysis.helpfulImageMoments[0]).toEqual(expect.objectContaining({
    atSeconds: 3.2,
    screenshotId: "shot-after-end"
  }));
});

describe("parseTicket", () => {
  it("parses fenced json and fills defaults", () => {
    const ticket = parseTicket(`\`\`\`json
{"title":"Broken button","summary":"Clicking Save fails","reproductionSteps":["Open page","Click Save"],"expectedBehavior":"Saves","actualBehavior":"Error","evidence":[{"screenshotId":"s1","caption":"Error visible"}],"openQuestions":[],"environment":["https://example.test"]}
\`\`\``);

    expect(ticket.title).toBe("Broken button");
    expect(ticket.reproductionSteps).toHaveLength(2);
    expect(ticket.summary).toBe("Clicking Save fails");
  });

  it("decodes data urls without fetch", async () => {
    const blob = dataUrlToBlob("data:text/plain;base64,aGVsbG8=");

    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello");
  });

  it("decodes media recorder data urls with mime parameters", async () => {
    const blob = dataUrlToBlob("data:audio/webm;codecs=opus;base64,aGVsbG8=");

    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(await blob.text()).toBe("hello");
  });

  it("analyzes the capture before generating the final ticket", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            userGoal: "Explain a broken save flow.",
            keyPoints: ["Saving returns an error", "The result page proves the failure"],
            bestDelivery: "Debug ticket with reproduction steps.",
            breakingPoints: ["Save button returns an error."],
            helpfulImageMoments: [{ screenshotId: "shot-1", atSeconds: 1.2, reason: "Shows the error." }],
            story: "The user opened the page, clicked save, and saw an error."
          }),
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
        }),
        { status: 200 }
      )
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            title: "Save button fails",
            summary: "Saving fails with a visible error.",
            environment: ["https://example.test"],
            reproductionSteps: ["Open the page", "Click Save"],
            expectedBehavior: "The save completes.",
            actualBehavior: "An error appears.",
            evidence: [{ screenshotId: "shot-1", caption: "The save error is visible." }],
            openQuestions: []
          }),
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
        }),
        { status: 200 }
      )
    );

    const session: RecordingSession = {
      status: "stopped",
      timeline: [
        { id: "event-1", type: "click", atMs: 900, url: "https://example.test", title: "Example", note: "Clicked at 320, 180", point: { x: 320, y: 180 } },
        { id: "event-2", type: "url-change", atMs: 1100, url: "https://example.test/results", title: "Results" },
        { id: "event-3", type: "screenshot", atMs: 1200, url: "https://example.test/results", title: "Results", screenshotId: "shot-1" }
      ],
      screenshots: [
        {
          id: "shot-1",
          capturedAtMs: 1200,
          url: "https://example.test",
          title: "Example",
          dataUrl: "data:image/png;base64,aGVsbG8=",
          annotations: [],
          redactions: []
        }
      ]
    };
    const template: TicketTemplate = {
      id: "debug-ticket",
      name: "Debug Ticket",
      instructions: "Create a concise debug ticket."
    };

    const result = await generateTicket(
      "sk-test",
      session,
      { text: "I clicked save and got an error.", segments: [{ start: 1, end: 2, text: "I clicked save and got an error." }] },
      template
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const analysisRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      model: string;
      input: Array<{ role: string; content?: Array<{ text?: string }> }>;
    };
    expect(analysisRequest.model).toBe("gpt-5.6-terra");
    expect(analysisRequest.input).toHaveLength(2);
    const analysisInput = JSON.parse(analysisRequest.input[1].content?.[0].text ?? "{}") as {
      timeline: Array<{ type: string; atSeconds: number; point?: { x: number; y: number } }>;
      transcriptSegments: Array<{ start: number; end: number; selectionAtSeconds: number; screenshotAtSentenceEnd?: { id: string } }>;
    };
    expect(analysisInput.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "click", atSeconds: 0.9, point: { x: 320, y: 180 } }),
      expect.objectContaining({ type: "url-change", atSeconds: 1.1 })
    ]));
    expect(analysisInput.transcriptSegments[0]).toEqual(expect.objectContaining({
      start: 1,
      end: 2,
      selectionAtSeconds: 2,
      screenshotAtSentenceEnd: expect.objectContaining({ id: "shot-1" })
    }));
    expect(result.analysis.userGoal).toBe("Explain a broken save flow.");
    expect(result.analysis.keyPoints).toEqual(["Saving returns an error", "The result page proves the failure"]);
    expect(result.analysis.storySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "page-change", pageUrl: "https://example.test/results", screenshotId: "shot-1" }),
      expect.objectContaining({ transcript: "I clicked save and got an error.", screenshotId: "shot-1" })
    ]));
    expect(result.ticket.title).toBe("Save button fails");
    expect(result.usage.totalTokens).toBe(180);
  });

  it("keeps screenshot pixels out of the drafting request in Private Mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ title: "Private ticket", summary: "", environment: [], reproductionSteps: [], expectedBehavior: "", actualBehavior: "", evidence: [{ screenshotId: "shot-1", caption: "Attach the selected local frame." }], openQuestions: [] }),
      usage: {}
    }), { status: 200 }));
    const session: RecordingSession = {
      status: "stopped", timeline: [],
      screenshots: [{ id: "shot-1", capturedAtMs: 1000, url: "https://example.test", title: "Example", dataUrl: "data:image/jpeg;base64,aGVsbG8=", annotations: [], redactions: [] }]
    };
    const template: TicketTemplate = { id: "debug-ticket", name: "Debug Ticket", instructions: "Create a concise debug ticket." };
    const analysis = { userGoal: "Explain a bug.", bestDelivery: "Ticket", breakingPoints: [], helpfulImageMoments: [{ screenshotId: "shot-1", atSeconds: 1, reason: "Relevant state" }], story: "" };

    await generateTicket("sk-test", session, { text: "", segments: [] }, template, analysis, true);

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(JSON.stringify(request)).not.toContain("data:image");
    expect(request.input[1].content).toHaveLength(1);
  });
});
