import "./ui.css";
import { hydrateSession } from "./artifacts";
import { buildCaptureStory, splitTranscriptIntoSentences } from "./captureStory";
import { saveCaptureHistory } from "./captureHistory";
import { getPlanPdfAction } from "./captureFlow";
import { downloadPlanPdf } from "./pdfDownload";
import { rankScreenshotsForStep, screenshotTimingLabel, type ScreenshotCandidate } from "./imagePicker";
import { getSession, saveSession } from "./storage";
import type { CaptureAnalysis, CaptureStoryStep, RecordingSession, RuntimeMessage, TranscriptionResult } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

let session: RecordingSession;
let hydrated: RecordingSession;
let activeStoryIndex = 0;
let saveTimer: number | undefined;
let statusMessage = "Saved automatically";
let planDirty = false;
let showAllScreenshots = false;
let imagePage = 0;

const IMAGES_PER_PAGE = 12;

void initialize();

async function initialize(): Promise<void> {
  session = await getSession();
  hydrated = await hydrateSession(session);
  render();
}

function render(): void {
  const analysis = session.captureAnalysis;
  if (!analysis) {
    root.innerHTML = `<main class="plan-page"><section class="empty-state"><h1>No plan yet</h1><p>Create a plan from the JesSee recorder, then return here to review its screenshots.</p></section></main>`;
    return;
  }

  const transcriptSegments = splitTranscriptIntoSentences(session.transcript?.segments ?? []);
  const storySteps = buildCaptureStory(analysis, session.transcript, session.timeline, hydrated.screenshots);
  activeStoryIndex = Math.min(activeStoryIndex, Math.max(0, storySteps.length - 1));
  const activeStep = storySteps[activeStoryIndex];
  const selectedShot = hydrated.screenshots.find((shot) => shot.id === activeStep?.screenshotId);
  const selectedShotIndex = selectedShot ? hydrated.screenshots.findIndex((shot) => shot.id === selectedShot.id) : -1;
  const suggestedImages = activeStep ? rankScreenshotsForStep(activeStep, hydrated.screenshots) : [];
  const imagePageCount = Math.max(1, Math.ceil(hydrated.screenshots.length / IMAGES_PER_PAGE));
  imagePage = Math.min(imagePage, imagePageCount - 1);
  const visibleImages = activeStep
    ? showAllScreenshots
      ? hydrated.screenshots.slice(imagePage * IMAGES_PER_PAGE, (imagePage + 1) * IMAGES_PER_PAGE).map((shot) => ({
          shot,
          index: hydrated.screenshots.findIndex((candidate) => candidate.id === shot.id),
          score: 0,
          reason: screenshotTimingLabel(shot, activeStep)
        }))
      : suggestedImages
    : [];
  const topSuggestionId = suggestedImages[0]?.shot.id;
  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];
  const pdfAction = getPlanPdfAction(session.status, planDirty);

  root.innerHTML = `
    <main class="plan-page">
      <header class="plan-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Visual playbook</p>
            <h1>${escapeHtml(session.tabTitle || analysis.userGoal || "JesSee capture")}</h1>
            <p class="hint">${storySteps.length} story section${storySteps.length === 1 ? "" : "s"} · ${hydrated.screenshots.length} captured image${hydrated.screenshots.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="header-actions">
          <span class="save-status" id="saveStatus">${escapeHtml(statusMessage)}</span>
          <button class="button secondary compact" id="settings">Settings</button>
          <button class="button primary compact" id="generatePdf" ${pdfAction.disabled ? "disabled" : ""}>${pdfAction.label}</button>
        </div>
      </header>

      <div class="plan-layout">
        <aside class="panel plan-copy playbook-panel">
          <div class="panel-header"><div><p class="section-eyebrow">Playbook</p><h2>The whole story at a glance</h2><p>Refine the intent here, then work through each section on the right.</p></div></div>
          <div class="playbook-piece">
            <span class="piece-number">01</span>
            <div class="field"><label for="planGoal">Outcome</label><textarea id="planGoal" rows="3">${escapeHtml(analysis.userGoal)}</textarea></div>
          </div>
          <div class="playbook-piece">
            <span class="piece-number">02</span>
            <div class="field"><label for="planKeyPoints">Key takeaways</label><textarea id="planKeyPoints" rows="6">${escapeHtml(keyPoints.join("\n"))}</textarea><p class="field-help">One important point per line.</p></div>
          </div>
          <div class="playbook-piece">
            <span class="piece-number">03</span>
            <div class="field"><label for="planStory">Executive summary</label><textarea id="planStory" rows="5">${escapeHtml(analysis.story)}</textarea></div>
          </div>
          <details class="transcript-panel">
            <summary><span>Transcript</span><strong>${transcriptSegments.length} timestamped sentence${transcriptSegments.length === 1 ? "" : "s"}</strong></summary>
            <div class="transcript-list">
              ${renderTranscript(transcriptSegments, storySteps)}
            </div>
          </details>
        </aside>

        <section class="panel evidence-inspector story-inspector">
          <div class="panel-header">
            <div><p class="section-eyebrow">Story sections</p><h2>Build the playbook one piece at a time</h2><p>${storySteps.length ? `Section ${activeStoryIndex + 1} of ${storySteps.length} · choose the words and image that make this moment clear` : "No story sections available"}</p></div>
            <button class="button secondary compact" id="addStory">+ Add step</button>
          </div>
          ${storySteps.length && activeStep ? `
            <nav class="story-outline" aria-label="Playbook sections">
              ${storySteps.map((item, index) => `<button class="story-outline-item ${index === activeStoryIndex ? "active" : ""}" data-story="${index}" aria-current="${index === activeStoryIndex ? "step" : "false"}">
                <span class="story-outline-number">${String(index + 1).padStart(2, "0")}</span>
                <span><strong>${escapeHtml(item.title)}</strong><small>${storyKindLabel(item)} · ${formatTimeRange(item.startSeconds, item.endSeconds)}</small></span>
              </button>`).join("")}
            </nav>
            <div class="story-stepper">
              <button class="button secondary" id="previousStory" ${activeStoryIndex === 0 ? "disabled" : ""}>← Previous</button>
              <span>Section ${activeStoryIndex + 1} of ${storySteps.length}</span>
              <button class="button secondary" id="nextStory" ${activeStoryIndex === storySteps.length - 1 ? "disabled" : ""}>Next section →</button>
            </div>
            <article class="story-card">
              <div class="story-meta">
                <span class="story-kind ${activeStep.kind ?? "narration"}">${activeStep.kind === "page-change" ? "Page change" : activeStep.kind === "manual" ? "Added step" : activeStep.kind === "action" ? "Action" : "User narration"}</span>
                <span>${formatTimeRange(activeStep.startSeconds, activeStep.endSeconds)}</span>
              </div>
              <div class="field"><label for="planStepTitle">Story heading</label><input id="planStepTitle" value="${escapeHtml(activeStep.title)}" /></div>
              <div class="field"><label for="planNarrative">What this part of the story communicates</label><textarea id="planNarrative" rows="4">${escapeHtml(activeStep.narrative)}</textarea></div>
              ${activeStep.transcript ? `<div class="transcript-quote"><span>What the user said · ${formatTimeRange(activeStep.startSeconds, activeStep.endSeconds)}</span><blockquote>${escapeHtml(activeStep.transcript)}</blockquote></div>` : ""}
              ${activeStep.pageUrl ? `<div class="page-context"><span>${activeStep.kind === "page-change" ? "Page changed to" : "Page context"}</span><strong>${escapeHtml(activeStep.pageTitle || activeStep.pageUrl)}</strong><small>${escapeHtml(activeStep.pageUrl)}</small></div>` : ""}
            </article>
            <section class="image-picker-section">
              <input id="planShot" type="hidden" value="${escapeHtml(activeStep.screenshotId ?? "")}" />
              <div class="image-picker-header">
                <div>
                  <p class="section-eyebrow">Visual evidence</p>
                  <h2>Pick the image that proves this section</h2>
                  <p>JesSee starts with the closest resulting state on the same page. You stay in control of the final choice.</p>
                </div>
                <div class="segmented-control" aria-label="Screenshot view">
                  <button id="suggestedImages" class="${showAllScreenshots ? "" : "active"}" aria-pressed="${!showAllScreenshots}">Best matches</button>
                  <button id="allImages" class="${showAllScreenshots ? "active" : ""}" aria-pressed="${showAllScreenshots}">All images</button>
                </div>
              </div>
              <div class="image-choice-grid" role="radiogroup" aria-label="Choose screenshot for this section">
                <button class="image-choice image-choice-none ${!activeStep.screenshotId ? "selected" : ""}" data-image-id="" role="radio" aria-checked="${!activeStep.screenshotId}">
                  <span class="image-choice-empty">No image</span>
                  <strong>Text only</strong>
                  <small>Use when the image adds no proof</small>
                </button>
                ${visibleImages.map((candidate) => renderImageChoice(candidate, activeStep, topSuggestionId)).join("")}
              </div>
              ${showAllScreenshots && imagePageCount > 1 ? `<div class="image-pagination">
                <button class="button secondary compact" id="previousImagePage" ${imagePage === 0 ? "disabled" : ""}>← Earlier</button>
                <span>Images ${imagePage * IMAGES_PER_PAGE + 1}–${Math.min((imagePage + 1) * IMAGES_PER_PAGE, hydrated.screenshots.length)} of ${hydrated.screenshots.length}</span>
                <button class="button secondary compact" id="nextImagePage" ${imagePage === imagePageCount - 1 ? "disabled" : ""}>Later →</button>
              </div>` : ""}
            </section>
            <section class="selected-image-panel">
              <div class="selected-image-heading">
                <div><p class="section-eyebrow">Selected image</p><h2>${selectedShot ? `${formatMs(selectedShot.capturedAtMs)} · ${escapeHtml(selectedShot.title || selectedShot.url || "Captured screen")}` : "No image selected"}</h2></div>
                ${selectedShot ? `<span class="selected-pill">✓ Included in PDF</span>` : ""}
              </div>
              <div class="screenshot-stage">
                ${selectedShot ? `<img src="${selectedShot.dataUrl}" alt="Screenshot captured at ${formatMs(selectedShot.capturedAtMs)}" />` : `<div class="screenshot-empty">Choose a best match above, or keep this section text-only.</div>`}
              </div>
              ${selectedShot ? `<div class="screenshot-meta"><strong>${formatMs(selectedShot.capturedAtMs)}</strong><span>${escapeHtml(selectedShot.title || selectedShot.url)}</span></div>` : ""}
              <div class="image-stepper">
                <button class="button secondary" id="previousImage" ${selectedShotIndex <= 0 ? "disabled" : ""}>← Previous captured image</button>
                <span>${selectedShotIndex >= 0 ? `${selectedShotIndex + 1} of ${hydrated.screenshots.length}` : `${hydrated.screenshots.length} images available`}</span>
                <button class="button secondary" id="nextImage" ${selectedShotIndex < 0 || selectedShotIndex >= hydrated.screenshots.length - 1 ? "disabled" : ""}>Next captured image →</button>
              </div>
            </section>
          ` : `<div class="screenshot-empty">This capture does not have a timestamped transcript or story yet. Return to the recorder and create a plan to build the walkthrough.</div>`}
        </section>
      </div>
    </main>`;

  bindAutosave("#planGoal");
  bindAutosave("#planKeyPoints");
  bindAutosave("#planStory");
  bindAutosave("#planStepTitle");
  bindAutosave("#planNarrative");
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".story-outline-item")) {
    tab.addEventListener("click", async () => {
      await persistPlan();
      activeStoryIndex = Number(tab.dataset.story ?? 0);
      showAllScreenshots = false;
      imagePage = 0;
      render();
    });
  }
  for (const choice of document.querySelectorAll<HTMLButtonElement>(".image-choice")) {
    choice.addEventListener("click", () => void selectImage(choice.dataset.imageId ?? ""));
  }
  for (const row of document.querySelectorAll<HTMLButtonElement>(".transcript-row[data-story-index]")) {
    row.addEventListener("click", async () => {
      await persistPlan();
      activeStoryIndex = Number(row.dataset.storyIndex ?? 0);
      render();
    });
  }
  document.querySelector("#previousStory")?.addEventListener("click", () => void stepStory(-1));
  document.querySelector("#nextStory")?.addEventListener("click", () => void stepStory(1));
  document.querySelector("#addStory")?.addEventListener("click", () => void addStoryStep());
  document.querySelector("#previousImage")?.addEventListener("click", () => void stepImage(-1));
  document.querySelector("#nextImage")?.addEventListener("click", () => void stepImage(1));
  document.querySelector("#suggestedImages")?.addEventListener("click", () => {
    showAllScreenshots = false;
    imagePage = 0;
    render();
  });
  document.querySelector("#allImages")?.addEventListener("click", () => {
    showAllScreenshots = true;
    if (selectedShotIndex >= 0) imagePage = Math.floor(selectedShotIndex / IMAGES_PER_PAGE);
    render();
  });
  document.querySelector("#previousImagePage")?.addEventListener("click", () => {
    imagePage = Math.max(0, imagePage - 1);
    render();
  });
  document.querySelector("#nextImagePage")?.addEventListener("click", () => {
    imagePage = Math.min(imagePageCount - 1, imagePage + 1);
    render();
  });
  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#generatePdf")?.addEventListener("click", () => void generatePdf());
}

