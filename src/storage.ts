import type { CaptureHistoryItem, RecordingSession, Settings } from "./types";
import { deleteSessionArtifacts } from "./artifacts";
import { sessionIsInUse } from "./storyEditorTabs";

const SESSION_KEY = "recordingSession";
const SETTINGS_KEY = "settings";
const SETTINGS_MUTATION_LOCK = "jessee-settings-mutation";

let fallbackSettingsMutation = Promise.resolve();

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
  await withSettingsMutation(async () => {
    const current = await getSettings();
    await writeSettings({ ...current, ...settings });
  });
}

export async function clearApiKey(): Promise<void> {
  await withSettingsMutation(async () => {
    const settings = await getSettings();
    delete settings.openAiKey;
    await writeSettings(settings);
  });
}

function normalizeSettings(settings: Settings): Settings {
  const legacy = settings as Settings & { selectedTemplateId?: unknown; customTemplates?: unknown };
  const { selectedTemplateId: _selectedTemplateId, customTemplates: _customTemplates, ...activeSettings } = legacy;
  return {
    ...activeSettings,
    uniqueId: settings.uniqueId ?? crypto.randomUUID(),
    retentionDays: settings.retentionDays ?? 30,
    captureHistory: settings.captureHistory ?? []
  };
}

export async function upsertCaptureHistory(item: CaptureHistoryItem): Promise<void> {
  await withSettingsMutation(async () => {
    const settings = await getSettings();
    const candidates = [item, ...(settings.captureHistory ?? []).filter((existing) => existing.id !== item.id)];
    await writeSettings({ ...settings, captureHistory: candidates.slice(0, 50) });
    await deleteHistoryArtifacts(candidates.slice(50));
  });
}

export async function getCaptureRetentionProtection(retentionDays: number): Promise<{ captureId?: string; exportFolderName?: string }> {
  const currentSession = await getSession();
  if (!await sessionIsInUse(currentSession)) {
    const sessionEndedAt = currentSession.stoppedAt ?? currentSession.startedAt;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    if (sessionEndedAt && sessionEndedAt < cutoff) await resetSession();
    return {};
  }
  return {
    captureId: currentSession.captureId ?? (currentSession.startedAt ? `${currentSession.startedAt}` : undefined),
    exportFolderName: currentSession.exportFolderName
  };
}

export async function pruneCaptureHistory(retentionDays: number, protectedCaptureId?: string): Promise<void> {
  if (retentionDays <= 0) return;
  await withSettingsMutation(async () => {
    const settings = await getSettings();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const expired = (settings.captureHistory ?? []).filter((item) => item.createdAt < cutoff && item.id !== protectedCaptureId);
    await writeSettings({
      ...settings,
      captureHistory: (settings.captureHistory ?? []).filter((item) => item.createdAt >= cutoff || item.id === protectedCaptureId)
    });
    await deleteHistoryArtifacts(expired);
  });
}

async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

async function withSettingsMutation<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return navigator.locks.request(SETTINGS_MUTATION_LOCK, { mode: "exclusive" }, run);
  }

  const previous = fallbackSettingsMutation;
  let release: () => void = () => undefined;
  fallbackSettingsMutation = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

async function deleteHistoryArtifacts(items: CaptureHistoryItem[]): Promise<void> {
  const results = await Promise.allSettled(items.map((item) => deleteSessionArtifacts(item.session)));
  for (const result of results) {
    if (result.status === "rejected") console.warn("Could not delete expired capture artifacts", result.reason);
  }
}
