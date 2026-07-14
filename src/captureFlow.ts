import type { RecordingSession } from "./types";

export interface CaptureFlowButton {
  id: "start" | "stop" | "openMicSettings" | "createPlan" | "reviewPlan" | "downloadPdf" | "newCapture";
  label: string;
  tone: "primary" | "danger" | "secondary";
}

export interface CaptureFlowView {
  title: string;
  description: string;
  buttons: CaptureFlowButton[];
  showShortcuts: boolean;
}

export function getPlanPdfAction(status: RecordingSession["status"], dirty: boolean): { label: string; disabled: boolean } {
  if (status === "generating") return { label: "Building PDF…", disabled: true };
  if (status === "ready" && !dirty) return { label: "Download PDF", disabled: false };
  return { label: "Generate PDF", disabled: false };
}

export function getCaptureFlowView(
  session: RecordingSession | undefined,
  microphoneReady: boolean,
  hasEvidence: boolean
): CaptureFlowView {
  switch (session?.status ?? "idle") {
    case "recording":
    case "paused":
      return {
        title: "Capture in progress",
        description: "Talk through the workflow, then close the capture when the story is complete.",
        buttons: [{ id: "stop", label: "Close Capture", tone: "danger" }],
        showShortcuts: true
      };
    case "planning":
      return {
        title: "Creating your plan",
        description: "JesSee is aligning the transcript, page changes, and visual evidence.",
        buttons: [],
        showShortcuts: false
      };
    case "planned":
      return {
        title: "Plan ready to review",
        description: "Step through the story, adjust screenshots, and generate the PDF when it reads correctly.",
        buttons: [
          { id: "reviewPlan", label: "Review Plan", tone: "primary" },
          { id: "newCapture", label: "New Capture", tone: "secondary" }
        ],
        showShortcuts: false
      };
    case "generating":
      return {
        title: "Building your PDF",
        description: "JesSee is rendering the reviewed story with its selected local screenshots.",
        buttons: [],
        showShortcuts: false
      };
    case "ready":
      return {
        title: "PDF ready",
        description: "Download it again, review the plan, or begin a fresh capture.",
        buttons: [
          { id: "downloadPdf", label: "Download PDF", tone: "primary" },
          { id: "reviewPlan", label: "Review Plan", tone: "secondary" },
          { id: "newCapture", label: "New Capture", tone: "secondary" }
        ],
        showShortcuts: false
      };
    case "stopped":
      return hasEvidence ? {
        title: "Capture complete",
        description: "Create a visual story plan from the narration and recorded timeline.",
        buttons: [
          { id: "createPlan", label: "Create Plan", tone: "primary" },
          { id: "newCapture", label: "New Capture", tone: "secondary" }
        ],
        showShortcuts: false
      } : readyToStart(microphoneReady);
    case "error":
      return hasEvidence
        ? {
            title: "The capture is safe",
            description: "JesSee kept the recording. Retry the plan or start over.",
            buttons: [
              { id: "createPlan", label: "Retry Plan", tone: "primary" },
              { id: "newCapture", label: "New Capture", tone: "secondary" }
            ],
            showShortcuts: false
          }
        : readyToStart(microphoneReady);
    case "idle":
    default:
      return readyToStart(microphoneReady);
  }
}

function readyToStart(microphoneReady: boolean): CaptureFlowView {
  if (!microphoneReady) {
    return {
      title: "Enable your microphone",
      description: "Choose and verify a microphone before starting a capture.",
      buttons: [{ id: "openMicSettings", label: "Enable Microphone", tone: "primary" }],
      showShortcuts: false
    };
  }
  return {
    title: "Ready to capture",
    description: "Share your screen and explain what you want the reader to understand.",
    buttons: [{ id: "start", label: "Start Capture", tone: "primary" }],
    showShortcuts: false
  };
}