function bindAutosave(selector: string): void {
  document.querySelector(selector)?.addEventListener("input", scheduleSave);
}

function scheduleSave(): void {
  planDirty = true;
  statusMessage = "Saving…";
  updateSaveStatus();
  updatePdfAction();
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persistPlan(), 450);
}

async function persistPlan(): Promise<void> {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!session.captureAnalysis || !planDirty) return;
  const nextAnalysis = collectAnalysis(session.captureAnalysis);
  session = {
    ...session,
    captureAnalysis: nextAnalysis,
    status: "planned",
    analysisError: undefined
  };
  await saveSession(session);
  await saveCaptureHistory(session);
  planDirty = false;
  statusMessage = "Saved automatically";
  updateSaveStatus();
}

function collectAnalysis(current: CaptureAnalysis): CaptureAnalysis {
  const storySteps = buildCaptureStory(current, session.transcript, session.timeline, hydrated.screenshots)
    .map((step, index) => index === activeStoryIndex ? {
      ...step,
      title: document.querySelector<HTMLInputElement>("#planStepTitle")?.value.trim() ?? step.title,
      narrative: document.querySelector<HTMLTextAreaElement>("#planNarrative")?.value.trim() ?? step.narrative,
      screenshotId: document.querySelector<HTMLInputElement>("#planShot")?.value || undefined
    } : step);
  return {
    userGoal: document.querySelector<HTMLTextAreaElement>("#planGoal")?.value.trim() ?? current.userGoal,
    keyPoints: (document.querySelector<HTMLTextAreaElement>("#planKeyPoints")?.value ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
    story: document.querySelector<HTMLTextAreaElement>("#planStory")?.value.trim() ?? current.story,
    helpfulImageMoments: storySteps.filter((step) => step.screenshotId).map((step) => ({
      screenshotId: step.screenshotId,
      atSeconds: step.endSeconds,
      reason: step.narrative || step.title
    })),
    storySteps
  };
}

async function addStoryStep(): Promise<void> {
  await persistPlan();
  if (!session.captureAnalysis) return;
  const storySteps = buildCaptureStory(session.captureAnalysis, session.transcript, session.timeline, hydrated.screenshots);
  const previous = storySteps[activeStoryIndex] ?? storySteps.at(-1);
  const timestamp = previous?.endSeconds ?? session.transcript?.segments.at(-1)?.end ?? 0;
  const insertionIndex = storySteps.length ? activeStoryIndex + 1 : 0;
  storySteps.splice(insertionIndex, 0, {
    startSeconds: timestamp,
    endSeconds: timestamp,
    title: "New story step",
    narrative: "",
    transcript: "",
    kind: "manual"
  });
  session = {
    ...session,
    status: "planned",
    captureAnalysis: {
      ...session.captureAnalysis,
      storySteps,
      helpfulImageMoments: storySteps.filter((step) => step.screenshotId).map((step) => ({
        screenshotId: step.screenshotId,
        atSeconds: step.endSeconds,
        reason: step.narrative || step.title
      }))
    }
  };
  await saveSession(session);
  await saveCaptureHistory(session);
  activeStoryIndex = insertionIndex;
  showAllScreenshots = false;
  imagePage = 0;
  render();
}

async function stepStory(direction: -1 | 1): Promise<void> {
  await persistPlan();
  const storySteps = buildCaptureStory(session.captureAnalysis!, session.transcript, session.timeline, hydrated.screenshots);
  activeStoryIndex = Math.max(0, Math.min(storySteps.length - 1, activeStoryIndex + direction));
  showAllScreenshots = false;
  imagePage = 0;
  render();
}

async function stepImage(direction: -1 | 1): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#planShot");
  if (!input) return;
  const currentIndex = hydrated.screenshots.findIndex((shot) => shot.id === input.value);
  const next = hydrated.screenshots[currentIndex + direction];
  if (!next) return;
  input.value = next.id;
  planDirty = true;
  await persistPlan();
  await refreshHydratedSession();
}

