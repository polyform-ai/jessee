import { upsertCaptureHistory } from "./storage";
import type { RecordingSession } from "./types";

export async function saveCaptureHistory(current: RecordingSession): Promise<void> {
  if (!current.startedAt) return;
  await upsertCaptureHistory({
    id: current.captureId ?? `${current.startedAt}`,
    title: current.captureAnalysis?.userGoal || current.tabTitle || "JesSee capture",
    folderName: current.exportFolderName,
    createdAt: current.startedAt,
    stoppedAt: current.stoppedAt,
    imageCount: current.screenshots.length,
    durationSeconds: recordingSeconds(current),
    hasPlan: Boolean(current.captureAnalysis),
    hasPdf: current.status === "ready",
    session: current
  });
}

function recordingSeconds(current: RecordingSession): number {
  if (!current.startedAt) return 0;
  return Math.max(0, Math.round(((current.stoppedAt ?? Date.now()) - current.startedAt) / 1000));
}
