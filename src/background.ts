import { analyzeCapture, generateTicket, testOpenAiSetup, transcribeAudio } from "./openai";
import { hydrateSession } from "./artifacts";
import { getSession, getSettings, saveSession } from "./storage";
import { getSelectedTemplate, templateSignature } from "./templates";
import { acceptsContentEvent } from "./captureState";
import type { RecordingSession, RuntimeMessage, TimelineEvent } from "./types";

chrome.action.onClicked.addListener(() => {
  void openRecorderPanel();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      const session = await preserveCaptureFailure(message);
      sendResponse({ ok: false, error: message, session });
    });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !tab.title && changeInfo.status !== "complete") return;
  const session = await getSession();
  if (session.status !== "recording" || session.activeTabId !== tabId) return;
  if (changeInfo.status === "complete") await sendToTab(tabId, { type: "SET_OVERLAY_MODE", mode: "cursor" });
  await appendEvent("url-change", tabId, `Navigated to ${tab.url ?? changeInfo.url ?? ""}`);
});

async function openRecorderPanel(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case "GET_SESSION":
      return { ok: true, session: await getSession() };
    case "SET_OVERLAY_MODE":
      await sendToCaptureTab({ type: "SET_OVERLAY_MODE", mode: message.mode });
      return { ok: true };
    case "CONTENT_RECT_CREATED":
      if (!acceptsContentEvent(await getSession(), sender.tab?.id)) return { ok: true, session: await getSession() };
      await appendEvent(message.rect.kind === "redaction" ? "redaction" : "annotation", sender.tab?.id, message.rect.label, message.rect);
      return { ok: true, session: await getSession() };
    case "CONTENT_CLICKED":
      if (!acceptsContentEvent(await getSession(), sender.tab?.id)) return { ok: true, session: await getSession() };
      await appendEvent("click", sender.tab?.id, `Clicked at ${Math.round(message.point.x)}, ${Math.round(message.point.y)}`, undefined, message.point);
      return { ok: true, session: await getSession() };
    case "CONTENT_PAGE_INFO":
      return { ok: true };
    case "PREPARE_CAPTURE_PLAN":
      return prepareCapturePlanArtifact();
    case "GENERATE_TICKET":
      return generateTicketArtifact();
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
  const template = getSelectedTemplate(settings);
  const current = await getSession();
  const planning = { ...current, status: "planning" as const, analysisError: undefined };
  await saveSession(planning);
  try {
    const hydrated = await hydrateSession(planning);
    const transcript = await transcribeAudio(settings.openAiKey, hydrated.audioDataUrl);
    const generated = await analyzeCapture(settings.openAiKey, transcript, template, hydrated);
    const session: RecordingSession = {
      ...planning,
      templateId: template.id,
      captureAnalysisTemplateSignature: templateSignature(template),
      status: "planned",
      captureAnalysis: generated.analysis,
      ticket: undefined,
      analysisError: undefined,
      openAiUsage: generated.usage
    };
    await saveSession(session);
    return { ok: true, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSession({ ...current, analysisError: message });
    throw error;
  }
}

async function generateTicketArtifact(): Promise<unknown> {
  const settings = await getSettings();
  if (!settings.openAiKey) throw new Error("Add your OpenAI API key in Settings first.");
  const template = getSelectedTemplate(settings);
  const current = await getSession();
  if (!current.captureAnalysis || current.captureAnalysisTemplateSignature !== templateSignature(template)) {
    throw new Error("The template changed after this plan was created. Replan the capture before generating the PDF.");
  }
  const generating = { ...current, status: "generating" as const, analysisError: undefined };
  await saveSession(generating);
  try {
    const hydrated = await hydrateSession(generating);
    const transcript = await transcribeAudio(settings.openAiKey, hydrated.audioDataUrl);
    const generated = await generateTicket(settings.openAiKey, { ...hydrated, templateId: template.id }, transcript, template, hydrated.captureAnalysis, settings.privateMode ?? false);
    const ticket = { ...generated.ticket, templateName: generated.ticket.templateName ?? template.name };
    const session: RecordingSession = {
      ...generating,
      templateId: template.id,
      status: "ready",
      ticket,
      captureAnalysis: generated.analysis,
      analysisError: undefined,
      openAiUsage: addUsage(generating, generated.usage)
    };
    await saveSession(session);
    return { ok: true, session };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSession({ ...current, analysisError: message });
    throw error;
  }
}

function addUsage(session: RecordingSession, usage: NonNullable<RecordingSession["openAiUsage"]>): NonNullable<RecordingSession["openAiUsage"]> {
  const previous = session.openAiUsage;
  return {
    inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
    outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
    totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
    estimatedCostUsd: Math.round(((previous?.estimatedCostUsd ?? 0) + usage.estimatedCostUsd) * 1_000_000) / 1_000_000
  };
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
