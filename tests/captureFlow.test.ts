import { describe, expect, it } from "vitest";
import { blocksLibraryCaptureActions, getCaptureFlowView, getPlanPdfAction } from "../src/captureFlow";
import type { RecordingSession, RecordingStatus } from "../src/types";

describe("getCaptureFlowView", () => {
  it.each([
    ["idle", ["start"]],
    ["recording", ["stop"]],
    ["planning", []],
    ["planned", ["reviewPlan", "newCapture"]],
    ["generating", []],
    ["ready", ["downloadPdf", "reviewPlan", "newCapture"]]
  ] as Array<[RecordingStatus, string[]]>)('shows only useful actions while %s', (status, expectedIds) => {
    const view = getCaptureFlowView(session(status), true, status !== "idle");
    expect(view.buttons.map((button) => button.id)).toEqual(expectedIds);
  });

  it("makes microphone setup the only action when the microphone is not ready", () => {
    const view = getCaptureFlowView(session("idle"), false, false);
    expect(view.buttons.map((button) => button.id)).toEqual(["openMicSettings"]);
  });

  it("does not block review or download when microphone setup later becomes unavailable", () => {
    expect(getCaptureFlowView(session("planned"), false, true).buttons[0].id).toBe("reviewPlan");
    expect(getCaptureFlowView(session("ready"), false, true).buttons[0].id).toBe("downloadPdf");
  });

  it("offers a retry without hiding captured evidence after a planning error", () => {
    const view = getCaptureFlowView(session("error"), true, true);
    expect(view.buttons[0]).toEqual(expect.objectContaining({ id: "createPlan", label: "Retry Plan" }));
  });

  it("downloads a clean ready plan but regenerates after an edit", () => {
    expect(getPlanPdfAction("ready", false).label).toBe("Download PDF");
    expect(getPlanPdfAction("ready", true).label).toBe("Generate PDF");
    expect(getPlanPdfAction("generating", false)).toEqual({ label: "Building PDF…", disabled: true });
  });

  it("blocks Library actions only while a stopped capture is entering automatic planning", () => {
    const automaticHandoff = { ...session("stopped"), autoPlanningPending: true };
    expect(blocksLibraryCaptureActions(automaticHandoff)).toBe(true);
    expect(getCaptureFlowView(automaticHandoff, true, true)).toMatchObject({
      title: "Creating your plan",
      buttons: []
    });
    expect(blocksLibraryCaptureActions({ ...session("stopped"), autoPlanningPending: false, analysisError: "Retry planning" })).toBe(false);
    expect(blocksLibraryCaptureActions(session("planning"))).toBe(true);
    expect(blocksLibraryCaptureActions(session("ready"))).toBe(false);
  });
});

function session(status: RecordingStatus): RecordingSession {
  return { status, timeline: [], screenshots: [] };
}
