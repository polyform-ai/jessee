import "./ui.css";
import { artifactRef, hydrateSession, putArtifact } from "./artifacts";
import { dataUrlToBlob } from "./dataUrl";
import {
  chooseExportFolder,
  deleteOldCaptureFolders,
  exportFolderName,
  hasExportFolder,
  restoreExportFolder,
  startRecordingFolder,
  writeRecordingBlob,
  writeRecordingText,
  writeScreenshot
} from "./localFiles";
import { createTicketPdf, ticketPdfFilename } from "./pdf";
import { getSession, getSettings, pruneCaptureHistory, resetSession, saveSession, saveSettings, upsertCaptureHistory } from "./storage";
import { getSelectedTemplate, getTemplates } from "./templates";
import type { CaptureAnalysis, CaptureHistoryItem, RecordingSession, RuntimeMessage, ScreenshotEvidence, TimelineEvent } from "./types";
import { postWebhook } from "./webhook";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

let session: RecordingSession | undefined;
let mediaRecorder: MediaRecorder | undefined;
let audioRecorder: MediaRecorder | undefined;
let displayStream: MediaStream | undefined;
let micStream: MediaStream | undefined;
let mixedStream: MediaStream | undefined;
let previewVideo: HTMLVideoElement | undefined;
let screenshotInterval: number | undefined;
let screenshotInFlight = false;
let liveRenderInterval: number | undefined;
let pdfProgressInterval: number | undefined;
let localStatus = "";
let selectedTemplateName = "Debug Ticket";
let settingsCache: Awaited<ReturnType<typeof getSettings>> | undefined;
let pdfProgress: PdfProgress | undefined;
let cleanupRan = false;
let onboardingDraft: { email: string; apiKey: string; retentionDays: number } | undefined;
const videoChunks: Blob[] = [];
const audioChunks: Blob[] = [];

interface PdfProgress {
  startedAt: number;
  estimateSeconds: number;
  percent: number;
  label: string;
}

const PDF_PROGRESS_STEPS = [
  { label: "Preparing capture", threshold: 6 },
  { label: "Transcribing narration", threshold: 18 },
  { label: "Analyzing transcript", threshold: 38 },
  { label: "Selecting screenshots", threshold: 58 },
  { label: "Writing document", threshold: 78 },
  { label: "Building PDF", threshold: 92 }
];
const CAPTURE_INTERVAL_MS = 500;

void refresh();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.recordingSession || changes.settings)) void refresh();
});

async function refresh(): Promise<void> {
  await restoreExportFolder();
  settingsCache = await getSettings();
  if (!cleanupRan && hasExportFolder()) {
    cleanupRan = true;
    void cleanupOldCaptures(settingsCache.retentionDays ?? 30);
  }
  selectedTemplateName = getSelectedTemplate(settingsCache).name;
  const response = await send({ type: "GET_SESSION" });
  session = response.session;
  render();
}

