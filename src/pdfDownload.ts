import { hydrateSession } from "./artifacts";
import { startRecordingFolder, writeRecordingBlob, writeRecordingText } from "./localFiles";
import { createPlanPdf, planPdfFilename } from "./pdf";
import { getSettings } from "./storage";
import type { RecordingSession } from "./types";
import { postWebhook } from "./webhook";

export async function downloadPlanPdf(current: RecordingSession): Promise<void> {
  if (!current.captureAnalysis) return;
  const conversionStartedAt = performance.now();
  const hydrated = await hydrateSession(current);
  const blob = createPlanPdf(hydrated);
  const filename = planPdfFilename(current.captureAnalysis.userGoal || current.tabTitle || "visual-story");
  if (current.exportFolderName) {
    try {
      await startRecordingFolder(current.exportFolderName);
    } catch (error) {
      console.warn("Could not reconnect the local capture folder; continuing with the browser download.", error);
    }
  }
  await writeRecordingBlob(filename, blob);
  if (current.captureAnalysis) {
    await writeRecordingText("capture-analysis.json", JSON.stringify(current.captureAnalysis, null, 2), "application/json");
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);

  const settings = await getSettings();
  await postWebhook(settings, "converted_pdf", {
    image_count: hydrated.screenshots.length,
    recording_seconds: recordingSeconds(hydrated),
    conversion_ms: Math.round(performance.now() - conversionStartedAt),
    openai_tokens: current.openAiUsage?.totalTokens ?? 0,
    openai_input_tokens: current.openAiUsage?.inputTokens ?? 0,
    openai_output_tokens: current.openAiUsage?.outputTokens ?? 0,
    openai_estimated_cost_usd: current.openAiUsage?.estimatedCostUsd ?? 0
  });
}

function recordingSeconds(current: RecordingSession): number {
  if (!current.startedAt) return 0;
  return Math.max(0, Math.round(((current.stoppedAt ?? Date.now()) - current.startedAt) / 1000));
}
