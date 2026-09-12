import "./ui.css";
import { hydrateSession } from "./artifacts";
import { buildCaptureStory } from "./captureStory";
import { saveCaptureHistory } from "./captureHistory";
import { getPlanPdfAction } from "./captureFlow";
import { downloadPlanPdf } from "./pdfDownload";
import { rankScreenshotsForStep, screenshotTimingLabel, type ScreenshotCandidate } from "./imagePicker";
import { sendRuntimeMessage } from "./runtimeMessaging";
import { getSession, saveSession } from "./storage";
import type { CaptureAnalysis, CaptureStoryStep, RecordingSession, RuntimeMessage } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

type PlanMode = "read" | "edit";

let session: RecordingSession;
let hydrated: RecordingSession;
let planMode: PlanMode = "read";
let saveTimer: number | undefined;
let statusMessage = "Saved automatically";
let planDirty = false;
let imageDialogStepIndex: number | undefined;
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

  const storySteps = buildCaptureStory(analysis, session.transcript, session.timeline, hydrated.screenshots);
  if (imageDialogStepIndex !== undefined && !storySteps[imageDialogStepIndex]) imageDialogStepIndex = undefined;
  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];
  const selectedVisualCount = storySteps.filter((step) => step.screenshotId).length;
  const pdfAction = getPlanPdfAction(session.status, planDirty);

  root.innerHTML = `
    <main class="plan-page">
      <header class="plan-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Shareable walkthrough</p>
            <h1>${escapeHtml(session.tabTitle || analysis.userGoal || "JesSee capture")}</h1>
            <p class="hint">${storySteps.length} step${storySteps.length === 1 ? "" : "s"} · ${selectedVisualCount} selected visual${selectedVisualCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="header-actions plan-header-actions">
          <div class="segmented-control mode-switch" aria-label="Walkthrough mode">
            <button id="readMode" class="${planMode === "read" ? "active" : ""}" aria-pressed="${planMode === "read"}">Read</button>
            <button id="editMode" class="${planMode === "edit" ? "active" : ""}" aria-pressed="${planMode === "edit"}">Edit</button>
          </div>
          <span class="save-status" id="saveStatus" role="status" aria-live="polite">${escapeHtml(statusMessage)}</span>
          <button class="button secondary compact" id="settings">Settings</button>
          <button class="button primary compact" id="generatePdf" ${pdfAction.disabled ? "disabled" : ""}>${pdfAction.label}</button>
        </div>
      </header>

      <div class="walkthrough-document">
        ${renderOverview(analysis, keyPoints)}
        <section class="walkthrough-steps" aria-labelledby="walkthroughStepsTitle">
          <div class="walkthrough-section-header">
            <div>
              <p class="section-eyebrow">The walkthrough</p>
              <h2 id="walkthroughStepsTitle">The complete explanation, step by step</h2>
              <p>${planMode === "read" ? "Read it as your audience will. Open any image to compare the other captured moments." : "Edit the reader-facing words, add steps, and choose the strongest visual for each moment."}</p>
            </div>
            ${planMode === "edit" ? `<button class="button secondary compact" id="addStory">+ Add step</button>` : ""}
          </div>
          <div class="story-document">
            ${storySteps.map((step, index) => renderStoryStep(step, index)).join("")}
          </div>
        </section>
      </div>
      ${imageDialogStepIndex === undefined ? "" : renderImageDialog(storySteps[imageDialogStepIndex], imageDialogStepIndex)}
    </main>`;

  bindEvents();
  const dialog = document.querySelector<HTMLDialogElement>("#imageDialog");
  if (dialog && !dialog.open) dialog.showModal();
}