function render(): void {
  const current = session;
  const settings = settingsCache;
  if (!settings?.email || !settings.openAiKey || !hasExportFolder()) {
    renderOnboarding(settings);
    return;
  }
  const hasEvidence = Boolean(current && (current.screenshots.length > 0 || current.audioDataUrl || current.videoDataUrl));
  const canUsePdfAction = current?.status === "stopped" || current?.status === "planned" || current?.status === "ready" || (current?.status === "error" && hasEvidence);
  const hasTicket = Boolean(current?.ticket);
  const templates = settings ? getTemplates(settings) : [];
  const selectedTemplateId = settings?.selectedTemplateId ?? "debug-ticket";
  const recordingDuration = formatDuration(current?.startedAt, current?.stoppedAt);
  const status = statusLabel(current?.status);
  const showCaptureSummary = Boolean(current?.startedAt || current?.screenshots.length || current?.ticket);
  const progress = pdfProgress ?? (current?.status === "generating" ? createProgress(current, Date.now()) : undefined);
  const history = settings?.captureHistory ?? [];
  const isMicrophoneReady = Boolean(settings?.microphoneEnabledAt);
  root.innerHTML = `
    <main class="app">
      <div class="header header-panel">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">JesSee</p>
            <h1>Help AI see what you see.</h1>
            <p class="hint">${hasExportFolder() ? "Captures save locally" : "Set an output folder in Settings"}</p>
          </div>
        </div>
        <div class="header-actions">
          <span class="status">${status}</span>
          <button class="icon-button" id="settings" aria-label="Open Settings" title="Settings">⚙</button>
        </div>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Capture Context</h2>
              <p>Explain it once. JesSee turns it into a clean PDF.</p>
            </div>
          </div>
          <div class="row">
            <button class="button primary" id="start" ${current?.status === "generating" || current?.status === "recording" || !isMicrophoneReady ? "disabled" : ""}>Start Capture</button>
            <button class="button danger" id="stop" ${current?.status !== "recording" ? "disabled" : ""}>End Capture</button>
          </div>
          ${!isMicrophoneReady ? `<button class="button secondary" id="openMicSettings">Enable Microphone in Settings</button>` : ""}
          <button class="button primary" id="pdfAction" ${!canUsePdfAction ? "disabled" : ""}>${hasTicket ? "Download PDF" : current?.captureAnalysis ? "Generate PDF" : "Create Plan"}</button>
        </section>
        ${progress ? `<section class="panel">
          <div class="panel-header">
            <div>
              <h2>Creating PDF</h2>
              <p>${escapeHtml(progress.label)} · ${formatProgressTiming(progress)}</p>
            </div>
          </div>
          <div class="progress-track" aria-label="PDF creation progress">
            <div class="progress-fill" style="width: ${Math.round(progress.percent)}%"></div>
          </div>
          <div class="progress-steps">
            ${PDF_PROGRESS_STEPS.map((step, index) => {
              const status = progressStepStatus(progress, index);
              return `<div class="progress-step ${status}">
                <span>${status === "done" ? "OK" : index + 1}</span>
                <strong>${escapeHtml(step.label)}</strong>
              </div>`;
            }).join("")}
          </div>
        </section>` : ""}
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Document Type</h2>
              <p>Choose how JesSee should organize the PDF.</p>
            </div>
          </div>
          <div class="field">
            <label for="templateSelect">Template</label>
            <select id="templateSelect" ${current?.status === "recording" || current?.status === "generating" ? "disabled" : ""}>
              ${templates.map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === selectedTemplateId ? "selected" : ""}>${escapeHtml(template.name)}</option>`).join("")}
            </select>
          </div>
        </section>
        ${showCaptureSummary ? `<section class="panel">
          <div class="panel-header">
            <div>
              <h2>Capture Summary</h2>
              <p>What will be included in this document.</p>
            </div>
          </div>
          <div class="meta-grid">
            <div class="meta"><span>Images Taken</span><strong>${current?.screenshots.length ?? 0}</strong></div>
            <div class="meta"><span>Capture</span><strong>${recordingDuration}</strong></div>
            <div class="meta"><span>Template</span><strong>${escapeHtml(current?.ticket?.templateName ?? selectedTemplateName)}</strong></div>
          </div>
        </section>` : ""}
        ${current?.captureAnalysis ? renderPlanReview(current) : ""}
        <section class="panel">
          ${localStatus ? `<p class="success">${escapeHtml(localStatus)}</p>` : ""}
          ${!localStatus && current?.error ? `<p class="error">${escapeHtml(current.error)}</p>` : ""}
          ${current?.exportFolderName ? `<p class="hint">Capture folder: ${escapeHtml(current.exportFolderName)}</p>` : ""}
          <p class="hint">Screenshots are timestamped and paired with your narration when the PDF is created.</p>
        </section>
        ${renderHistory(history)}
      </div>
    </main>
  `;

  bind("#start", "click", () => startRecording());
  bind("#openMicSettings", "click", () => chrome.runtime.openOptionsPage());
  bind("#stop", "click", () => stopRecording());
  bind("#pdfAction", "click", () => {
    if (session?.ticket) void downloadPdfInPage(session);
    else if (!session?.captureAnalysis) void prepareCapturePlan();
    else void generateAndDownload();
  });
  bind("#savePlan", "click", () => {
    void savePlanEdits();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>(".load-history")) {
    button.addEventListener("click", async () => {
      const item = settings?.captureHistory?.find((capture) => capture.id === button.dataset.captureId);
      if (!item) return;
      await saveSession(item.session);
      localStatus = "Capture loaded.";
      await refresh();
    });
  }
  bind("#templateSelect", "change", (event) => {
    void selectTemplate((event.target as HTMLSelectElement).value);
  });
  bind("#settings", "click", () => chrome.runtime.openOptionsPage());
  updateLiveRender();
}

function renderOnboarding(settings: Awaited<ReturnType<typeof getSettings>> | undefined): void {
  const email = onboardingDraft?.email ?? settings?.email ?? "";
  const apiKeyValue = onboardingDraft?.apiKey ?? (settings?.openAiKey ? "••••••••••••••••" : "");
  const retentionDays = onboardingDraft?.retentionDays ?? settings?.retentionDays ?? 30;
  root.innerHTML = `
    <main class="app">
      <div class="header header-panel">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">JesSee</p>
            <h1>Explain software by showing it.</h1>
            <p class="hint">Help AI see what you see.</p>
          </div>
        </div>
        <button class="icon-button" id="settings" aria-label="Open Settings" title="Settings">⚙</button>
      </div>
      <div class="stack">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Get Started</h2>
              <p>Add your email, OpenAI API key, and a local folder so JesSee can save captures and PDFs on this computer.</p>
            </div>
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(email)}" />
          </div>
          <div class="field">
            <label for="apiKey">OpenAI API key</label>
            <input id="apiKey" type="password" autocomplete="off" placeholder="sk-..." value="${escapeHtml(apiKeyValue)}" />
          </div>
          <div class="field">
            <label for="retentionDays">Delete captures after</label>
            <input id="retentionDays" type="number" min="1" max="365" value="${retentionDays}" />
          </div>
          <div class="meta">
            <span>Output folder</span>
            <strong>${hasExportFolder() ? escapeHtml(exportFolderName() ?? "Selected") : "Not selected"}</strong>
          </div>
          <button class="button secondary" id="chooseFolder">Choose Folder</button>
          <button class="button primary" id="saveOnboarding">Continue</button>
          ${localStatus ? `<p class="error">${escapeHtml(localStatus)}</p>` : ""}
        </section>
      </div>
    </main>
  `;
  bind("#saveOnboarding", "click", () => {
    void saveOnboarding();
  });
  bind("#chooseFolder", "click", () => {
    void chooseFolderFromPopup();
  });
}

function renderPlanReview(current: RecordingSession): string {
  const analysis = current.captureAnalysis;
  if (!analysis) return "";
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h2>Plan Review</h2>
        <p>Adjust what JesSee understood before generating the PDF.</p>
      </div>
    </div>
    <div class="field">
      <label for="planGoal">Goal</label>
      <textarea id="planGoal" rows="3">${escapeHtml(analysis.userGoal)}</textarea>
    </div>
    <div class="field">
      <label for="planDelivery">Best delivery</label>
      <textarea id="planDelivery" rows="3">${escapeHtml(analysis.bestDelivery)}</textarea>
    </div>
    <div class="field">
      <label for="planStory">Story</label>
      <textarea id="planStory" rows="4">${escapeHtml(analysis.story)}</textarea>
    </div>
    <div class="field">
      <label for="planBreakingPoints">Breaking points</label>
      <textarea id="planBreakingPoints" rows="4">${escapeHtml(analysis.breakingPoints.join("\n"))}</textarea>
    </div>
    <div class="stack">
      <p class="kicker">Planned screenshots</p>
      ${analysis.helpfulImageMoments.length > 0 ? analysis.helpfulImageMoments.map((moment, index) => `
        <div class="template-row">
          <div class="stack">
            <div class="field">
              <label for="planShot-${index}">Screenshot</label>
              <select id="planShot-${index}" class="plan-shot" data-index="${index}">
                <option value="">No screenshot</option>
                ${current.screenshots.map((shot, shotIndex) => `
                  <option value="${escapeHtml(shot.id)}" ${shot.id === moment.screenshotId ? "selected" : ""}>
                    ${String(shotIndex + 1).padStart(2, "0")} · ${formatMs(shot.capturedAtMs)} · ${escapeHtml(shot.title || shot.url || "Screenshot")}
                  </option>
                `).join("")}
              </select>
            </div>
            <div class="field">
              <label for="planReason-${index}">Why this image helps</label>
              <textarea id="planReason-${index}" class="plan-reason" data-index="${index}" rows="2">${escapeHtml(moment.reason)}</textarea>
            </div>
          </div>
        </div>
      `).join("") : `<p class="hint">No screenshots were selected by the plan.</p>`}
    </div>
    <button class="button primary" id="savePlan">Save Plan</button>
  </section>`;
}

