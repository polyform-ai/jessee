import { upsertCaptureHistory } from "./storage";
import type { CaptureHistoryItem, RecordingSession } from "./types";

export async function saveCaptureHistory(current: RecordingSession): Promise<void> {
  if (!current.startedAt) return;
  await upsertCaptureHistory(captureHistoryItem(current));
}

export async function saveCaptureSessionHistory(current: RecordingSession): Promise<void> {
  if (!current.startedAt) return;
  await upsertCaptureHistory(captureHistoryItem(current), current);
}

export function needsCaptureHistoryRecovery(current: RecordingSession, history: CaptureHistoryItem[]): boolean {
  if (!current.startedAt || !["stopped", "planned", "ready", "error"].includes(current.status)) return false;
  const hasRetainedContent = Boolean(
    current.screenshots.length
    || current.videoDataUrl
    || current.audioDataUrl
    || current.transcript?.text
    || current.captureAnalysis
  );
  if (!hasRetainedContent) return false;
  const captureId = current.captureId ?? `${current.startedAt}`;
  return !history.some((item) => item.id === captureId);
}

function captureHistoryItem(current: RecordingSession): CaptureHistoryItem {
  return {
    id: current.captureId ?? `${current.startedAt}`,
    title: current.captureAnalysis?.userGoal || current.tabTitle || "JesSee capture",
    folderName: current.exportFolderName,
    createdAt: current.startedAt!,
    stoppedAt: current.stoppedAt,
    imageCount: current.screenshots.length,
    durationSeconds: recordingSeconds(current),
    hasPlan: Boolean(current.captureAnalysis),
    hasPdf: current.status === "ready",
    session: current
  };
}

function recordingSeconds(current: RecordingSession): number {
  if (!current.startedAt) return 0;
  return Math.max(0, Math.round(((current.stoppedAt ?? Date.now()) - current.startedAt) / 1000));
}
