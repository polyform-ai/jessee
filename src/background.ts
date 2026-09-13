import { analyzeCapture, testOpenAiSetup, transcribeAudio } from "./openai";
import { deleteArtifacts, hydrateSession } from "./artifacts";
import { clearAnnotationEvidence } from "./captureEvidence";
import { getSession, getSettings, saveSession } from "./storage";
import { acceptsContentEvent, shouldRecordPageChange } from "./captureState";
import type { RecordingSession, RuntimeMessage, TimelineEvent } from "./types";

chrome.action.onClicked.addListener((tab) => {
  void openRecorder(tab);
});

chrome.runtime.onInstalled.addListener(() => {
  const sidePanel = getSidePanelApi();
  if (sidePanel) void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(async (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(errorMessage);
      const session = messageCanChangeCaptureState(message.type)
        ? await preserveCaptureFailure(errorMessage)
        : await getSession();
      sendResponse({ ok: false, error: errorMessage, session });
    });
  return true;
});

function messageCanChangeCaptureState(type: RuntimeMessage["type"]): boolean {
  return type === "PREPARE_CAPTURE_PLAN" || type === "GENERATE_PDF";
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const session = await getSession();
  if (session.status !== "recording" || session.activeTabId !== tabId) return;
  if (changeInfo.status === "complete") await sendToTab(tabId, { type: "SET_OVERLAY_MODE", mode: "cursor" });
  if (!shouldRecordPageChange(session, tab.url, changeInfo.url, changeInfo.status)) return;
  await appendEvent("url-change", tabId, `Navigated to ${tab.url ?? changeInfo.url ?? ""}`);
});

async function openRecorder(tab?: chrome.tabs.Tab, preferredWindowId?: number): Promise<void> {
  const session = await getSession();
  const retainedWindowId = preferredWindowId ?? session.activeWindowId;
  const retainedWindowExists = retainedWindowId ? await windowExists(retainedWindowId) : false;
  const sidePanel = getSidePanelApi();
  if (sidePanel && retainedWindowId && !retainedWindowExists && recorderIsActive(session)) {
    throw new Error("The original JesSee recorder window was closed during capture. Return to the capture recovery screen before starting another one.");
  }
  const recorderWindowId = retainedWindowExists ? retainedWindowId : undefined;
  const target = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!recorderWindowId && !recorderIsActive(session) && target?.id && target.url && /^https?:\/\//.test(target.url)) {
    await chrome.storage.local.set({ recorderTargetTabId: target.id });
  }

  const targetWindowId = recorderWindowId ?? target?.windowId;
  if (sidePanel && targetWindowId) {
    await sidePanel.open({ windowId: targetWindowId });
    if (recorderWindowId) await chrome.windows.update(recorderWindowId, { focused: true });
    return;
  }

  const recorderUrl = chrome.runtime.getURL("popup.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((candidate) => candidate.windowId === recorderWindowId && candidate.url?.startsWith(recorderUrl))
    ?? tabs.find((candidate) => candidate.url?.startsWith(recorderUrl));
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  if (retainedWindowId && recorderIsActive(session)) throw new Error("The original JesSee recorder is no longer open. Finish or recover that capture before starting another one.");
  await chrome.tabs.create({ url: recorderUrl, active: true });
}

function recorderIsActive(session: RecordingSession): boolean {
  return ["recording", "paused", "planning", "generating"].includes(session.status);
}

function windowExists(windowId: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.windows.get(windowId, (window) => {
        resolve(!chrome.runtime.lastError && Boolean(window));
      });
    } catch {
      resolve(false);
    }
  });
}

