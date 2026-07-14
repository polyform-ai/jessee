import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSession } from "../src/types";

const mocks = vi.hoisted(() => ({
  startRecordingFolder: vi.fn(),
  writeRecordingBlob: vi.fn(),
  writeRecordingText: vi.fn(),
  createPlanPdf: vi.fn(() => new Blob(["pdf"])),
  postWebhook: vi.fn(),
  anchorClick: vi.fn()
}));

vi.mock("../src/artifacts", () => ({ hydrateSession: vi.fn(async (session) => session) }));
vi.mock("../src/localFiles", () => ({
  startRecordingFolder: mocks.startRecordingFolder,
  writeRecordingBlob: mocks.writeRecordingBlob,
  writeRecordingText: mocks.writeRecordingText
}));
vi.mock("../src/pdf", () => ({
  createPlanPdf: mocks.createPlanPdf,
  planPdfFilename: vi.fn(() => "capture.pdf")
}));
vi.mock("../src/storage", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("../src/webhook", () => ({ postWebhook: mocks.postWebhook }));

import { downloadPlanPdf } from "../src/pdfDownload";

describe("downloadPlanPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => ({
        click: mocks.anchorClick,
        remove: vi.fn(),
        style: {}
      }))
    });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
  });

  it("reattaches to the capture folder before writing from the plan page", async () => {
    const session: RecordingSession = {
      status: "planned",
      exportFolderName: "2026-07-13t20-00-00-jessee-capture",
      timeline: [],
      screenshots: [],
      captureAnalysis: {
        userGoal: "Explain the workflow",
        story: "A visual walkthrough",
        helpfulImageMoments: []
      }
    };

    await downloadPlanPdf(session);

    expect(mocks.startRecordingFolder).toHaveBeenCalledWith(session.exportFolderName);
    expect(mocks.startRecordingFolder.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeRecordingBlob.mock.invocationCallOrder[0]);
    expect(mocks.writeRecordingBlob).toHaveBeenCalledWith("capture.pdf", expect.any(Blob));
    expect(mocks.writeRecordingText).toHaveBeenCalledWith("capture-analysis.json", expect.any(String), "application/json");
  });

  it("keeps the browser download available when the local folder cannot be reattached", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.startRecordingFolder.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    const session: RecordingSession = {
      status: "planned",
      exportFolderName: "capture-folder",
      timeline: [],
      screenshots: [],
      captureAnalysis: {
        userGoal: "Explain the workflow",
        story: "A visual walkthrough",
        helpfulImageMoments: []
      }
    };

    await downloadPlanPdf(session);

    expect(mocks.anchorClick).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
