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
});
