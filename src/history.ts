import "./ui.css";
import { getArtifact, hydrateSession } from "./artifacts";
import { saveCaptureHistory } from "./captureHistory";
import { downloadPlanPdf } from "./pdfDownload";
import { sendRuntimeMessage } from "./runtimeMessaging";
import { getSettings, resetSession, saveSession } from "./storage";
import type { CaptureHistoryItem, RecordingSession, ScreenshotEvidence } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

let history: CaptureHistoryItem[] = [];
let thumbnails = new Map<string, string>();
let preview: { item: CaptureHistoryItem; session: RecordingSession } | undefined;
let message = "";
let busyCaptureId: string | undefined;

void initialize();

async function initialize(): Promise<void> {
  const settings = await getSettings();
  history = [...(settings.captureHistory ?? [])].sort((left, right) => right.createdAt - left.createdAt);
  thumbnails = new Map(await Promise.all(history.map(async (item) => {
    const screenshot = selectedScreenshot(item.session);
    return [item.id, screenshot ? (await getArtifact(screenshot.dataUrl) ?? "") : ""] as const;
  })));
  render();
}

function render(): void {
  root.innerHTML = `
    <main class="history-page">
      <header class="library-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Walkthrough library</p>
            <h1>Your explanations stay useful.</h1>
            <p class="hint">Return to any local recording, reshape its story, and download a fresh PDF.</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="button secondary compact" id="backToCapture">Back to capture</button>
          <button class="button primary compact" id="newCapture">New capture</button>
        </div>
      </header>

      <section class="library-shell" aria-labelledby="libraryHeading">
        <div class="library-intro">
          <div>
            <p class="section-eyebrow">Saved locally</p>
            <h2 id="libraryHeading">${history.length} walkthrough${history.length === 1 ? "" : "s"}</h2>
          </div>
          ${history.length ? `<label class="library-search"><span>Search recordings</span><input id="historySearch" type="search" placeholder="Search by title or page" /></label>` : ""}
        </div>
        ${message ? `<p class="library-message" role="status">${escapeHtml(message)}</p>` : ""}
        ${history.length ? `<div class="history-grid">${history.map(renderHistoryCard).join("")}</div>` : renderEmptyLibrary()}
      </section>
      ${preview ? renderPreview(preview.item, preview.session) : ""}
    </main>`;

  bindEvents();
  const dialog = document.querySelector<HTMLDialogElement>("#recordingPreview");
  if (dialog && !dialog.open) dialog.showModal();
}

function renderHistoryCard(item: CaptureHistoryItem): string {
  const thumbnail = thumbnails.get(item.id);
  const session = item.session;
  const storySteps = session.captureAnalysis?.storySteps?.length ?? 0;
  const pageContext = session.tabTitle || session.tabUrl || item.folderName || "Local capture";
  const hasRecording = Boolean(session.videoDataUrl || session.audioDataUrl || session.transcript?.text);
  const busy = busyCaptureId === item.id;
  return `<article class="history-card" data-history-card data-search="${escapeHtml(`${item.title} ${pageContext}`.toLowerCase())}">
    <div class="history-card-visual">
      ${thumbnail ? `<img src="${thumbnail}" alt="Captured screen from ${escapeHtml(item.title)}" loading="lazy" />` : `<div class="history-card-placeholder"><img src="/icon.svg" alt="" /><span>Text-led walkthrough</span></div>`}
      <span class="history-state ${item.hasPlan ? "planned" : "captured"}">${item.hasPlan ? "Story ready" : "Recording saved"}</span>
    </div>
    <div class="history-card-body">
      <div class="history-card-heading">
        <div><p>${escapeHtml(formatHistoryDate(item.createdAt))}</p><h3>${escapeHtml(item.title)}</h3></div>
        <span>${escapeHtml(formatSeconds(item.durationSeconds))}</span>
      </div>
      <p class="history-page-context">${escapeHtml(pageContext)}</p>
      <div class="history-card-meta">
        <span><strong>${item.imageCount}</strong> images</span>
        <span><strong>${storySteps}</strong> steps</span>
        <span><strong>${item.hasPdf ? "PDF" : "Local"}</strong> ${item.hasPdf ? "generated" : "saved"}</span>
      </div>
      <div class="history-card-actions">
        <button class="button primary" data-edit-capture="${escapeHtml(item.id)}" ${busy ? "disabled" : ""}>${item.hasPlan ? "Edit story" : "Create story"}</button>
        ${item.hasPlan ? `<button class="button secondary" data-download-capture="${escapeHtml(item.id)}" ${busy ? "disabled" : ""}>${busy ? "Preparing PDF…" : "Download PDF"}</button>` : ""}
        ${hasRecording ? `<button class="history-text-action" data-preview-capture="${escapeHtml(item.id)}" ${busy ? "disabled" : ""}>View recording</button>` : ""}
      </div>
    </div>
  </article>`;
}

function renderEmptyLibrary(): string {
  return `<div class="library-empty">
    <img src="/icon.svg" alt="" />
    <h3>Your walkthroughs will collect here.</h3>
    <p>Record an explanation once. JesSee will keep the recording, selected screens, editable story, and PDF together on this computer.</p>
    <button class="button primary" id="emptyNewCapture">Create your first walkthrough</button>
  </div>`;
}

