import { describe, expect, it } from "vitest";
import { createTicketPdf, ticketPdfFilename } from "../src/pdf";
import type { RecordingSession, TicketDraft } from "../src/types";

describe("createTicketPdf", () => {
  it("creates a pdf blob", () => {
    const ticket: TicketDraft = {
      title: "Example ticket",
      summary: "Summary",
      environment: ["https://example.test"],
      reproductionSteps: ["Open the app"],
      expectedBehavior: "It works",
      actualBehavior: "It fails",
      evidence: [{ caption: "Initial state" }],
      openQuestions: []
    };
    const session: RecordingSession = {
      status: "ready",
      timeline: [],
      screenshots: [],
      ticket
    };

    const blob = createTicketPdf(ticket, session);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("creates a dated useful filename", () => {
    const filename = ticketPdfFilename(
      {
        title: "Checkout Save Button Fails!",
        summary: "",
        environment: [],
        reproductionSteps: [],
        expectedBehavior: "",
        actualBehavior: "",
        evidence: [],
        openQuestions: []
      },
      new Date("2026-07-09T12:00:00Z")
    );

    expect(filename).toBe("2026-07-09T12-00-00-checkout-save-button-fails.pdf");
  });

  it("embeds JPEG evidence in a labeled PDF card", async () => {
    const ticket: TicketDraft = {
      title: "Visual evidence", summary: "Summary", environment: [], reproductionSteps: [], expectedBehavior: "", actualBehavior: "",
      evidence: [{ screenshotId: "shot-1", caption: "The cursor points at the failed action." }], openQuestions: []
    };
    const session: RecordingSession = {
      status: "ready", timeline: [], ticket,
      screenshots: [{ id: "shot-1", capturedAtMs: 12_000, url: "https://example.test", title: "Example", dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AR//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AR//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/If/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8hH//Z", annotations: [], redactions: [] }]
    };
    const text = await createTicketPdf(ticket, session).text();
    expect(text).toContain("Evidence 1");
    expect(text).toContain("0:12");
  });
});
