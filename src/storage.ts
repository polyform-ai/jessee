import type { CaptureHistoryItem, RecordingSession, Settings } from "./types";
import { DEFAULT_TEMPLATE_ID } from "./templates";

const SESSION_KEY = "recordingSession";
const SETTINGS_KEY = "settings";

export const emptySession = (): RecordingSession => ({
  status: "idle",
  timeline: [],
  screenshots: []
});

export async function getSession(): Promise<RecordingSession> {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return (stored[SESSION_KEY] as RecordingSession | undefined) ?? emptySession();
}

export async function saveSession(session: RecordingSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

export async function resetSession(): Promise<RecordingSession> {
  const session = emptySession();
  await saveSession(session);
  return session;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings((stored[SETTINGS_KEY] as Settings | undefined) ?? {});
}

export async function saveSettings(settings: Settings): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings({ ...current, ...settings }) });
}

export async function clearApiKey(): Promise<void> {
  const settings = await getSettings();
  delete settings.openAiKey;
  await saveSettings(settings);
}

function normalizeSettings(settings: Settings): Settings {
  return {
    ...settings,
    uniqueId: settings.uniqueId ?? crypto.randomUUID(),
    selectedTemplateId: settings.selectedTemplateId ?? DEFAULT_TEMPLATE_ID,
    customTemplates: settings.customTemplates ?? [],
    retentionDays: settings.retentionDays ?? 30,
    captureHistory: settings.captureHistory ?? []
  };
}

export async function upsertCaptureHistory(item: CaptureHistoryItem): Promise<void> {
  const settings = await getSettings();
  const nextHistory = [item, ...(settings.captureHistory ?? []).filter((existing) => existing.id !== item.id)].slice(0, 50);
  await saveSettings({ captureHistory: nextHistory });
}

export async function pruneCaptureHistory(retentionDays: number): Promise<void> {
  if (retentionDays <= 0) return;
  const settings = await getSettings();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await saveSettings({
    captureHistory: (settings.captureHistory ?? []).filter((item) => item.createdAt >= cutoff)
  });
}