function renderOverview(analysis: CaptureAnalysis, keyPoints: string[]): string {
  if (planMode === "edit") {
    return `<section class="panel walkthrough-overview edit-overview" aria-labelledby="overviewTitle">
      <div class="walkthrough-section-header">
        <div><p class="section-eyebrow">Document overview</p><h2 id="overviewTitle">Shape the explanation</h2><p>These reader-facing words introduce the walkthrough and become the opening of the PDF.</p></div>
      </div>
      <div class="overview-edit-grid">
        <div class="field"><label for="planGoal">Outcome</label><textarea class="plan-field" id="planGoal" rows="3">${escapeHtml(analysis.userGoal)}</textarea></div>
        <div class="field"><label for="planStory">Summary</label><textarea class="plan-field" id="planStory" rows="4">${escapeHtml(analysis.story)}</textarea></div>
        <div class="field overview-key-points"><label for="planKeyPoints">Key points</label><textarea class="plan-field" id="planKeyPoints" rows="5">${escapeHtml(keyPoints.join("\n"))}</textarea><p class="field-help">One important point per line.</p></div>
      </div>
    </section>`;
  }

  return `<section class="panel walkthrough-overview read-overview" aria-labelledby="overviewTitle">
    <p class="section-eyebrow">What this walkthrough communicates</p>
    <h2 id="overviewTitle" class="document-title">${escapeHtml(analysis.userGoal || session.tabTitle || "Visual walkthrough")}</h2>
    ${analysis.story ? `<p class="document-summary">${escapeHtml(analysis.story)}</p>` : ""}
    ${keyPoints.length ? `<div class="takeaway-block"><h3>Key points</h3><ul>${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>` : ""}
  </section>`;
}

function renderStoryStep(step: CaptureStoryStep, index: number): string {
  const selectedShot = hydrated.screenshots.find((shot) => shot.id === step.screenshotId);
  const imageLabel = selectedShot ? `View alternative images for step ${index + 1}` : `Choose an image for step ${index + 1}`;
  const imageButton = `<button class="story-image-trigger ${selectedShot ? "" : "empty"}" data-image-step="${index}" aria-label="${imageLabel}" ${hydrated.screenshots.length ? "" : "disabled"}>
    ${selectedShot
      ? `<span class="story-image-frame"><img src="${selectedShot.dataUrl}" alt="Selected visual for step ${index + 1}: ${escapeHtml(selectedShot.title || selectedShot.url || "Captured screen")}" /><span class="image-action">See alternatives</span></span>
         <span class="story-image-caption"><strong>${formatMs(selectedShot.capturedAtMs)}</strong><span>${escapeHtml(selectedShot.title || selectedShot.url || "Captured screen")}</span><em>Included in PDF</em></span>`
      : `<span class="story-image-empty">${hydrated.screenshots.length ? "Choose the visual that best completes this step" : "No captured images are available"}</span>`}
  </button>`;

  return `<article class="walkthrough-step" id="story-step-${index + 1}">
    <div class="step-rail" aria-hidden="true"><span>${String(index + 1).padStart(2, "0")}</span><i></i></div>
    <div class="step-content">
      <div class="story-meta">
        <span class="story-kind ${step.kind ?? "narration"}">${storyKindLabel(step)}</span>
        <span>${formatTimeRange(step.startSeconds, step.endSeconds)}</span>
      </div>
      ${planMode === "edit"
        ? `<div class="step-edit-fields">
            <div class="field"><label for="planStepTitle-${index}">Step heading</label><input class="plan-field" id="planStepTitle-${index}" value="${escapeHtml(step.title)}" /></div>
            <div class="field"><label for="planNarrative-${index}">Reader-facing explanation</label><textarea class="plan-field" id="planNarrative-${index}" rows="4">${escapeHtml(step.narrative)}</textarea></div>
          </div>`
        : `<h2 class="step-title">${escapeHtml(step.title)}</h2><p class="step-narrative">${escapeHtml(step.narrative)}</p>`}
      ${imageButton}
      ${step.pageUrl ? `<div class="page-context compact-context"><span>${step.kind === "page-change" ? "Opened" : "Page"}</span><strong>${escapeHtml(step.pageTitle || step.pageUrl)}</strong><small>${escapeHtml(step.pageUrl)}</small></div>` : ""}
      ${planMode === "edit" && step.transcript ? `<details class="source-narration"><summary>Original narration <span>${formatTimeRange(step.startSeconds, step.endSeconds)}</span></summary><blockquote>${escapeHtml(step.transcript)}</blockquote></details>` : ""}
    </div>
  </article>`;
}

function renderImageDialog(step: CaptureStoryStep, stepIndex: number): string {
  const suggestedImages = rankScreenshotsForStep(step, hydrated.screenshots);
  const imagePageCount = Math.max(1, Math.ceil(hydrated.screenshots.length / IMAGES_PER_PAGE));
  imagePage = Math.min(imagePage, imagePageCount - 1);
  const visibleImages = showAllScreenshots
    ? hydrated.screenshots.slice(imagePage * IMAGES_PER_PAGE, (imagePage + 1) * IMAGES_PER_PAGE).map((shot) => ({
        shot,
        index: hydrated.screenshots.findIndex((candidate) => candidate.id === shot.id),
        score: 0,
        reason: screenshotTimingLabel(shot, step)
      }))
    : suggestedImages;
  const topSuggestionId = suggestedImages[0]?.shot.id;

  return `<dialog class="image-dialog" id="imageDialog" aria-labelledby="imageDialogTitle">
    <div class="image-dialog-card">
      <div class="image-dialog-header">
        <div><p class="section-eyebrow">Step ${stepIndex + 1} visual</p><h2 id="imageDialogTitle">Choose the clearest moment</h2><p>${escapeHtml(step.title)} · JesSee recommends the closest resulting state, but every captured image remains available.</p></div>
        <button class="icon-button" id="closeImageDialog" aria-label="Close image choices">×</button>
      </div>
      <div class="image-dialog-toolbar">
        <div class="segmented-control" aria-label="Screenshot choices">
          <button id="suggestedImages" class="${showAllScreenshots ? "" : "active"}" aria-pressed="${!showAllScreenshots}">Best matches</button>
          <button id="allImages" class="${showAllScreenshots ? "active" : ""}" aria-pressed="${showAllScreenshots}">All images</button>
        </div>
        <span>${hydrated.screenshots.length} captured image${hydrated.screenshots.length === 1 ? "" : "s"}</span>
      </div>
      <div class="image-choice-grid dialog-image-grid" role="radiogroup" aria-label="Choose screenshot for step ${stepIndex + 1}">
        <button class="image-choice image-choice-none ${!step.screenshotId ? "selected" : ""}" data-image-step="${stepIndex}" data-image-id="" role="radio" aria-checked="${!step.screenshotId}">
          <span class="image-choice-empty">No image</span><strong>Text only</strong><small>Use when a visual adds no clarity</small>
        </button>
        ${visibleImages.map((candidate) => renderImageChoice(candidate, step, stepIndex, topSuggestionId)).join("")}
      </div>
      ${showAllScreenshots && imagePageCount > 1 ? `<div class="image-pagination">
        <button class="button secondary compact" id="previousImagePage" ${imagePage === 0 ? "disabled" : ""}>← Earlier</button>
        <span>Images ${imagePage * IMAGES_PER_PAGE + 1}-${Math.min((imagePage + 1) * IMAGES_PER_PAGE, hydrated.screenshots.length)} of ${hydrated.screenshots.length}</span>
        <button class="button secondary compact" id="nextImagePage" ${imagePage === imagePageCount - 1 ? "disabled" : ""}>Later →</button>
      </div>` : ""}
    </div>
  </dialog>`;
}

function bindEvents(): void {
  for (const field of document.querySelectorAll<HTMLElement>(".plan-field")) field.addEventListener("input", scheduleSave);
  document.querySelector("#readMode")?.addEventListener("click", () => void switchMode("read"));
  document.querySelector("#editMode")?.addEventListener("click", () => void switchMode("edit"));
  document.querySelector("#addStory")?.addEventListener("click", () => void addStoryStep());
  document.querySelector("#settings")?.addEventListener("click", async () => {
    await persistPlan();
    chrome.runtime.openOptionsPage();
  });
  document.querySelector("#generatePdf")?.addEventListener("click", () => void generatePdf());
  for (const trigger of document.querySelectorAll<HTMLButtonElement>(".story-image-trigger")) {
    trigger.addEventListener("click", () => void openImageDialog(Number(trigger.dataset.imageStep ?? 0)));
  }
  for (const choice of document.querySelectorAll<HTMLButtonElement>(".image-choice[data-image-step]")) {
    choice.addEventListener("click", () => void selectImage(Number(choice.dataset.imageStep ?? 0), choice.dataset.imageId ?? ""));
  }
  document.querySelector("#closeImageDialog")?.addEventListener("click", closeImageDialog);
  document.querySelector<HTMLDialogElement>("#imageDialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeImageDialog();
  });
  document.querySelector<HTMLDialogElement>("#imageDialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageDialog();
  });
  document.querySelector("#suggestedImages")?.addEventListener("click", () => {
    showAllScreenshots = false;
    imagePage = 0;
    render();
  });
  document.querySelector("#allImages")?.addEventListener("click", () => {
    showAllScreenshots = true;
    const step = currentDialogStep();
    const selectedIndex = step ? hydrated.screenshots.findIndex((shot) => shot.id === step.screenshotId) : -1;
    imagePage = selectedIndex >= 0 ? Math.floor(selectedIndex / IMAGES_PER_PAGE) : 0;
    render();
  });
  document.querySelector("#previousImagePage")?.addEventListener("click", () => {
    imagePage = Math.max(0, imagePage - 1);
    render();
  });
  document.querySelector("#nextImagePage")?.addEventListener("click", () => {
    imagePage += 1;
    render();
  });
}

