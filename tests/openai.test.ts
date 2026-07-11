import { afterEach, describe, expect, it, vi } from "vitest";
import { dataUrlToBlob } from "../src/dataUrl";
import { generateTicket, parseTicket } from "../src/openai";
import type { RecordingSession, TicketTemplate } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
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
      timeline: [{ id: "event-1", type: "screenshot", atMs: 1200, url: "https://example.test", title: "Example", screenshotId: "shot-1" }],
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
    const analysisRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { model: string; input: Array<{ role: string }> };
    expect(analysisRequest.model).toBe("gpt-5.6-terra");
    expect(analysisRequest.input).toHaveLength(2);
    expect(result.analysis.userGoal).toBe("Explain a broken save flow.");
    expect(result.ticket.title).toBe("Save button fails");
    expect(result.usage.totalTokens).toBe(180);
  });
});