async function selectImage(imageId: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("#planShot");
  if (!input || input.value === imageId) return;
  input.value = imageId;
  planDirty = true;
  statusMessage = "Saving…";
  updateSaveStatus();
  updatePdfAction();
  await persistPlan();
  await refreshHydratedSession();
}

async function refreshHydratedSession(): Promise<void> {
  hydrated = await hydrateSession(session);
  render();
}

async function generatePdf(): Promise<void> {
  await persistPlan();
  if (session.status === "ready") {
    await downloadPlanPdf(session);
    setStatus("PDF downloaded");
    return;
  }
  setStatus("Creating your PDF…");
  try {
    const response = await send({ type: "GENERATE_PDF" });
    if (!response.ok) throw new Error(response.error ?? "PDF generation failed.");
    session = await getSession();
    await downloadPlanPdf(session);
    await saveCaptureHistory(session);
    setStatus("PDF downloaded");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function updateSaveStatus(): void {
  const element = document.querySelector<HTMLElement>("#saveStatus");
  if (element) element.textContent = statusMessage;
}

function updatePdfAction(): void {
  const element = document.querySelector<HTMLButtonElement>("#generatePdf");
  if (!element) return;
  const action = getPlanPdfAction(session.status, planDirty);
  element.textContent = action.label;
  element.disabled = action.disabled;
}

function setStatus(message: string): void {
  statusMessage = message;
  updateSaveStatus();
}

function send(message: RuntimeMessage): Promise<{ ok: boolean; session?: RecordingSession; error?: string }> {
  return chrome.runtime.sendMessage(message);
}

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatTimeRange(startSeconds: number, endSeconds: number): string {
  const start = formatMs(startSeconds * 1000);
  const end = formatMs(endSeconds * 1000);
  return start === end ? start : `${start}–${end}`;
}

function renderImageChoice(candidate: ScreenshotCandidate, step: CaptureStoryStep, topSuggestionId?: string): string {
  const selected = candidate.shot.id === step.screenshotId;
  const recommended = candidate.shot.id === topSuggestionId;
  return `<button class="image-choice ${selected ? "selected" : ""}" data-image-id="${escapeHtml(candidate.shot.id)}" role="radio" aria-checked="${selected}" aria-label="Choose image ${candidate.index + 1}, captured ${screenshotTimingLabel(candidate.shot, step)}">
    <span class="image-choice-preview">
      <img src="${candidate.shot.dataUrl}" alt="" loading="lazy" />
      <span class="image-choice-index">${String(candidate.index + 1).padStart(2, "0")}</span>
      ${recommended ? `<span class="recommended-pill">Best match</span>` : ""}
      ${selected ? `<span class="choice-check" aria-hidden="true">✓</span>` : ""}
    </span>
    <strong>${screenshotTimingLabel(candidate.shot, step)}</strong>
    <small>${escapeHtml(candidate.reason)}</small>
  </button>`;
}

function storyKindLabel(step: CaptureStoryStep): string {
  if (step.kind === "page-change") return "Page change";
  if (step.kind === "manual") return "Added section";
  if (step.kind === "action") return "Action";
  return "Narration";
}

function renderTranscript(segments: TranscriptionResult["segments"], storySteps: CaptureStoryStep[]): string {
  if (segments.length === 0) return `<p class="transcript-empty">No timestamped transcript is available for this capture.</p>`;
  return segments.map((segment) => {
    const storyIndex = storySteps.findIndex((step) => step.transcript === segment.text && step.startSeconds === segment.start);
    return `<button class="transcript-row ${storyIndex === activeStoryIndex ? "active" : ""}" ${storyIndex >= 0 ? `data-story-index="${storyIndex}"` : "disabled"}>
      <time>${formatTimeRange(segment.start, segment.end)}</time>
      <span>${escapeHtml(segment.text)}</span>
    </button>`;
  }).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
