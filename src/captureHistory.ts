import { getSettings, upsertCaptureHistory } from "./storage";
import { getSelectedTemplate } from "./templates";
import type { RecordingSession } from "./types";

export async function saveCaptureHistory(current: RecordingSession, fallbackTemplateName?: string): Promise<void> {
  if (!current.startedAt) return;
  const templateName = current.ticket?.templateName ?? fallbackTemplateName ?? getSelectedTemplate(await getSettings()).name;
  await upsertCaptureHistory({
    id: current.captureId ?? `${current.startedAt}`,
    title: current.ticket?.title || current.captureAnalysis?.userGoal || current.tabTitle || "JesSee capture",
    folderName: current.exportFolderName,
    createdAt: current.startedAt,
    stoppedAt: current.stoppedAt,
    templateName,
    imageCount: current.screenshots.length,
    durationSeconds: recordingSeconds(current),
    hasPlan: Boolean(current.captureAnalysis),
    hasTicket: Boolean(current.ticket),
    session: current
  });
}

function recordingSeconds(current: RecordingSession): number {
  if (!current.startedAt) return 0;
  return Math.max(0, Math.round(((current.stoppedAt ?? Date.now()) - current.startedAt) / 1000));
}