function renderHistory(history: CaptureHistoryItem[]): string {
  if (history.length === 0) return "";
  return `<section class="panel">
    <div class="panel-header">
      <div>
        <h2>History</h2>
        <p>Load a previous local capture and generate a new PDF.</p>
      </div>
    </div>
    <div class="stack">
      ${history.slice(0, 6).map((item) => `
        <div class="template-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="hint">${formatHistoryDate(item.createdAt)} · ${item.imageCount} images · ${formatSeconds(item.durationSeconds)} · ${escapeHtml(item.folderName ?? "local capture")}</p>
          </div>
          <button class="button secondary load-history" data-capture-id="${escapeHtml(item.id)}">Load</button>
        </div>
      `).join("")}
    </div>
  </section>`;
}

async function savePlanEdits(): Promise<void> {
  const current = await getSession();
  if (!current.captureAnalysis) return;
  const moments = current.captureAnalysis.helpfulImageMoments.map((moment, index) => ({
    ...moment,
    screenshotId: document.querySelector<HTMLSelectElement>(`#planShot-${index}`)?.value || undefined,
    reason: document.querySelector<HTMLTextAreaElement>(`#planReason-${index}`)?.value.trim() ?? moment.reason
  }));
  const nextAnalysis: CaptureAnalysis = {
    userGoal: document.querySelector<HTMLTextAreaElement>("#planGoal")?.value.trim() ?? current.captureAnalysis.userGoal,
    bestDelivery: document.querySelector<HTMLTextAreaElement>("#planDelivery")?.value.trim() ?? current.captureAnalysis.bestDelivery,
    story: document.querySelector<HTMLTextAreaElement>("#planStory")?.value.trim() ?? current.captureAnalysis.story,
    breakingPoints: (document.querySelector<HTMLTextAreaElement>("#planBreakingPoints")?.value ?? "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    helpfulImageMoments: moments
  };
  const next = { ...current, captureAnalysis: nextAnalysis, status: "planned" as const };
  await saveSession(next);
  await writeRecordingText("capture-analysis.json", JSON.stringify(nextAnalysis, null, 2), "application/json");
  await saveCaptureHistory(next);
  localStatus = "Plan saved.";
  await refresh();
}

async function saveOnboarding(): Promise<void> {
  const email = document.querySelector<HTMLInputElement>("#email")?.value.trim() ?? "";
  const apiKeyInput = document.querySelector<HTMLInputElement>("#apiKey")?.value.trim() ?? "";
  const retentionDays = Number(document.querySelector<HTMLInputElement>("#retentionDays")?.value ?? 30);
  const existing = await getSettings();
  const openAiKey = apiKeyInput.includes("•") ? existing.openAiKey : apiKeyInput;
  if (!email || !email.includes("@")) {
    localStatus = "Enter a valid email address.";
    render();
    return;
  }
  if (!openAiKey) {
    localStatus = "Enter your OpenAI API key.";
    render();
    return;
  }
  if (!hasExportFolder()) {
    localStatus = "Choose a local folder before continuing.";
    render();
    return;
  }
  await saveSettings({ email, openAiKey, retentionDays: normalizeRetentionDays(retentionDays) });
  onboardingDraft = undefined;
  const updated = await getSettings();
  await postWebhook(updated, "new_user", { email });
  localStatus = "";
  await refresh();
}

async function chooseFolderFromPopup(): Promise<void> {
  try {
    preserveOnboardingDraft();
    await chooseExportFolder();
    localStatus = "Folder selected.";
    await refresh();
  } catch (error) {
    localStatus = error instanceof Error ? error.message : String(error);
    render();
  }
}

function preserveOnboardingDraft(): void {
  const email = document.querySelector<HTMLInputElement>("#email")?.value.trim() ?? "";
  const apiKey = document.querySelector<HTMLInputElement>("#apiKey")?.value.trim() ?? "";
  const retentionDays = Number(document.querySelector<HTMLInputElement>("#retentionDays")?.value ?? 30);
  onboardingDraft = {
    email,
    apiKey,
    retentionDays: normalizeRetentionDays(retentionDays)
  };
}

async function selectTemplate(templateId: string): Promise<void> {
  await saveSettings({ selectedTemplateId: templateId });
  localStatus = "Template selected.";
  await refresh();
}

async function run(message: RuntimeMessage, refreshAfter = true): Promise<void> {
  const response = await send(message);
  if (response.session) session = response.session;
  if (!response.ok) throw new Error(response.error ?? "Request failed.");
  if (refreshAfter) await refresh();
  else render();
}

async function generateAndDownload(): Promise<void> {
  const currentBefore = await getSession();
  if (!currentBefore.captureAnalysis) {
    await prepareCapturePlan();
    const planned = await getSession();
    if (!planned.captureAnalysis) return;
  }
  startPdfProgress(await getSession());
  try {
    await run({ type: "GENERATE_TICKET" });
    updatePdfProgress(92, "Building the PDF");
    const current = await getSession();
    if (current.ticket) await downloadPdfInPage(current);
    if (current.ticket) updatePdfProgress(100, "Done");
    if (current.ticket) await saveCaptureHistory(current);
  } catch (error) {
    localStatus = error instanceof Error ? error.message : String(error);
    await refresh();
  } finally {
    window.setTimeout(() => {
      stopPdfProgress();
      render();
    }, 500);
  }
}

async function prepareCapturePlan(): Promise<void> {
  localStatus = "Preparing the plan.";
  render();
  try {
    await run({ type: "PREPARE_CAPTURE_PLAN" });
    const current = await getSession();
    await writeRecordingText("capture-analysis.json", JSON.stringify(current.captureAnalysis, null, 2), "application/json");
    await saveCaptureHistory(current);
    localStatus = "Plan ready. Review it, then generate the PDF.";
    await refresh();
  } catch (error) {
    localStatus = error instanceof Error ? error.message : String(error);
    await refresh();
  }
}

async function downloadPdfInPage(current: RecordingSession): Promise<void> {
  if (!current.ticket) return;
  const conversionStartedAt = performance.now();
  const hydrated = await hydrateSession(current);
  const blob = createTicketPdf(hydrated.ticket!, hydrated);
  await writeRecordingBlob(ticketPdfFilename(current.ticket), blob);
  await writeRecordingText("ticket.json", JSON.stringify(current.ticket, null, 2), "application/json");
  if (current.captureAnalysis) await writeRecordingText("capture-analysis.json", JSON.stringify(current.captureAnalysis, null, 2), "application/json");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = ticketPdfFilename(current.ticket);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await postWebhook(await getSettings(), "converted_pdf", {
    image_count: hydrated.screenshots.length,
    recording_seconds: recordingSeconds(hydrated),
    conversion_ms: Math.round(performance.now() - conversionStartedAt),
    template_name: current.ticket.templateName ?? selectedTemplateName,
    openai_tokens: current.openAiUsage?.totalTokens ?? 0,
    openai_input_tokens: current.openAiUsage?.inputTokens ?? 0,
    openai_output_tokens: current.openAiUsage?.outputTokens ?? 0,
    openai_estimated_cost_usd: current.openAiUsage?.estimatedCostUsd ?? 0
  });
}

async function startRecording(): Promise<void> {
  // Both media requests must begin directly from this click. Chrome's share
  // picker suspends the handler, so requesting the microphone afterwards can
  // be rejected even when it was enabled in Settings.
  const startedAt = Date.now();
  // The persisted File System Access handle can be temporarily unavailable
  // after Chrome reloads an unpacked extension. Local export is useful, but it
  // must never block the actual recording.
  const recordingFolderPromise = startRecordingFolder(`${new Date(startedAt).toISOString().slice(0, 19)}-jessee-capture`).catch((error: unknown) => {
    console.warn("Local capture folder is unavailable; keeping the recording in JesSee.", error);
    return undefined;
  });
  const microphoneStreamPromise = requestMicrophoneStream(settingsCache);
  const screenStreamPromise = requestScreenStream();
  try {
    await clearCurrentError();
    await hardCleanupInterruptedRecording();
    videoChunks.length = 0;
    audioChunks.length = 0;

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    micStream = await microphoneStreamPromise;
    audioContext.createMediaStreamSource(micStream).connect(destination);

    displayStream = await screenStreamPromise;
    for (const track of displayStream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        void stopRecording();
      });
    }

    mixedStream = new MediaStream([...displayStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    previewVideo = document.createElement("video");
    previewVideo.muted = true;
    previewVideo.srcObject = displayStream;
    await previewVideo.play();

    const target = await getBestActiveTab();
    const captureId = crypto.randomUUID();
    const template = getSelectedTemplate(await getSettings());
    const exportFolderName = await recordingFolderPromise;
    const initialSession: RecordingSession = {
      ...(await resetSession()),
      status: "recording",
      startedAt,
      captureId,
      templateId: template.id,
      activeTabId: target?.id,
      activeWindowId: target?.windowId,
      tabUrl: target?.url,
      tabTitle: target?.title,
      exportFolderName,
      timeline: [
        {
          id: crypto.randomUUID(),
          type: "recording-started",
          atMs: 0,
          url: target?.url ?? "",
          title: target?.title ?? ""
        }
      ]
    };
    await saveSession(initialSession);
    session = initialSession;

    mediaRecorder = new MediaRecorder(mixedStream, { mimeType: pickMimeType(["video/webm;codecs=vp9,opus", "video/webm"]) });
    audioRecorder = new MediaRecorder(new MediaStream(destination.stream.getAudioTracks()), { mimeType: pickMimeType(["audio/webm;codecs=opus", "audio/webm"]) });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) videoChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      void finishLocalRecording();
    };
    audioRecorder?.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    });

    audioRecorder?.start(1000);
    mediaRecorder.start(1000);
    await send({ type: "SET_OVERLAY_MODE", mode: "cursor" });
    localStatus = "Capturing. Click End Capture when finished.";
    await captureMoment("screenshot");
    screenshotInterval = window.setInterval(() => {
      void captureMoment("screenshot");
    }, CAPTURE_INTERVAL_MS);
    await refresh();
  } catch (error) {
    void microphoneStreamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
    void screenStreamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
    cleanupRecorder();
    await saveSession({
      ...((await getSession()) ?? { timeline: [], screenshots: [] }),
      status: "error",
      error: permissionAwareErrorMessage(error)
    });
    await refresh();
  }
}