function getSidePanelApi(): Pick<typeof chrome.sidePanel, "open" | "setPanelBehavior"> | undefined {
  return (chrome as typeof chrome & { sidePanel?: typeof chrome.sidePanel }).sidePanel;
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "GET_SESSION":
      return { ok: true, session: await getSession() };
    case "OPEN_RECORDER":
      await openRecorder(undefined, message.windowId);
      return { ok: true, session: await getSession() };
    case "STOP_CAPTURE":
      return { ok: true, session: await getSession() };
    case "SET_OVERLAY_MODE":
      await sendToCaptureTab({ type: "SET_OVERLAY_MODE", mode: message.mode });
      return { ok: true };
    case "CONTENT_RECT_CREATED":
      if (!acceptsContentEvent(await getSession(), sender.tab?.id)) return { ok: true, session: await getSession() };
      await appendEvent(message.rect.kind === "redaction" ? "redaction" : "annotation", sender.tab?.id, message.rect.label, message.rect);
      return { ok: true, session: await getSession() };
    case "CONTENT_CLEAR_ANNOTATIONS": {
      const current = await getSession();
      if (!acceptsContentEvent(current, sender.tab?.id)) return { ok: true, session: current };
      const cleared = clearAnnotationEvidence(current);
      await saveSession(cleared.session);
      await deleteArtifacts(cleared.removedArtifactRefs);
      return { ok: true, session: cleared.session };
    }
    case "CONTENT_CLICKED":
      if (!acceptsContentEvent(await getSession(), sender.tab?.id)) return { ok: true, session: await getSession() };
      await appendEvent("click", sender.tab?.id, `Clicked at ${Math.round(message.point.x)}, ${Math.round(message.point.y)}`, undefined, message.point);
      return { ok: true, session: await getSession() };
    case "CONTENT_PAGE_INFO":
      return { ok: true };
    case "PREPARE_CAPTURE_PLAN":
      return prepareCapturePlanArtifact();
    case "GENERATE_PDF":
      return preparePdfArtifact();
    case "TEST_AI_SETUP": {
      const settings = await getSettings();
      const apiKey = message.apiKey ?? settings.openAiKey;
      if (!apiKey) throw new Error("Add your OpenAI API key in Settings first.");
      await testOpenAiSetup(apiKey);
      return { ok: true, session: await getSession() };
    }
  }
}

async function prepareCapturePlanArtifact(): Promise<unknown> {
  const settings = await getSettings();
  if (!settings.openAiKey) throw new Error("Add your OpenAI API key in Settings first.");
  const current = await getSession();
  const planning = { ...current, status: "planning" as const, autoPlanningPending: false, analysisError: undefined };
  await saveSession(planning);
  let transcript = current.transcript;
  try {
    const hydrated = await hydrateSession(planning);
    transcript = hydrated.transcript ?? await transcribeAudio(settings.openAiKey, hydrated.audioDataUrl);
    const transcribed = { ...planning, transcript };
    await saveSession(transcribed);
    const generated = await analyzeCapture(settings.openAiKey, transcript, hydrated, settings.privateMode ?? false);
    const session: RecordingSession = {
      ...transcribed,
      status: "planned",
      captureAnalysis: generated.analysis,
      transcript,
      analysisError: undefined,
      openAiUsage: generated.usage
    };
    await saveSession(session);
    return { ok: true, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSession({ ...current, autoPlanningPending: false, transcript, analysisError: message });
    throw error;
  }
}

async function preparePdfArtifact(): Promise<unknown> {
  const current = await getSession();
  if (!current.captureAnalysis) throw new Error("Create and review the plan before generating the PDF.");
  const generating = { ...current, status: "generating" as const, analysisError: undefined };
  await saveSession(generating);
  const ready: RecordingSession = { ...generating, status: "ready", analysisError: undefined };
  await saveSession(ready);
  return { ok: true, session: ready };
}

async function preserveCaptureFailure(error: string): Promise<RecordingSession> {
  const session = await getSession();
  if (session.screenshots.length || session.audioDataUrl || session.videoDataUrl) {
    const next = { ...session, status: session.status === "planning" || session.status === "generating" ? "stopped" as const : session.status, analysisError: error };
    await saveSession(next);
    return next;
  }
  const next = { ...session, status: "error" as const, error };
  await saveSession(next);
  return next;
}

async function appendEvent(
  type: TimelineEvent["type"],
  tabId?: number,
  note?: string,
  rect?: TimelineEvent["rect"],
  point?: TimelineEvent["point"]
): Promise<void> {
  const session = await getSession();
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
  const event: TimelineEvent = {
    id: crypto.randomUUID(), type, atMs: session.startedAt ? Date.now() - session.startedAt : 0,
    url: tab?.url ?? session.tabUrl ?? "", title: tab?.title ?? session.tabTitle ?? "", note, rect, point
  };
  await saveSession({
    ...session,
    tabUrl: tab?.url ?? session.tabUrl,
    tabTitle: tab?.title ?? session.tabTitle,
    timeline: [...session.timeline, event]
  });
}

async function sendToCaptureTab(message: unknown): Promise<void> {
  const session = await getSession();
  if (session.activeTabId) {
    await sendToTab(session.activeTabId, message);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await sendToTab(tab.id, message);
}

async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["assets/content.js"] }).catch(() => undefined);
    await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  }
}