function renderPreview(item: CaptureHistoryItem, session: RecordingSession): string {
  const recording = session.videoDataUrl
    ? `<video controls playsinline src="${session.videoDataUrl}"></video>`
    : session.audioDataUrl
      ? `<audio controls src="${session.audioDataUrl}"></audio>`
      : `<div class="recording-preview-empty">This walkthrough has a transcript and screenshots, but no retained media file.</div>`;
  const transcript = session.transcript?.text?.trim();
  return `<dialog class="recording-dialog" id="recordingPreview" aria-labelledby="recordingPreviewTitle">
    <div class="recording-dialog-card">
      <div class="recording-dialog-header">
        <div><p class="section-eyebrow">${escapeHtml(formatHistoryDate(item.createdAt))}</p><h2 id="recordingPreviewTitle">${escapeHtml(item.title)}</h2></div>
        <button class="icon-button" id="closeRecordingPreview" aria-label="Close recording preview">×</button>
      </div>
      <div class="recording-player">${recording}</div>
      ${transcript ? `<section class="recording-transcript"><p class="section-eyebrow">Transcript</p><p>${escapeHtml(transcript)}</p></section>` : ""}
      <div class="recording-dialog-actions">
        <button class="button secondary" data-edit-capture="${escapeHtml(item.id)}">Edit this story</button>
        ${item.hasPlan ? `<button class="button primary" data-download-capture="${escapeHtml(item.id)}">Download PDF</button>` : ""}
      </div>
    </div>
  </dialog>`;
}

function bindEvents(): void {
  document.querySelector("#backToCapture")?.addEventListener("click", openCapture);
  document.querySelector("#newCapture")?.addEventListener("click", startNewCapture);
  document.querySelector("#emptyNewCapture")?.addEventListener("click", startNewCapture);
  document.querySelector<HTMLInputElement>("#historySearch")?.addEventListener("input", (event) => {
    const query = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    for (const card of document.querySelectorAll<HTMLElement>("[data-history-card]")) {
      card.hidden = !String(card.dataset.search).includes(query);
    }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-edit-capture]")) {
    button.addEventListener("click", () => void editCapture(button.dataset.editCapture ?? ""));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-download-capture]")) {
    button.addEventListener("click", () => void downloadCapture(button.dataset.downloadCapture ?? ""));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preview-capture]")) {
    button.addEventListener("click", () => void previewCapture(button.dataset.previewCapture ?? ""));
  }
  document.querySelector("#closeRecordingPreview")?.addEventListener("click", closePreview);
  const dialog = document.querySelector<HTMLDialogElement>("#recordingPreview");
  dialog?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePreview();
  });
  dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePreview();
  });
}

async function editCapture(captureId: string): Promise<void> {
  const item = history.find((candidate) => candidate.id === captureId);
  if (!item) return;
  busyCaptureId = captureId;
  message = item.hasPlan ? "Opening the editable story…" : "Creating an editable story from this recording…";
  render();
  await saveSession(item.session);
  if (!item.hasPlan) {
    const response = await sendRuntimeMessage({ type: "PREPARE_CAPTURE_PLAN" });
    if (!response.ok || !response.session) {
      busyCaptureId = undefined;
      message = response.error ?? "JesSee could not create this story.";
      render();
      return;
    }
    await saveCaptureHistory(response.session);
  }
  window.location.assign(chrome.runtime.getURL("plan.html"));
}

async function downloadCapture(captureId: string): Promise<void> {
  const item = history.find((candidate) => candidate.id === captureId);
  if (!item?.session.captureAnalysis) return;
  busyCaptureId = captureId;
  message = "Preparing a fresh PDF from the saved story…";
  render();
  try {
    await downloadPlanPdf(item.session);
    const readySession: RecordingSession = { ...item.session, status: "ready" };
    await saveCaptureHistory(readySession);
    item.hasPdf = true;
    item.session = readySession;
    message = "PDF downloaded. The saved story is unchanged.";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busyCaptureId = undefined;
    render();
  }
}

async function previewCapture(captureId: string): Promise<void> {
  const item = history.find((candidate) => candidate.id === captureId);
  if (!item) return;
  busyCaptureId = captureId;
  message = "Loading the local recording…";
  render();
  try {
    preview = { item, session: await hydrateSession(item.session) };
    message = "";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busyCaptureId = undefined;
    render();
  }
}

function closePreview(): void {
  document.querySelector<HTMLDialogElement>("#recordingPreview")?.close();
  preview = undefined;
  render();
}

function openCapture(): void {
  window.location.assign(chrome.runtime.getURL("popup.html"));
}

async function startNewCapture(): Promise<void> {
  await resetSession();
  window.location.assign(chrome.runtime.getURL("popup.html"));
}

function selectedScreenshot(session: RecordingSession): ScreenshotEvidence | undefined {
  const selectedId = session.captureAnalysis?.storySteps?.find((step) => step.screenshotId)?.screenshotId
    ?? session.captureAnalysis?.helpfulImageMoments?.find((moment) => moment.screenshotId)?.screenshotId;
  return session.screenshots.find((screenshot) => screenshot.id === selectedId) ?? session.screenshots[0];
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatHistoryDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] ?? character);
}
