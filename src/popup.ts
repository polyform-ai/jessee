import "./ui.css";
import { artifactRef, putArtifact } from "./artifacts";
import { shouldStartWithFreshCapture } from "./captureHome";
import { saveCaptureHistory } from "./captureHistory";
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
import { downloadPlanPdf } from "./pdfDownload";
import { visiblePageRects } from "./captureEvidence";
import { getSession, getSettings, pruneCaptureHistory, resetSession, saveSession, saveSettings } from "./storage";
import type { CaptureHistoryItem, RecordingSession, RuntimeMessage, ScreenshotEvidence, TimelineEvent } from "./types";
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
let queuedAnnotationCapture = false;
let liveRenderInterval: number | undefined;
let pdfProgressInterval: number | undefined;
let localStatus = "";
let settingsCache: Awaited<ReturnType<typeof getSettings>> | undefined;
let pdfProgress: PdfProgress | undefined;
let cleanupRan = false;
let lastScreenshotFingerprint: string | undefined;
let lastStoredScreenshotAtMs = -Infinity;
let onboardingDraft: { email: string; apiKey: string; retentionDays: number } | undefined;
let initialSessionChecked = false;
const videoChunks: Blob[] = [];
const audioChunks: Blob[] = [];

interface PdfProgress {
  startedAt: number;
  estimateSeconds: number;
  percent: number;
  label: string;
}

const PDF_PROGRESS_STEPS = [
  { label: "Preparing visual story", threshold: 6 },
  { label: "Adding selected screenshots", threshold: 55 },
  { label: "Building PDF", threshold: 90 }
];
const CAPTURE_INTERVAL_MS = 500;
const MAX_SIMILAR_FRAME_GAP_MS = 5_000;

void refresh();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  const latestEvent = (changes.recordingSession?.newValue as RecordingSession | undefined)?.timeline.at(-1);
  if (latestEvent?.type === "annotation" || latestEvent?.type === "redaction") requestAnnotationCapture();
  if (changes.recordingSession || changes.settings) void refresh();
});

