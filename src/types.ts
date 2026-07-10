export type RecordingStatus = "idle" | "recording" | "paused" | "stopped" | "planning" | "planned" | "generating" | "ready" | "error";

export type TimelineEventType =
  | "recording-started"
  | "recording-paused"
  | "recording-resumed"
  | "recording-stopped"
  | "url-change"
  | "annotation"
  | "redaction"
  | "manual-capture"
  | "screenshot";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  label?: string;
  kind?: "highlight" | "redaction";
}

export interface ScreenshotEvidence {
  id: string;
  capturedAtMs: number;
  url: string;
  title: string;
  dataUrl: string;
  annotations: Rect[];
  redactions: Rect[];
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  atMs: number;
  url: string;
  title: string;
  note?: string;
  screenshotId?: string;
  rect?: Rect;
}

export interface RecordingSession {
  status: RecordingStatus;
  startedAt?: number;
  stoppedAt?: number;
  activeTabId?: number;
  activeWindowId?: number;
  tabUrl?: string;
  tabTitle?: string;
  exportFolderName?: string;
  captureId?: string;
  timeline: TimelineEvent[];
  screenshots: ScreenshotEvidence[];
  videoDataUrl?: string;
  audioDataUrl?: string;
  templateId?: string;
  ticket?: TicketDraft;
  captureAnalysis?: CaptureAnalysis;
  openAiUsage?: OpenAiUsage;
  error?: string;
}

export interface CaptureAnalysis {
  userGoal: string;
  bestDelivery: string;
  breakingPoints: string[];
  helpfulImageMoments: Array<{
    screenshotId?: string;
    atSeconds: number;
    reason: string;
  }>;
  story: string;
}

export interface TicketDraft {
  title: string;
  templateName?: string;
  summary: string;
  environment: string[];
  reproductionSteps: string[];
  expectedBehavior: string;
  actualBehavior: string;
  evidence: Array<{
    screenshotId?: string;
    caption: string;
  }>;
  openQuestions: string[];
}

export type RuntimeMessage =
  | { type: "GET_SESSION" }
  | { type: "START_RECORDING"; includeMic: boolean; cursorHalo: boolean }
  | { type: "PAUSE_RECORDING" }
  | { type: "RESUME_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "CAPTURE_MOMENT"; note?: string }
  | { type: "PREPARE_CAPTURE_PLAN" }
  | { type: "GENERATE_TICKET" }
  | { type: "DOWNLOAD_PDF" }
  | { type: "SET_OVERLAY_MODE"; mode: OverlayMode }
  | { type: "CONTENT_RECT_CREATED"; rect: Rect }
  | { type: "CONTENT_PAGE_INFO"; url: string; title: string }
  | { type: "OFFSCREEN_STARTED" }
  | { type: "OFFSCREEN_STOPPED"; videoDataUrl: string; audioDataUrl?: string }
  | { type: "OFFSCREEN_ERROR"; error: string }
  | { type: "OFFSCREEN_PAUSED" }
  | { type: "OFFSCREEN_RESUMED" };

export type OverlayMode = "off" | "highlight" | "redact" | "cursor";

export interface Settings {
  openAiKey?: string;
  email?: string;
  uniqueId?: string;
  selectedTemplateId?: string;
  customTemplates?: TicketTemplate[];
  retentionDays?: number;
  microphoneEnabledAt?: number;
  captureHistory?: CaptureHistoryItem[];
}

export interface TicketTemplate {
  id: string;
  name: string;
  instructions: string;
  builtIn?: boolean;
}

export interface OpenAiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface CaptureHistoryItem {
  id: string;
  title: string;
  folderName?: string;
  createdAt: number;
  stoppedAt?: number;
  templateName?: string;
  imageCount: number;
  durationSeconds: number;
  hasPlan: boolean;
  hasTicket: boolean;
  session: RecordingSession;
}
