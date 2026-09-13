import "./ui.css";
import { getArtifact, hydrateRecordingMedia } from "./artifacts";
import { saveCaptureHistory } from "./captureHistory";
import { downloadPlanPdf } from "./pdfDownload";
import { sendRuntimeMessage } from "./runtimeMessaging";
import { getSession, getSettings, resetSession, saveSession } from "./storage";
import { withStoryEditorOwnership } from "./storyEditorTabs";
import type { CaptureHistoryItem, RecordingSession, ScreenshotEvidence, Settings } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

let history: CaptureHistoryItem[] = [];
let thumbnails = new Map<string, string>();
let preview: { item: CaptureHistoryItem; session: RecordingSession } | undefined;
let message = "";
let busyCaptureId: string | undefined;
let activeCapture = false;
let thumbnailObserver: IntersectionObserver | undefined;

void initialize();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let changed = false;
  if (changes.settings) {
    const settings = changes.settings.newValue as Settings | undefined;
    const previousHistory = new Map(history.map((item) => [item.id, item]));
    const nextHistory = sortedHistory(settings?.captureHistory ?? []);
    history = nextHistory;
    const retainedIds = new Set(history.map((item) => item.id));
    thumbnails = new Map([...thumbnails].filter(([captureId]) => {
      const previous = previousHistory.get(captureId);
      const next = nextHistory.find((item) => item.id === captureId);
      return Boolean(previous && next && thumbnailSource(previous.session) === thumbnailSource(next.session));
    }));
    if (preview && !retainedIds.has(preview.item.id)) {
      preview = undefined;
      changed = true;
    } else if (!preview) {
      changed = true;
    }
  }
  if (changes.recordingSession) {
    const nextActiveCapture = isActiveCapture(changes.recordingSession.newValue as RecordingSession | undefined);
    if (nextActiveCapture !== activeCapture) {
      activeCapture = nextActiveCapture;
      if (activeCapture) message = activeCaptureMessage();
      else if (message === activeCaptureMessage()) message = "";
      changed = true;
    }
  }
  if (changed) render();
});

async function initialize(): Promise<void> {
  const [settings, session] = await Promise.all([getSettings(), getSession()]);
  history = sortedHistory(settings.captureHistory ?? []);
  activeCapture = isActiveCapture(session);
  if (activeCapture) message = activeCaptureMessage();
  render();
}

function render(): void {
  thumbnailObserver?.disconnect();
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
          <button class="button primary compact" id="newCapture" ${activeCapture ? "disabled" : ""}>${activeCapture ? "Capture in progress" : "New capture"}</button>
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
  observeThumbnails();
  const dialog = document.querySelector<HTMLDialogElement>("#recordingPreview");
  if (dialog && !dialog.open) dialog.showModal();
}

function renderHistoryCard(item: CaptureHistoryItem): string {
  const thumbnail = thumbnails.get(item.id);
  const thumbnailLoaded = thumbnails.has(item.id);
  const screenshot = selectedScreenshot(item.session);
  const session = item.session;
  const storySteps = session.captureAnalysis?.storySteps?.length ?? 0;
  const pageContext = session.tabTitle || session.tabUrl || item.folderName || "Local capture";
  const hasRecording = Boolean(session.videoDataUrl || session.audioDataUrl || session.transcript?.text);
  const busy = Boolean(busyCaptureId);
  const preparingThisCapture = busyCaptureId === item.id;
  return `<article class="history-card" data-history-card data-search="${escapeHtml(`${item.title} ${pageContext}`.toLowerCase())}">
    <div class="history-card-visual" ${screenshot && !thumbnails.has(item.id) ? `data-thumbnail-capture="${escapeHtml(item.id)}"` : ""}>
      ${thumbnail ? `<img src="${thumbnail}" alt="Captured screen from ${escapeHtml(item.title)}" loading="lazy" />` : `${screenshot ? `<img data-history-thumbnail data-thumbnail-image="${escapeHtml(item.id)}" alt="Captured screen from ${escapeHtml(item.title)}" hidden />` : ""}<div class="history-card-placeholder" data-thumbnail-placeholder="${escapeHtml(item.id)}"><img src="/icon.svg" alt="" /><span>${screenshot ? (thumbnailLoaded ? "Preview unavailable" : "Loading captured screen…") : "Text-led walkthrough"}</span></div>`}
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
        <button class="button primary" data-edit-capture="${escapeHtml(item.id)}" ${busy || activeCapture ? "disabled" : ""}>${item.hasPlan ? "Edit story" : "Create story"}</button>
        ${item.hasPlan ? `<button class="button secondary" data-download-capture="${escapeHtml(item.id)}" ${busy ? "disabled" : ""}>${preparingThisCapture ? "Preparing PDF…" : "Download PDF"}</button>` : ""}
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
    <button class="button primary" id="emptyNewCapture" ${activeCapture ? "disabled" : ""}>${activeCapture ? "Finish the active capture first" : "Create your first walkthrough"}</button>
  </div>`;
}