async function switchMode(mode: PlanMode): Promise<void> {
  if (mode === planMode) return;
  await persistPlan();
  planMode = mode;
  imageDialogStepIndex = undefined;
  render();
}

async function openImageDialog(stepIndex: number): Promise<void> {
  await persistPlan();
  imageDialogStepIndex = stepIndex;
  showAllScreenshots = false;
  imagePage = 0;
  render();
}

function closeImageDialog(): void {
  document.querySelector<HTMLDialogElement>("#imageDialog")?.close();
  imageDialogStepIndex = undefined;
  render();
}

function currentDialogStep(): CaptureStoryStep | undefined {
  if (imageDialogStepIndex === undefined || !session.captureAnalysis) return undefined;
  return buildCaptureStory(session.captureAnalysis, session.transcript, session.timeline, hydrated.screenshots)[imageDialogStepIndex];
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
  session = {
    ...session,
    captureAnalysis: collectAnalysis(session.captureAnalysis),
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
  const storySteps = buildCaptureStory(current, session.transcript, session.timeline, hydrated.screenshots).map((step, index) => ({
    ...step,
    title: document.querySelector<HTMLInputElement>(`#planStepTitle-${index}`)?.value.trim() ?? step.title,
    narrative: document.querySelector<HTMLTextAreaElement>(`#planNarrative-${index}`)?.value.trim() ?? step.narrative
  }));
  const keyPointsField = document.querySelector<HTMLTextAreaElement>("#planKeyPoints");
  return withStorySteps({
    ...current,
    userGoal: document.querySelector<HTMLTextAreaElement>("#planGoal")?.value.trim() ?? current.userGoal,
    keyPoints: keyPointsField ? keyPointsField.value.split("\n").map((item) => item.trim()).filter(Boolean) : current.keyPoints,
    story: document.querySelector<HTMLTextAreaElement>("#planStory")?.value.trim() ?? current.story
  }, storySteps);
}

async function addStoryStep(): Promise<void> {
  await persistPlan();
  if (!session.captureAnalysis) return;
  const storySteps = buildCaptureStory(session.captureAnalysis, session.transcript, session.timeline, hydrated.screenshots);
  const previous = storySteps.at(-1);
  const timestamp = previous?.endSeconds ?? session.transcript?.segments.at(-1)?.end ?? 0;
  storySteps.push({ startSeconds: timestamp, endSeconds: timestamp, title: "New step", narrative: "", transcript: "", kind: "manual" });
  await saveStorySteps(storySteps);
  planMode = "edit";
  render();
  document.querySelector(`#story-step-${storySteps.length}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function selectImage(stepIndex: number, imageId: string): Promise<void> {
  await persistPlan();
  if (!session.captureAnalysis) return;
  const storySteps = buildCaptureStory(session.captureAnalysis, session.transcript, session.timeline, hydrated.screenshots)
    .map((step, index) => index === stepIndex ? { ...step, screenshotId: imageId || undefined } : step);
  await saveStorySteps(storySteps);
  imageDialogStepIndex = undefined;
  statusMessage = "Image selected and saved";
  render();
  document.querySelector(`#story-step-${stepIndex + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function saveStorySteps(storySteps: CaptureStoryStep[]): Promise<void> {
  if (!session.captureAnalysis) return;
  session = {
    ...session,
    status: "planned",
    analysisError: undefined,
    captureAnalysis: withStorySteps(session.captureAnalysis, storySteps)
  };
  await saveSession(session);
  await saveCaptureHistory(session);
  hydrated = await hydrateSession(session);
  planDirty = false;
}

function withStorySteps(analysis: CaptureAnalysis, storySteps: CaptureStoryStep[]): CaptureAnalysis {
  return {
    ...analysis,
    storySteps,
    helpfulImageMoments: storySteps.filter((step) => step.screenshotId).map((step) => ({
      screenshotId: step.screenshotId,
      atSeconds: step.endSeconds,
      reason: step.narrative || step.title
    }))
  };
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
  return sendRuntimeMessage(message);
}

function formatMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatTimeRange(startSeconds: number, endSeconds: number): string {
  const start = formatMs(startSeconds * 1000);
  const end = formatMs(endSeconds * 1000);
  return start === end ? start : `${start}-${end}`;
}

function renderImageChoice(candidate: ScreenshotCandidate, step: CaptureStoryStep, stepIndex: number, topSuggestionId?: string): string {
  const selected = candidate.shot.id === step.screenshotId;
  const recommended = candidate.shot.id === topSuggestionId;
  return `<button class="image-choice ${selected ? "selected" : ""}" data-image-step="${stepIndex}" data-image-id="${escapeHtml(candidate.shot.id)}" role="radio" aria-checked="${selected}" aria-label="Choose image ${candidate.index + 1}, captured ${screenshotTimingLabel(candidate.shot, step)}">
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
  if (step.kind === "manual") return "Added step";
  if (step.kind === "action") return "Action";
  return "Narrated step";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
