import { hydrateSession } from "./artifacts";
import { writeRecordingBlob, writeRecordingText } from "./localFiles";
import { createTicketPdf, ticketPdfFilename } from "./pdf";
import { getSettings } from "./storage";
import { getSelectedTemplate } from "./templates";
import type { RecordingSession } from "./types";
import { postWebhook } from "./webhook";

export async function downloadTicketPdf(current: RecordingSession): Promise<void> {
  if (!current.ticket) return;
  const conversionStartedAt = performance.now();
  const hydrated = await hydrateSession(current);
  const blob = createTicketPdf(hydrated.ticket!, hydrated);
  const filename = ticketPdfFilename(current.ticket);
  await writeRecordingBlob(filename, blob);
  await writeRecordingText("ticket.json", JSON.stringify(current.ticket, null, 2), "application/json");
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
    template_name: current.ticket.templateName ?? getSelectedTemplate(settings).name,
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
