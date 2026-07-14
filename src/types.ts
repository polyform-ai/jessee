export type RecordingStatus = "idle" | "recording" | "paused" | "stopped" | "planning" | "planned" | "generating" | "ready" | "error";

export type TimelineEventType =
  | "recording-started"
  | "recording-paused"
  | "recording-resumed"
  | "recording-stopped"
  | "click"
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

export interface ScreenPoint {
  x: number;
  y: number;
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
  point?: ScreenPoint;
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
  transcript?: TranscriptionResult;
  captureAnalysis?: CaptureAnalysis;
  /** A capture remains usable when planning fails; this is retryable metadata. */
  analysisError?: string;
  /** Local export is optional, but the UI should not hide a failed export. */
  localExportWarning?: string;
  openAiUsage?: OpenAiUsage;
  error?: string;
}

export interface TranscriptionResult {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface CaptureAnalysis {
  userGoal: string;
  keyPoints?: string[];
  /** Legacy plan fields retained while old local captures are migrated. */
  bestDelivery?: string;
  breakingPoints?: string[];
  helpfulImageMoments: Array<{
    screenshotId?: string;
    atSeconds: number;
    reason: string;
  }>;
  story: string;
  storySteps?: CaptureStoryStep[];
}

export interface CaptureStoryStep {
  startSeconds: number;
  endSeconds: number;
  title: string;
  narrative: string;
  transcript: string;
  screenshotId?: string;
  pageUrl?: string;
  pageTitle?: string;
  kind?: "narration" | "page-change" | "action" | "manual";
}

export type RuntimeMessage =
  | { type: "GET_SESSION" }
  | { type: "PREPARE_CAPTURE_PLAN" }
  | { type: "GENERATE_PDF" }
  | { type: "TEST_AI_SETUP"; apiKey?: string }
  | { type: "SET_OVERLAY_MODE"; mode: OverlayMode }
  | { type: "CONTENT_RECT_CREATED"; rect: Rect }
  | { type: "CONTENT_CLEAR_ANNOTATIONS" }
  | { type: "CONTENT_CLICKED"; point: ScreenPoint }
  | { type: "CONTENT_PAGE_INFO"; url: string; title: string };

export type OverlayMode = "off" | "highlight" | "redact" | "cursor";

export interface Settings {
  openAiKey?: string;
  email?: string;
  uniqueId?: string;
  retentionDays?: number;
  microphoneEnabledAt?: number;
  selectedMicrophoneId?: string;
  privateMode?: boolean;
  captureHistory?: CaptureHistoryItem[];
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
  imageCount: number;
  durationSeconds: number;
  hasPlan: boolean;
  hasPdf: boolean;
  session: RecordingSession;
}