async function clearCurrentError(): Promise<void> {
  const current = await getSession();
  if (!current.error) return;
  await saveSession({ ...current, error: undefined, status: current.status === "error" ? "idle" : current.status });
}

async function requestScreenStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });
  } catch (error) {
    throw new Error(`Screen permission was dismissed. Click Start Capture again and choose a screen, window, or tab. ${rawErrorMessage(error)}`);
  }
}

async function requestMicrophoneStream(settings: Awaited<ReturnType<typeof getSettings>> | undefined): Promise<MediaStream> {
  try {
    if (!settings?.microphoneEnabledAt) {
      throw new Error("Enable a microphone in Settings before starting a capture.");
    }
    return await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(settings?.selectedMicrophoneId) });
  } catch (error) {
    throw new Error(`Microphone access is not available. Open Settings, click Enable Microphone, then start capture again. ${rawErrorMessage(error)}`);
  }
}

function microphoneConstraints(deviceId: string | undefined): MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : {};
}

async function stopRecording(): Promise<void> {
  localStatus = "Ending capture.";
  render();
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      await captureMoment("screenshot");
      if (screenshotInterval) window.clearInterval(screenshotInterval);
      screenshotInterval = undefined;
      if (audioRecorder && audioRecorder.state !== "inactive") audioRecorder.stop();
      mediaRecorder.stop();
      return;
    }
    await hardCleanupInterruptedRecording("Capture was interrupted or the side panel reloaded. The stuck state has been cleared; start a new capture.");
  } catch (error) {
    await hardCleanupInterruptedRecording(error instanceof Error ? error.message : String(error));
  }
}