function renderPreview(item: CaptureHistoryItem, session: RecordingSession): string {
  const busy = Boolean(busyCaptureId);
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
        <button class="button secondary" data-edit-capture="${escapeHtml(item.id)}" ${activeCapture || busy ? "disabled" : ""}>Edit this story</button>
        ${item.hasPlan ? `<button class="button primary" data-download-capture="${escapeHtml(item.id)}" ${busy ? "disabled" : ""}>${busyCaptureId === item.id ? "Preparing PDF…" : "Download PDF"}</button>` : ""}
      </div>
    </div>
  </dialog>`;
}

function bindEvents(): void {
  document.querySelector("#backToCapture")?.addEventListener("click", () => void openCapture());
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
  if (busyCaptureId) return;
  busyCaptureId = captureId;
  const item = history.find((candidate) => candidate.id === captureId);
  let navigating = false;
  try {
    if (!item) return;
    if (await guardActiveCapture()) return;
    await withStoryEditorOwnership(async () => {
      message = item.hasPlan ? "Opening the editable story…" : "Creating an editable story from this recording…";
      render();
      await saveSession(item.session);
      if (!item.hasPlan) {
        const response = await sendRuntimeMessage({ type: "PREPARE_CAPTURE_PLAN" });
        if (!response.ok || !response.session) {
          if (response.session) {
            item.session = response.session;
            await saveCaptureHistory(response.session);
          }
          message = response.error ?? "JesSee could not create this story.";
          return;
        }
        await saveCaptureHistory(response.session);
      }
      navigating = true;
      const unloading = new Promise<void>((resolve) => window.addEventListener("pagehide", () => resolve(), { once: true }));
      window.location.assign(chrome.runtime.getURL("plan.html"));
      await unloading;
    }, async () => {
      message = "Your open story editor was focused. Finish or close it before opening a different saved walkthrough.";
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busyCaptureId = undefined;
    if (!navigating) render();
  }
}

async function downloadCapture(captureId: string): Promise<void> {
  if (busyCaptureId) return;
  const item = history.find((candidate) => candidate.id === captureId);
  if (!item?.session.captureAnalysis) return;
  busyCaptureId = captureId;
  try {
    await withStoryEditorOwnership(async () => {
      message = "Preparing a fresh PDF from the saved story…";
      render();
      await downloadPlanPdf(item.session);
      const readySession: RecordingSession = { ...item.session, status: "ready" };
      await saveCaptureHistory(readySession);
      item.hasPdf = true;
      item.session = readySession;
      message = "PDF downloaded. The saved story is unchanged.";
    }, async () => {
      message = "Your open story editor was focused. Download there so the PDF includes your latest edits.";
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busyCaptureId = undefined;
    render();
  }
}

async function previewCapture(captureId: string): Promise<void> {
  if (busyCaptureId) return;
  const item = history.find((candidate) => candidate.id === captureId);
  if (!item) return;
  busyCaptureId = captureId;
  message = "Loading the local recording…";
  render();
  try {
    preview = { item, session: await hydrateRecordingMedia(item.session) };
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

async function openCapture(windowId?: number): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "OPEN_RECORDER", windowId });
    if (!response.ok) throw new Error(response.error ?? "JesSee could not reopen the recorder.");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function startNewCapture(): Promise<void> {
  if (busyCaptureId) return;
  busyCaptureId = "new-capture";
  try {
    if (await guardActiveCapture()) return;
    await withStoryEditorOwnership(async () => {
      const previousSession = await getSession();
      const idleSession = await resetSession();
      if (previousSession.activeWindowId) {
        await saveSession({ ...idleSession, activeWindowId: previousSession.activeWindowId });
      }
      await openCapture(previousSession.activeWindowId);
    }, async () => {
      message = "Your open story editor was focused. Finish or close it before starting a new capture.";
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busyCaptureId = undefined;
    render();
  }
}

function observeThumbnails(): void {
  const targets = [...document.querySelectorAll<HTMLElement>("[data-thumbnail-capture]")];
  if (!targets.length) return;
  if (!("IntersectionObserver" in window)) {
    for (const target of targets) void loadThumbnail(target);
    return;
  }
  thumbnailObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      thumbnailObserver?.unobserve(entry.target);
      void loadThumbnail(entry.target as HTMLElement);
    }
  }, { rootMargin: "320px" });
  for (const target of targets) thumbnailObserver.observe(target);
}

async function loadThumbnail(target: HTMLElement): Promise<void> {
  const captureId = target.dataset.thumbnailCapture;
  const item = history.find((candidate) => candidate.id === captureId);
  const screenshot = item && selectedScreenshot(item.session);
  if (!item || !screenshot) return;
  const requestedSource = thumbnailSource(item.session);
  let thumbnail = "";
  try {
    thumbnail = await getArtifact(screenshot.dataUrl) ?? "";
  } catch {
    // A missing preview must not prevent the retained story from being opened.
  }
  const currentItem = history.find((candidate) => candidate.id === captureId);
  if (!currentItem || thumbnailSource(currentItem.session) !== requestedSource) return;
  thumbnails.set(item.id, thumbnail);
  const image = [...document.querySelectorAll<HTMLImageElement>("[data-thumbnail-image]")]
    .find((candidate) => candidate.dataset.thumbnailImage === item.id);
  const placeholder = [...document.querySelectorAll<HTMLElement>("[data-thumbnail-placeholder]")]
    .find((candidate) => candidate.dataset.thumbnailPlaceholder === item.id);
  if (!image || !thumbnail) {
    const label = placeholder?.querySelector("span");
    if (label) label.textContent = "Preview unavailable";
    return;
  }
  image.src = thumbnail;
  image.hidden = false;
  if (placeholder) placeholder.hidden = true;
}

async function guardActiveCapture(): Promise<boolean> {
  activeCapture = isActiveCapture(await getSession());
  if (!activeCapture) return false;
  message = activeCaptureMessage();
  render();
  return true;
}

function isActiveCapture(session: RecordingSession | undefined): boolean {
  return Boolean(session && ["recording", "paused", "planning", "generating"].includes(session.status));
}

function activeCaptureMessage(): string {
  return "A capture is still recording or being prepared. Return to capture and finish it before starting or editing another walkthrough.";
}

function sortedHistory(items: CaptureHistoryItem[]): CaptureHistoryItem[] {
  return [...items].sort((left, right) => right.createdAt - left.createdAt);
}

function selectedScreenshot(session: RecordingSession): ScreenshotEvidence | undefined {
  const selectedId = session.captureAnalysis?.storySteps?.find((step) => step.screenshotId)?.screenshotId
    ?? session.captureAnalysis?.helpfulImageMoments?.find((moment) => moment.screenshotId)?.screenshotId;
  return session.screenshots.find((screenshot) => screenshot.id === selectedId) ?? session.screenshots[0];
}

function thumbnailSource(session: RecordingSession): string {
  const screenshot = selectedScreenshot(session);
  return screenshot ? `${screenshot.id}:${screenshot.dataUrl}` : "";
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
