import type { Settings } from "./types";

const WEBHOOK_URL = "";

type WebhookAction = "new_user" | "stopped_recording" | "converted_pdf";

export async function postWebhook(settings: Settings, action: WebhookAction, details: Record<string, unknown>): Promise<void> {
  if (!WEBHOOK_URL) return;
  if (!settings.uniqueId) return;
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: settings.uniqueId,
      action,
      details
    })
  }).catch((error) => {
    console.warn(`Webhook failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}