async function finishLocalRecording(): Promise<void> {
  const current = await getSession();
  const videoBlob = new Blob(videoChunks, { type: mediaRecorder?.mimeType || "video/webm" });
  const audioBlob = audioChunks.length ? new Blob(audioChunks, { type: audioRecorder?.mimeType || "audio/webm" }) : undefined;
  await writeRecordingBlob("recording.webm", videoBlob);
  if (audioBlob) await writeRecordingBlob("audio.webm", audioBlob);
  const videoDataUrl = await putArtifact("video", await blobToDataUrl(videoBlob));
  const audioDataUrl = audioBlob
    ? await putArtifact("audio", await blobToDataUrl(audioBlob))
    : undefined;
  cleanupRecorder();
  localStatus = "Capture saved. Create PDF when ready.";
  const nextSession: RecordingSession = {
    ...current,
    status: "stopped",
    stoppedAt: Date.now(),
    videoDataUrl,
    audioDataUrl,
    timeline: [...current.timeline, createEvent(current, "recording-stopped")]
  };
  await writeRecordingText("evidence.json", JSON.stringify(nextSession, null, 2), "application/json");
  await saveSession(nextSession);
  await saveCaptureHistory(nextSession);
  await postWebhook(await getSettings(), "stopped_recording", {
    recording_seconds: recordingSeconds(nextSession),
    image_count: nextSession.screenshots.length
  });
  await refresh();
  void prepareCapturePlan();
}

