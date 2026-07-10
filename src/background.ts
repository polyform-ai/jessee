import { createDownload, createTicketPdf, ticketPdfFilename } from "./pdf";
import { artifactRef, hydrateSession, putArtifact } from "./artifacts";
import { analyzeCapture, generateTicket, transcribeAudio } from "./openai";
import { getSession, getSettings, resetSession, saveSession } from "./storage";
import { getSelectedTemplate } from "./templates";
import type { RecordingSession, RuntimeMessage, TimelineEvent } from "./types";
import { postWebhook } from "./webhook";

const OFFSCREEN_URL = "offscreen.html";
let recorderPort: chrome.runtime.Port | undefined;
let recorderReady = false;
let recorderReadyResolver: (() => void) | undefined;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "recorder") return;
  recorderPort = port;
  recorderReady = false;
  port.onDisconnect.addListener(() => {
    if (recorderPort === port) {
      recorderPort = undefined;
      recorderReady = false;
    }
  });
  port.onMessage.addListener((message: { type: string; videoDataUrl?: string; audioDataUrl?: string; error?: string; event?: string }) => {
    void handleRecorderMessage(message);
  });
});

chrome.action.onClicked.addListener(() => {
  void openRecorderPanel();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function openRecorderPanel(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(async (error: unknown) => {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      const session = await setError(message);
      sendResponse({ ok: false, error: message, session });
    });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !tab.title) return;
  const session = await getSession();
  if (session.status !== "recording" || session.activeTabId !== tabId) return;
  if (changeInfo.status === "complete") await sendToTab(tabId, { type: "SET_OVERLAY_MODE", mode: "cursor" });
  await appendEvent("url-change", tabId, `Navigated to ${tab.url ?? changeInfo.url ?? ""}`);
  await captureScreenshot("url-change");
});

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "GET_SESSION":
      return { ok: true, session: await getSession() };
    case "START_RECORDING":
      return startRecording(message.includeMic, message.cursorHalo);
    case "PAUSE_RECORDING":
      recorderPort?.postMessage({ type: "PAUSE_RECORDING" });
      await appendEvent("recording-paused");
      return { ok: true, session: await updateStatus("paused") };
    case "RESUME_RECORDING":
      recorderPort?.postMessage({ type: "RESUME_RECORDING" });
      await appendEvent("recording-resumed");
      return { ok: true, session: await updateStatus("recording") };
    case "STOP_RECORDING":
      recorderPort?.postMessage({ type: "STOP_RECORDING" });
      await appendEvent("recording-stopped");
      return { ok: true, session: await updateStatus("stopped") };
    case "CAPTURE_MOMENT":
      await appendEvent("manual-capture", undefined, message.note);
      return { ok: true, session: await captureScreenshot("manual-capture") };
    case "SET_OVERLAY_MODE":
      await sendToActiveTab({ type: "SET_OVERLAY_MODE", mode: message.mode });
      return { ok: true };
    case "CONTENT_RECT_CREATED":
      await appendEvent(message.rect.kind === "redaction" ? "redaction" : "annotation", sender.tab?.id, message.rect.label, message.rect);
      return { ok: true, session: await captureScreenshot("annotation") };
    case "CONTENT_PAGE_INFO":
      return { ok: true };
    case "OFFSCREEN_STOPPED":
      return finishRecording(message.videoDataUrl, message.audioDataUrl);
    case "OFFSCREEN_ERROR":
      return { ok: true, session: await setError(message.error) };
    case "GENERATE_TICKET":
      return generateTicketArtifact();
    case "PREPARE_CAPTURE_PLAN":
      return prepareCapturePlanArtifact();
    case "DOWNLOAD_PDF": {
      const session = await getSession();
      if (!session.ticket) throw new Error("Generate a ticket before downloading a PDF.");
      const hydrated = await hydrateSession(session);
      await createDownload(createTicketPdf(hydrated.ticket!, hydrated), ticketPdfFilename(session.ticket), "application/pdf");
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

async function prepareCapturePlanArtifact(): Promise<unknown> {
  const settings = await getSettings();
  if (!settings.openAiKey) throw new Error("Add your OpenAI API key in settings first.");
  const template = getSelectedTemplate(settings);

  const planning = await updateStatus("planning");
  try {
    const hydrated = await hydrateSession(planning);
    const transcript = await transcribeAudio(settings.openAiKey, hydrated.audioDataUrl);
    const generated = await analyzeCapture(settings.openAiKey, transcript, template, hydrated);
    const session = {
      ...planning,
      templateId: template.id,
      status: "planned" as const,
      captureAnalysis: generated.analysis,
      openAiUsage: generated.usage
    };
    await saveSession(session);
    return { ok: true, session };
  } catch (error) {
    await setError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function startRecording(includeMic: boolean, cursorHalo: boolean): Promise<unknown> {
  const tab = await getCaptureTargetTab();
  if (!tab.id || !tab.windowId) throw new Error("No active tab found.");

  await ensureOffscreenDocument();
  const streamId = await getMediaStreamId(tab.id);

  const session = await resetSession();
  const next: RecordingSession = {
    ...session,
    status: "recording",
    startedAt: Date.now(),
    activeTabId: tab.id,
    activeWindowId: tab.windowId,
    tabUrl: tab.url,
    tabTitle: tab.title
  };
  await saveSession(next);

  recorderPort?.postMessage({ type: "START_RECORDING", streamId, includeMic, source: "tab" });
  await sendToActiveTab({ type: "SET_OVERLAY_MODE", mode: cursorHalo ? "cursor" : "off" });
  await appendEvent("recording-started", tab.id);
  await captureScreenshot("recording-started");
  return { ok: true, session: await getSession() };
}

async function finishRecording(videoDataUrl: string, audioDataUrl?: string): Promise<unknown> {
  const session = await getSession();
  const next: RecordingSession = {
    ...session,
    status: "stopped",
    stoppedAt: Date.now(),
    videoDataUrl,
    audioDataUrl
  };
  await saveSession(next);
  await postWebhook(await getSettings(), "stopped_recording", {
    recording_seconds: elapsedSeconds(next),
    image_count: next.screenshots.length
  });
  return { ok: true, session: next };
}

async function handleRecorderMessage(message: { type: string; videoDataUrl?: string; audioDataUrl?: string; error?: string; event?: string }): Promise<void> {
  if (message.type === "OFFSCREEN_TRACE" && message.event) {
    await appendRecorderTrace(message.event);
  }
  if (message.type === "OFFSCREEN_READY") {
    recorderReady = true;
    recorderReadyResolver?.();
    recorderReadyResolver = undefined;
  }
  if (message.type === "OFFSCREEN_STOPPED" && message.videoDataUrl) {
    await finishRecording(message.videoDataUrl, message.audioDataUrl);
  }
  if (message.type === "OFFSCREEN_ERROR") {
    await setError(message.error ?? "Capture failed.");
  }
}

async function appendRecorderTrace(event: string): Promise<void> {
  const stored = await chrome.storage.local.get("recorderTrace");
  const recorderTrace = [...((stored.recorderTrace as string[] | undefined) ?? []), `${Date.now()}:${event}`].slice(-20);
  await chrome.storage.local.set({ recorderTrace });
}

async function generateTicketArtifact(): Promise<unknown> {
  const settings = await getSettings();
  if (!settings.openAiKey) throw new Error("Add your OpenAI API key in settings first.");
  const template = getSelectedTemplate(settings);

  const generating = await updateStatus("generating");
  try {
    const hydrated = await hydrateSession(generating);
    const transcript = await transcribeAudio(settings.openAiKey, hydrated.audioDataUrl);
    const generated = await generateTicket(settings.openAiKey, { ...hydrated, templateId: template.id }, transcript, template, hydrated.captureAnalysis);
    const ticket = { ...generated.ticket, templateName: generated.ticket.templateName ?? template.name };
    const session = {
      ...generating,
      templateId: template.id,
      status: "ready" as const,
      ticket,
      captureAnalysis: generated.analysis,
      openAiUsage: {
        inputTokens: (generating.openAiUsage?.inputTokens ?? 0) + generated.usage.inputTokens,
        outputTokens: (generating.openAiUsage?.outputTokens ?? 0) + generated.usage.outputTokens,
        totalTokens: (generating.openAiUsage?.totalTokens ?? 0) + generated.usage.totalTokens,
        estimatedCostUsd: Math.round(((generating.openAiUsage?.estimatedCostUsd ?? 0) + generated.usage.estimatedCostUsd) * 1_000_000) / 1_000_000
      }
    };
    await saveSession(session);
    return { ok: true, session };
  } catch (error) {
    await setError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function captureScreenshot(reason: string): Promise<RecordingSession> {
  const session = await getSession();
  if (!session.activeWindowId) return session;
  const tab = session.activeTabId ? await chrome.tabs.get(session.activeTabId) : undefined;
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(session.activeWindowId, { format: "png" });
  } catch (error) {
    console.warn(`Screenshot skipped: ${error instanceof Error ? error.message : String(error)}`);
    return session;
  }
  const latestRect = [...session.timeline].reverse().find((event) => event.rect)?.rect;
  const id = crypto.randomUUID();
  const artifactKey = `screenshot:${id}`;
  await putArtifact(artifactKey, dataUrl);
  const screenshot = {
    id,
    capturedAtMs: elapsedMs(session),
    url: tab?.url ?? session.tabUrl ?? "",
    title: tab?.title ?? session.tabTitle ?? "",
    dataUrl: artifactRef(artifactKey),
    annotations: latestRect?.kind !== "redaction" && latestRect ? [latestRect] : [],
    redactions: latestRect?.kind === "redaction" && latestRect ? [latestRect] : []
  };
  const next: RecordingSession = {
    ...session,
    screenshots: [...session.screenshots, screenshot],
    timeline: session.timeline.map((event, index) =>
      index === session.timeline.length - 1 ? { ...event, screenshotId: screenshot.id, note: event.note ?? reason } : event
    )
  };
  await saveSession(next);
  return next;
}

async function appendEvent(
  type: TimelineEvent["type"],
  tabId?: number,
  note?: string,
  rect?: TimelineEvent["rect"]
): Promise<void> {
  const session = await getSession();
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
  const event: TimelineEvent = {
    id: crypto.randomUUID(),
    type,
    atMs: elapsedMs(session),
    url: tab?.url ?? session.tabUrl ?? "",
    title: tab?.title ?? session.tabTitle ?? "",
    note,
    rect
  };
  await saveSession({ ...session, timeline: [...session.timeline, event] });
}

function elapsedMs(session: RecordingSession): number {
  return session.startedAt ? Date.now() - session.startedAt : 0;
}

function elapsedSeconds(session: RecordingSession): number {
  if (!session.startedAt) return 0;
  return Math.max(0, Math.round(((session.stoppedAt ?? Date.now()) - session.startedAt) / 1000));
}

async function updateStatus(status: RecordingSession["status"]): Promise<RecordingSession> {
  const session = await getSession();
  const next = { ...session, status };
  await saveSession(next);
  return next;
}

async function setError(error: string): Promise<RecordingSession> {
  const session = await getSession();
  const next = { ...session, status: "error" as const, error };
  await saveSession(next);
  return next;
}

async function sendToActiveTab(message: unknown): Promise<void> {
  const tab = await getCaptureTargetTab().catch(() => undefined);
  if (!tab?.id) return;
  await sendToTab(tab.id, message);
}

async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["assets/content.js"] }).catch(() => undefined);
    await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  }
}

async function getCaptureTargetTab(): Promise<chrome.tabs.Tab> {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activePageTab = activeTabs.find(isCapturableTab);
  if (activePageTab) return activePageTab;

  const normalWindowTabs = await chrome.tabs.query({ windowType: "normal" });
  const fallback = [...normalWindowTabs].reverse().find(isCapturableTab);
  if (fallback) return fallback;

  throw new Error("Open a normal web page tab before starting a capture.");
}

function isCapturableTab(tab: chrome.tabs.Tab): boolean {
  if (!tab.id || !tab.url) return false;
  return /^https?:\/\//.test(tab.url);
}

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture tab video and microphone narration for document generation."
    });
  }
  await waitForRecorderPort();
}

function waitForRecorderPort(): Promise<void> {
  if (recorderPort && recorderReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    recorderReadyResolver = resolve;
    setTimeout(() => {
      if (recorderPort && recorderReady) resolve();
      else reject(new Error("Capture document did not become ready."));
    }, 3000);
  });
}

function getMediaStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(streamId);
    });
  });
}