async function refresh(): Promise<void> {
  await restoreExportFolder();
  settingsCache = await getSettings();
  if (!cleanupRan && hasExportFolder()) {
    cleanupRan = true;
    void cleanupOldCaptures(settingsCache.retentionDays ?? 30);
  }
  const response = await send({ type: "GET_SESSION" });
  session = response.session;
  if (!initialSessionChecked && session && shouldStartWithFreshCapture(session)) {
    initialSessionChecked = true;
    session = await resetSession();
  } else {
    initialSessionChecked = true;
  }
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
  const hasPdf = current?.status === "ready";
  const recordingDuration = formatDuration(current?.startedAt, current?.stoppedAt);
  const status = statusLabel(current?.status);
  const showCaptureSummary = Boolean(current?.startedAt || current?.screenshots.length || current?.captureAnalysis);
  const progress = pdfProgress ?? (current?.status === "generating" ? createProgress(current, Date.now()) : undefined);
  const history = settings?.captureHistory ?? [];
  const isMicrophoneReady = Boolean(settings?.microphoneEnabledAt);
  const isPlanning = current?.status === "planning";
  root.innerHTML = `
    <main class="app">
      <div class="header header-panel">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">JesSee</p>
            <h1>Help AI see what you see.</h1>
            <p class="hint">${settings.privateMode ? "Private Mode · screenshot pixels stay local" : hasExportFolder() ? "Captures save locally" : "Set an output folder in Settings"}</p>
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
            <button class="button primary" id="start" ${current?.status === "generating" || isPlanning || current?.status === "recording" || !isMicrophoneReady ? "disabled" : ""}>Start Capture</button>
            <button class="button danger" id="stop" ${current?.status !== "recording" ? "disabled" : ""}>Close Capture</button>
          </div>
          ${current?.status === "recording" ? `<div class="stack">
            <div class="shortcut-grid" aria-label="Screen annotation shortcuts">
              <div class="shortcut"><kbd>B</kbd><span>Hold and drag an outline box</span></div>
              <div class="shortcut"><kbd>R</kbd><span>Hold and drag to redact</span></div>
              <div class="shortcut shortcut-wide"><kbd>C</kbd><span>Clear every box and redaction</span></div>
            </div>
            <p class="hint">Use these shortcuts directly on the page you are recording. Release the key after drawing.</p>
          </div>` : ""}
          ${!isMicrophoneReady ? `<button class="button secondary" id="openMicSettings">Enable Microphone in Settings</button>` : ""}
          ${isPlanning ? `<button class="button primary" disabled>Creating plan…</button>` : canUsePdfAction ? `<button class="button primary" id="pdfAction">${hasPdf ? "Download PDF" : current?.captureAnalysis ? "Generate PDF" : "Create Plan"}</button>` : ""}
          ${current?.captureAnalysis && !isPlanning ? `<button class="button secondary" id="reviewPlan">Review plan and screenshots</button>` : ""}
          ${current && current.status !== "idle" && current.status !== "recording" && current.status !== "planning" && current.status !== "generating" ? `<button class="button secondary" id="newCapture">New Capture</button>` : ""}
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
            <div class="meta"><span>Story Steps</span><strong>${current?.captureAnalysis?.storySteps?.length ?? 0}</strong></div>
          </div>
        </section>` : ""}
        <section class="panel">
          ${localStatus ? `<p class="success">${escapeHtml(localStatus)}</p>` : ""}
          ${!localStatus && (current?.error || current?.analysisError) ? `<p class="error">${escapeHtml(current?.analysisError ?? current?.error ?? "")}</p>` : ""}
          ${current?.exportFolderName ? `<p class="hint">Capture folder: ${escapeHtml(current.exportFolderName)}</p>` : ""}
          ${current?.localExportWarning ? `<p class="hint">${escapeHtml(current.localExportWarning)}</p>` : ""}
          <p class="hint">Sharp, cursor-inclusive screenshots are timestamped and paired with your narration when the PDF is created.</p>
        </section>
        ${renderHistory(history)}
      </div>
    </main>
  `;

  bind("#start", "click", () => startRecording());
  bind("#openMicSettings", "click", () => chrome.runtime.openOptionsPage());
  bind("#stop", "click", () => stopRecording());
  bind("#reviewPlan", "click", () => openPlanPage());
  bind("#newCapture", "click", () => startFreshCapture());
  bind("#pdfAction", "click", () => {
    if (!session?.captureAnalysis) void prepareCapturePlan();
    else if (session.status === "ready") void downloadPlanPdf(session);
    else void generateAndDownload();
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
  bind("#settings", "click", () => chrome.runtime.openOptionsPage());
}

function renderHistory(history: CaptureHistoryItem[]): string {
  if (history.length === 0) return "";
  return `<details class="panel history-panel">
    <summary>
      <span><strong>History</strong><small>Load a previous local capture</small></span>
      <span class="history-count">${history.length}</span>
    </summary>
    <div class="stack history-list">
      ${history.slice(0, 6).map((item) => `
        <div class="capture-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p class="hint">${formatHistoryDate(item.createdAt)} · ${item.imageCount} images · ${formatSeconds(item.durationSeconds)} · ${escapeHtml(item.folderName ?? "local capture")}</p>
          </div>
          <button class="button secondary load-history" data-capture-id="${escapeHtml(item.id)}">Load</button>
        </div>
      `).join("")}
    </div>
  </details>`;
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
    return;
  }
  startPdfProgress(await getSession());
  try {
    await run({ type: "GENERATE_PDF" });
    updatePdfProgress(92, "Building the PDF");
    const current = await getSession();
    await downloadPlanPdf(current);
    updatePdfProgress(100, "Done");
    await saveCaptureHistory(current);
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
    await openPlanPage();
  } catch (error) {
    localStatus = error instanceof Error ? error.message : String(error);
    await refresh();
  }
}

async function openPlanPage(): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL("plan.html") });
}

async function startFreshCapture(): Promise<void> {
  session = await resetSession();
  localStatus = "";
  await refresh();
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
    const exportFolderName = await recordingFolderPromise;
    const initialSession: RecordingSession = {
      ...(await resetSession()),
      status: "recording",
      startedAt,
      captureId,
      activeTabId: target?.id,
      activeWindowId: target?.windowId,
      tabUrl: target?.url,
      tabTitle: target?.title,
      exportFolderName,
      localExportWarning: exportFolderName ? undefined : "Capture is stored in JesSee. Local-folder export is unavailable; reconnect the folder in Settings to save files there.",
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

    lastScreenshotFingerprint = undefined;
    lastStoredScreenshotAtMs = -Infinity;
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
    localStatus = "Capturing. Click Close Capture when finished.";
    await captureMoment("screenshot");
    screenshotInterval = window.setInterval(() => {
      void captureMoment("screenshot");
    }, CAPTURE_INTERVAL_MS);
    await refresh();
  } catch (error) {
    void microphoneStreamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
    void screenStreamPromise.then((stream) => stream.getTracks().forEach((track) => track.stop())).catch(() => undefined);
    await disableOverlay();
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
      video: {
        cursor: "always",
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30, max: 60 }
      } as MediaTrackConstraints & { cursor: "always" },
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
      await captureMoment("screenshot", true);
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
  await waitForScreenshotQueue();
  await disableOverlay();
  const current = await getSession();
  const videoBlob = new Blob(videoChunks, { type: mediaRecorder?.mimeType || "video/webm" });
  const audioBlob = audioChunks.length ? new Blob(audioChunks, { type: audioRecorder?.mimeType || "audio/webm" }) : undefined;
  await writeRecordingBlob("recording.webm", videoBlob);
  if (audioBlob) await writeRecordingBlob("audio.webm", audioBlob);
  const captureId = current.captureId ?? crypto.randomUUID();
  const videoDataUrl = await putArtifact(`video:${captureId}`, await blobToDataUrl(videoBlob));
  const audioDataUrl = audioBlob
    ? await putArtifact(`audio:${captureId}`, await blobToDataUrl(audioBlob))
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
}

async function hardCleanupInterruptedRecording(message?: string): Promise<void> {
  await disableOverlay();
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

async function captureMoment(type: TimelineEvent["type"] = "screenshot", force = false): Promise<void> {
  if (screenshotInFlight) {
    if (force) queuedAnnotationCapture = true;
    return;
  }
  screenshotInFlight = true;
  try {
  if (!previewVideo || !session?.startedAt) return;
  const current = await getSession();
  const canvas = document.createElement("canvas");
  canvas.width = previewVideo.videoWidth || 1280;
  canvas.height = previewVideo.videoHeight || 720;
  const context = canvas.getContext("2d");
  context?.drawImage(previewVideo, 0, 0, canvas.width, canvas.height);
  const event = createEvent(current, type);
  const fingerprint = frameFingerprint(canvas);
  if (!force && fingerprint === lastScreenshotFingerprint && event.atMs - lastStoredScreenshotAtMs < MAX_SIMILAR_FRAME_GAP_MS) return;
  lastScreenshotFingerprint = fingerprint;
  lastStoredScreenshotAtMs = event.atMs;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const id = crypto.randomUUID();
  const artifactKey = `screenshot:${id}`;
  await putArtifact(artifactKey, dataUrl);
  const latest = await getSession();
  if (latest.status !== "recording") return;
  await writeScreenshot(`${String(latest.screenshots.length + 1).padStart(3, "0")}-${Math.round(event.atMs)}ms.jpg`, dataUrlToBlob(dataUrl));
  const screenshot: ScreenshotEvidence = {
    id,
    capturedAtMs: event.atMs,
    url: latest.tabUrl ?? "",
    title: latest.tabTitle ?? "",
    dataUrl: artifactRef(artifactKey),
    annotations: visiblePageRects(latest.timeline, "annotation"),
    redactions: visiblePageRects(latest.timeline, "redaction")
  };
  const nextSession = {
    ...latest,
    timeline: [...latest.timeline, { ...event, screenshotId: screenshot.id }],
    screenshots: [...latest.screenshots, screenshot]
  };
  await saveSession(nextSession);
  session = nextSession;
  } finally {
    screenshotInFlight = false;
    if (queuedAnnotationCapture) {
      queuedAnnotationCapture = false;
      void captureMoment("screenshot", true);
    }
  }
}

function requestAnnotationCapture(): void {
  if (screenshotInFlight) {
    queuedAnnotationCapture = true;
    return;
  }
  void captureMoment("screenshot", true);
}

async function waitForScreenshotQueue(): Promise<void> {
  while (screenshotInFlight || queuedAnnotationCapture) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}

async function disableOverlay(): Promise<void> {
  await send({ type: "SET_OVERLAY_MODE", mode: "off" }).catch(() => undefined);
}

function frameFingerprint(canvas: HTMLCanvasElement): string {
  const sample = document.createElement("canvas");
  // This is intentionally large enough to retain the cursor halo and small
  // control changes that a 32×18 sample erased, while still avoiding full PNG
  // storage for visually identical frames.
  sample.width = 256;
  sample.height = 144;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return `${canvas.width}x${canvas.height}:${Date.now()}`;
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let hash = 2166136261;
  for (let index = 0; index < pixels.length; index += 12) {
    hash ^= pixels[index] ^ pixels[index + 1] ^ pixels[index + 2];
    hash = Math.imul(hash, 16777619);
  }
  return `${canvas.width}x${canvas.height}:${hash >>> 0}`;
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
  screenshotInFlight = false;
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
  if (percent < 55) return "Preparing visual story";
  if (percent < 90) return "Adding selected screenshots";
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
  const selectedImageCount = current.captureAnalysis?.storySteps?.filter((step) => step.screenshotId).length ?? 0;
  return Math.round(Math.min(20, Math.max(3, 2 + selectedImageCount * 0.25)));
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