async function hardCleanupInterruptedRecording(message?: string): Promise<void> {
  cleanupRecorder();
  const current = await getSession();
  if (current.status === "recording" || current.status === "paused") {
    const next: RecordingSession = {
      ...current,
      status: "error",
      stoppedAt: Date.now(),
      error: message ?? "Previous capture was interrupted. Start a new capture."
    };
    await saveSession(next);
    session = next;
    localStatus = "";
    render();
  }
}

async function captureMoment(type: TimelineEvent["type"] = "screenshot"): Promise<void> {
  if (screenshotInFlight) return;
  screenshotInFlight = true;
  try {
  if (!previewVideo || !session?.startedAt) {
    await run({ type: "CAPTURE_MOMENT" });
    return;
  }
  const current = await getSession();
  const canvas = document.createElement("canvas");
  canvas.width = previewVideo.videoWidth || 1280;
  canvas.height = previewVideo.videoHeight || 720;
  const context = canvas.getContext("2d");
  context?.drawImage(previewVideo, 0, 0, canvas.width, canvas.height);
  const event = createEvent(current, type);
  const dataUrl = canvas.toDataURL("image/png");
  const id = crypto.randomUUID();
  const artifactKey = `screenshot:${id}`;
  await putArtifact(artifactKey, dataUrl);
  await writeScreenshot(`${String(current.screenshots.length + 1).padStart(3, "0")}-${Math.round(event.atMs)}ms.png`, dataUrlToBlob(dataUrl));
  const screenshot: ScreenshotEvidence = {
    id,
    capturedAtMs: event.atMs,
    url: current.tabUrl ?? "",
    title: current.tabTitle ?? "",
    dataUrl: artifactRef(artifactKey),
    annotations: [],
    redactions: []
  };
  const nextSession = {
    ...current,
    timeline: [...current.timeline, { ...event, screenshotId: screenshot.id }],
    screenshots: [...current.screenshots, screenshot]
  };
  await saveSession(nextSession);
  session = nextSession;
  } finally {
    screenshotInFlight = false;
  }
}

async function appendLocalEvent(type: TimelineEvent["type"]): Promise<void> {
  const current = await getSession();
  await saveSession({ ...current, timeline: [...current.timeline, createEvent(current, type)] });
}

function createEvent(current: RecordingSession, type: TimelineEvent["type"]): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    type,
    atMs: current.startedAt ? Date.now() - current.startedAt : 0,
    url: current.tabUrl ?? "",
    title: current.tabTitle ?? ""
  };
}

async function getBestActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activePage = tabs.find((tab) => tab.url && /^https?:\/\//.test(tab.url));
  if (activePage) return activePage;
  const normalTabs = await chrome.tabs.query({ windowType: "normal" });
  return [...normalTabs].reverse().find((tab) => tab.url && /^https?:\/\//.test(tab.url));
}

function pickMimeType(types: string[]): string {
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function cleanupRecorder(): void {
  if (screenshotInterval) window.clearInterval(screenshotInterval);
  screenshotInterval = undefined;
  for (const track of displayStream?.getTracks() ?? []) track.stop();
  for (const track of micStream?.getTracks() ?? []) track.stop();
  for (const track of mixedStream?.getTracks() ?? []) track.stop();
  displayStream = undefined;
  micStream = undefined;
  mixedStream = undefined;
  previewVideo = undefined;
  mediaRecorder = undefined;
  audioRecorder = undefined;
}

function bind(selector: string, event: string, handler: EventListener): void {
  document.querySelector(selector)?.addEventListener(event, handler);
}

function send(message: RuntimeMessage): Promise<{ ok: boolean; session?: RecordingSession; error?: string }> {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function permissionAwareErrorMessage(error: unknown): string {
  const message = rawErrorMessage(error);
  if (/folder|screen|microphone/i.test(message)) return message;
  if (/permission dismissed/i.test(message)) return "Permission was dismissed. Open Settings, enable the microphone, then start capture again.";
  if (/permission denied|notallowederror|not allowed/i.test(message)) return `Permission was denied. ${message}`;
  return message;
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(startedAt?: number, stoppedAt?: number): string {
  if (!startedAt) return "Not started";
  const end = stoppedAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.round((end - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function statusLabel(status?: RecordingSession["status"]): string {
  switch (status) {
    case "recording":
      return "capturing";
    case "stopped":
      return "captured";
    case "planning":
      return "planning";
    case "planned":
      return "planned";
    case "generating":
      return "creating";
    case "ready":
      return "ready";
    case "error":
      return "needs attention";
    default:
      return "idle";
  }
}

async function saveCaptureHistory(current: RecordingSession): Promise<void> {
  if (!current.startedAt) return;
  const title = current.ticket?.title || current.captureAnalysis?.userGoal || current.tabTitle || "JesSee capture";
  await upsertCaptureHistory({
    id: current.captureId ?? `${current.startedAt}`,
    title,
    folderName: current.exportFolderName,
    createdAt: current.startedAt,
    stoppedAt: current.stoppedAt,
    templateName: current.ticket?.templateName ?? selectedTemplateName,
    imageCount: current.screenshots.length,
    durationSeconds: recordingSeconds(current),
    hasPlan: Boolean(current.captureAnalysis),
    hasTicket: Boolean(current.ticket),
    session: current
  });
}

async function cleanupOldCaptures(retentionDays: number): Promise<void> {
  const normalized = normalizeRetentionDays(retentionDays);
  try {
    await Promise.all([deleteOldCaptureFolders(normalized), pruneCaptureHistory(normalized)]);
  } catch (error) {
    console.warn("Could not clean old captures", error);
  }
}

function normalizeRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(365, Math.max(1, Math.round(value)));
}

function updateLiveRender(): void {
  if (session?.status === "recording" && !liveRenderInterval) {
    liveRenderInterval = window.setInterval(() => {
      render();
    }, 1000);
  }
  if (session?.status !== "recording" && liveRenderInterval) {
    window.clearInterval(liveRenderInterval);
    liveRenderInterval = undefined;
  }
}

function startPdfProgress(current: RecordingSession): void {
  const estimateSeconds = estimatePdfSeconds(current);
  pdfProgress = {
    startedAt: Date.now(),
    estimateSeconds,
    percent: 6,
    label: "Preparing capture"
  };
  if (pdfProgressInterval) window.clearInterval(pdfProgressInterval);
  pdfProgressInterval = window.setInterval(() => {
    if (!pdfProgress) return;
    pdfProgress = createProgress(current, pdfProgress.startedAt, pdfProgress.estimateSeconds);
    render();
  }, 1000);
  render();
}

function updatePdfProgress(percent: number, label: string): void {
  if (!pdfProgress) return;
  pdfProgress = { ...pdfProgress, percent, label };
  render();
}

function stopPdfProgress(): void {
  if (pdfProgressInterval) window.clearInterval(pdfProgressInterval);
  pdfProgressInterval = undefined;
  pdfProgress = undefined;
}

function createProgress(current: RecordingSession, startedAt: number, estimateSeconds = estimatePdfSeconds(current)): PdfProgress {
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  const ratio = Math.min(0.9, elapsedSeconds / estimateSeconds);
  const percent = Math.max(6, Math.round(ratio * 90));
  return {
    startedAt,
    estimateSeconds,
    percent,
    label: progressLabel(percent)
  };
}

function progressLabel(percent: number): string {
  if (percent < 18) return "Preparing capture";
  if (percent < 38) return "Transcribing narration";
  if (percent < 58) return "Analyzing transcript";
  if (percent < 78) return "Selecting screenshots";
  if (percent < 92) return "Writing document";
  return "Building PDF";
}

function progressStepStatus(progress: PdfProgress, index: number): "done" | "active" | "pending" {
  const currentIndex = Math.max(
    0,
    PDF_PROGRESS_STEPS.findIndex((step, stepIndex) => {
      const next = PDF_PROGRESS_STEPS[stepIndex + 1];
      return progress.percent >= step.threshold && (!next || progress.percent < next.threshold);
    })
  );
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "active";
  return "pending";
}

function estimatePdfSeconds(current: RecordingSession): number {
  const captureSeconds = recordingSeconds(current);
  const imageCount = current.screenshots.length;
  const hasAudio = Boolean(current.audioDataUrl);
  const transcriptionSeconds = hasAudio ? Math.max(8, captureSeconds * 0.35) : 0;
  const visionSeconds = imageCount * 2.5;
  const writingSeconds = 14 + Math.min(25, captureSeconds * 0.08);
  return Math.round(Math.min(150, Math.max(20, transcriptionSeconds + visionSeconds + writingSeconds)));
}

function formatProgressTiming(progress: PdfProgress): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - progress.startedAt) / 1000));
  const remainingSeconds = Math.max(0, progress.estimateSeconds - elapsedSeconds);
  if (progress.percent >= 95) return "almost done";
  return `${formatSeconds(elapsedSeconds)} elapsed · about ${formatSeconds(remainingSeconds)} left`;
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatMs(ms: number): string {
  return formatSeconds(Math.max(0, Math.round(ms / 1000)));
}

function formatHistoryDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function recordingSeconds(current: RecordingSession): number {
  if (!current.startedAt) return 0;
  return Math.max(0, Math.round(((current.stoppedAt ?? Date.now()) - current.startedAt) / 1000));
}
