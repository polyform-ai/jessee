import "./ui.css";
import { hydrateSession } from "./artifacts";
import { buildCaptureStory } from "./captureStory";
import { saveCaptureHistory } from "./captureHistory";
import { getPlanPdfAction } from "./captureFlow";
import { downloadPlanPdf } from "./pdfDownload";
import { rankScreenshotsForStep, screenshotTimingLabel, type ScreenshotCandidate } from "./imagePicker";
import { sendRuntimeMessage } from "./runtimeMessaging";
import { RevisionedSaveQueue } from "./revisionedSaveQueue";
import { getSession } from "./storage";
import { StoryEditor, type StoryEditorAction } from "./storyEditor";
import type { CaptureAnalysis, CaptureStoryStep, RecordingSession, RuntimeMessage } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

type PlanMode = "read" | "edit";

const FILMSTRIP_WINDOW_SIZE = 9;

let session: RecordingSession;
let hydrated: RecordingSession;
let planMode: PlanMode = "edit";
let storyEditor: StoryEditor | undefined;
let saveTimer: number | undefined;
let statusMessage = "Saved automatically";
const planSaves = new RevisionedSaveQueue();
let imageDialogStepIndex: number | undefined;
let imageCandidateIndex = 0;
let showAllScreenshots = false;

void initialize();

window.addEventListener("pagehide", flushPendingPlan);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingPlan();
});

async function initialize(): Promise<void> {
  session = await getSession();
  hydrated = await hydrateSession(session);
  render();
}

function render(): void {
  storyEditor?.destroy();
  storyEditor = undefined;
  const analysis = session.captureAnalysis;
  if (!analysis) {
    root.innerHTML = `<main class="plan-page"><section class="empty-state"><h1>No story yet</h1><p>Create a story from the JesSee recorder, then return here to shape and download it.</p></section></main>`;
    return;
  }

  const storySteps = normalizedStorySteps(analysis);
  if (imageDialogStepIndex !== undefined && !storySteps[imageDialogStepIndex]) imageDialogStepIndex = undefined;
  const selectedVisualCount = storySteps.filter((step) => step.screenshotId).length;
  const pdfAction = getPlanPdfAction(session.status, planSaves.dirty);

  root.innerHTML = `
    <main class="plan-page story-workspace">
      <header class="plan-header story-workspace-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Visual story editor</p>
            <h1>${escapeHtml(session.tabTitle || analysis.userGoal || "JesSee capture")}</h1>
            <p class="hint">AI created the first draft · ${storySteps.length} step${storySteps.length === 1 ? "" : "s"} · ${selectedVisualCount} selected image${selectedVisualCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="header-actions plan-header-actions">
          <div class="segmented-control mode-switch" aria-label="Story mode">
            <button id="editMode" class="${planMode === "edit" ? "active" : ""}" aria-pressed="${planMode === "edit"}">Edit</button>
            <button id="readMode" class="${planMode === "read" ? "active" : ""}" aria-pressed="${planMode === "read"}">Preview</button>
          </div>
          <span class="save-status" id="saveStatus" role="status" aria-live="polite">${escapeHtml(statusMessage)}</span>
          <button class="button secondary compact" id="settings">Settings</button>
          <button class="button primary compact" id="generatePdf" ${pdfAction.disabled ? "disabled" : ""}>${pdfAction.label}</button>
        </div>
      </header>

      <section class="story-editor-shell ${planMode === "edit" ? "editing" : "reading"}" aria-labelledby="storyEditorHeading">
        <div class="story-editor-intro">
          <div>
            <p class="section-eyebrow">${planMode === "edit" ? "Edit the generated story" : "Final reader preview"}</p>
            <h2 id="storyEditorHeading">${planMode === "edit" ? "Make the document sound like you" : "Review what your audience will receive"}</h2>
          </div>
          <p>${planMode === "edit" ? "Shape paragraphs, lists, and callouts directly. Every step keeps its source URL and lets you choose whether readers see it." : "This same story, in this same order, becomes one continuous PDF."}</p>
        </div>
        ${planMode === "edit" ? renderEditorToolbar() : ""}
        <div class="story-paper" id="storyEditor"></div>
        ${planMode === "edit" ? `<div class="story-editor-footer"><button class="button secondary" id="addStory">+ Add another step</button><span>Changes save automatically</span></div>` : ""}
      </section>
      ${imageDialogStepIndex === undefined ? "" : renderImageDialog(storySteps[imageDialogStepIndex], imageDialogStepIndex)}
    </main>`;

  const editorElement = document.querySelector<HTMLElement>("#storyEditor");
  if (!editorElement) throw new Error("Missing story editor");
  storyEditor = new StoryEditor({
    element: editorElement,
    analysis,
    storySteps,
    screenshots: hydrated.screenshots,
    editable: planMode === "edit",
    onChange: scheduleSave,
    onSelectionChange: updateEditorToolbar,
    onImageClick: (stepIndex) => void openImageDialog(stepIndex)
  });

  bindEvents();
  updateEditorToolbar();
  const dialog = document.querySelector<HTMLDialogElement>("#imageDialog");
  if (dialog && !dialog.open) {
    dialog.showModal();
    dialog.focus();
  }
}

function renderEditorToolbar(): string {
  return `<div class="story-editor-toolbar" role="toolbar" aria-label="Story formatting">
    <div class="editor-format-group">
      <button type="button" class="editor-tool editor-tool-list" data-editor-action="paragraph" aria-label="Paragraph" aria-pressed="false">Text</button>
      <button type="button" class="editor-tool" data-editor-action="bold" aria-label="Bold" aria-pressed="false"><strong>B</strong></button>
      <button type="button" class="editor-tool" data-editor-action="italic" aria-label="Italic" aria-pressed="false"><em>I</em></button>
      <button type="button" class="editor-tool editor-tool-list" data-editor-action="bulletList" aria-label="Bullet list" aria-pressed="false">• Bullets</button>
      <button type="button" class="editor-tool editor-tool-list" data-editor-action="orderedList" aria-label="Numbered list" aria-pressed="false">1. List</button>
      <button type="button" class="editor-tool editor-tool-list" data-editor-action="callout" aria-label="Callout" aria-pressed="false">Callout</button>
    </div>
    <span class="editor-toolbar-divider"></span>
    <div class="editor-format-group">
      <button type="button" class="editor-tool" data-editor-action="undo" aria-label="Undo">↶</button>
      <button type="button" class="editor-tool" data-editor-action="redo" aria-label="Redo">↷</button>
    </div>
    <span class="editor-toolbar-tip">Click directly into the story to edit</span>
  </div>`;
}

function renderImageDialog(step: CaptureStoryStep, stepIndex: number): string {
  const candidates = imageCandidates(step);
  imageCandidateIndex = clamp(imageCandidateIndex, 0, Math.max(0, candidates.length - 1));
  const candidate = candidates[imageCandidateIndex];
  const selected = candidate?.shot.id === step.screenshotId;
  const topSuggestionId = rankScreenshotsForStep(step, hydrated.screenshots)[0]?.shot.id;
  const filmstripStart = clamp(
    imageCandidateIndex - Math.floor(FILMSTRIP_WINDOW_SIZE / 2),
    0,
    Math.max(0, candidates.length - FILMSTRIP_WINDOW_SIZE)
  );
  const filmstripCandidates = candidates
    .slice(filmstripStart, filmstripStart + FILMSTRIP_WINDOW_SIZE)
    .map((item, offset) => ({ item, index: filmstripStart + offset }));

  return `<dialog class="image-dialog image-carousel-dialog" id="imageDialog" aria-labelledby="imageDialogTitle">
    <div class="image-dialog-card image-carousel-card">
      <div class="image-dialog-header">
        <div><p class="section-eyebrow">Step ${stepIndex + 1} image</p><h2 id="imageDialogTitle">Step through the captured moments</h2><p>${escapeHtml(step.title)} · Move backward or forward, then use the image that explains this step best.</p></div>
        <button class="icon-button" id="closeImageDialog" aria-label="Close image choices">×</button>
      </div>
      <div class="image-dialog-toolbar">
        <div class="segmented-control" aria-label="Screenshot choices">
          <button id="suggestedImages" class="${showAllScreenshots ? "" : "active"}" aria-pressed="${!showAllScreenshots}">Best matches</button>
          <button id="allImages" class="${showAllScreenshots ? "active" : ""}" aria-pressed="${showAllScreenshots}">All images</button>
        </div>
        <span>${candidates.length ? `${imageCandidateIndex + 1} of ${candidates.length}` : "No images captured"}</span>
      </div>
      ${candidate ? `<div class="image-carousel-stage">
        <button class="image-carousel-arrow previous" id="previousCandidate" aria-label="Previous captured image" ${imageCandidateIndex === 0 ? "disabled" : ""}>←</button>
        <figure class="image-carousel-figure">
          <img src="${candidate.shot.dataUrl}" alt="Captured image ${candidate.index + 1}: ${escapeHtml(candidate.shot.title || candidate.shot.url || "Captured screen")}" />
          <figcaption>
            <div><strong>${escapeHtml(candidate.shot.title || candidate.shot.url || `Captured image ${candidate.index + 1}`)}</strong><small>${escapeHtml(candidate.reason)} · ${formatMs(candidate.shot.capturedAtMs)}</small></div>
            ${candidate.shot.id === topSuggestionId ? `<span class="recommended-pill">Best match</span>` : ""}
          </figcaption>
        </figure>
        <button class="image-carousel-arrow next" id="nextCandidate" aria-label="Next captured image" ${imageCandidateIndex === candidates.length - 1 ? "disabled" : ""}>→</button>
      </div>
      <div class="image-carousel-actions">
        <button class="button secondary" id="useTextOnly">Use text only</button>
        <button class="button primary" id="useCandidate" ${selected ? "disabled" : ""}>${selected ? "Currently selected" : "Use this image"}</button>
      </div>
      <div class="image-filmstrip" role="listbox" aria-label="Captured image thumbnails">
        ${filmstripCandidates.map(({ item, index }) => `<button class="image-filmstrip-item ${index === imageCandidateIndex ? "active" : ""} ${item.shot.id === step.screenshotId ? "selected" : ""}" data-candidate-index="${index}" role="option" aria-selected="${index === imageCandidateIndex}" aria-posinset="${index + 1}" aria-setsize="${candidates.length}" aria-label="View image ${item.index + 1}, ${escapeHtml(item.reason)}"><img src="${item.shot.dataUrl}" alt="" loading="lazy" /><span>${String(item.index + 1).padStart(2, "0")}</span></button>`).join("")}
      </div>` : `<div class="image-carousel-empty"><strong>No captured images are available</strong><p>This step will remain text only.</p></div>`}
    </div>
  </dialog>`;
}

function bindEvents(): void {
  document.querySelector("#readMode")?.addEventListener("click", () => void switchMode("read"));
  document.querySelector("#editMode")?.addEventListener("click", () => void switchMode("edit"));
  document.querySelector("#addStory")?.addEventListener("click", () => void addStoryStep());
  document.querySelector("#settings")?.addEventListener("click", async () => {
    await persistPlan();
    chrome.runtime.openOptionsPage();
  });
  document.querySelector("#generatePdf")?.addEventListener("click", () => void generatePdf());
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-editor-action]")) {
    button.addEventListener("click", () => storyEditor?.run(button.dataset.editorAction as StoryEditorAction));
  }

  document.querySelector("#closeImageDialog")?.addEventListener("click", closeImageDialog);
  const dialog = document.querySelector<HTMLDialogElement>("#imageDialog");
  dialog?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeImageDialog();
  });
  dialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageDialog();
  });
  dialog?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") moveCandidate(-1);
    if (event.key === "ArrowRight") moveCandidate(1);
  });
  document.querySelector("#suggestedImages")?.addEventListener("click", () => setImageCollection(false));
  document.querySelector("#allImages")?.addEventListener("click", () => setImageCollection(true));
  document.querySelector("#previousCandidate")?.addEventListener("click", () => moveCandidate(-1));
  document.querySelector("#nextCandidate")?.addEventListener("click", () => moveCandidate(1));
  document.querySelector("#useCandidate")?.addEventListener("click", () => void useCurrentCandidate());
  document.querySelector("#useTextOnly")?.addEventListener("click", () => void selectImage(""));
  for (const thumbnail of document.querySelectorAll<HTMLButtonElement>("[data-candidate-index]")) {
    thumbnail.addEventListener("click", () => {
      imageCandidateIndex = Number(thumbnail.dataset.candidateIndex ?? 0);
      render();
    });
  }
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
  const step = currentDialogStep();
  const candidates = step ? imageCandidates(step) : [];
  const selectedIndex = candidates.findIndex((candidate) => candidate.shot.id === step?.screenshotId);
  imageCandidateIndex = selectedIndex >= 0 ? selectedIndex : 0;
  render();
}

function closeImageDialog(): void {
  document.querySelector<HTMLDialogElement>("#imageDialog")?.close();
  const stepIndex = imageDialogStepIndex;
  imageDialogStepIndex = undefined;
  render();
  if (stepIndex !== undefined) storyEditor?.scrollToStep(stepIndex);
}

function setImageCollection(showAll: boolean): void {
  const step = currentDialogStep();
  const currentId = step ? imageCandidates(step)[imageCandidateIndex]?.shot.id : undefined;
  showAllScreenshots = showAll;
  const nextCandidates = step ? imageCandidates(step) : [];
  const matchingIndex = nextCandidates.findIndex((candidate) => candidate.shot.id === currentId);
  imageCandidateIndex = matchingIndex >= 0 ? matchingIndex : 0;
  render();
}

function moveCandidate(offset: number): void {
  const step = currentDialogStep();
  if (!step) return;
  imageCandidateIndex = clamp(imageCandidateIndex + offset, 0, Math.max(0, imageCandidates(step).length - 1));
  render();
}

async function useCurrentCandidate(): Promise<void> {
  const step = currentDialogStep();
  if (!step) return;
  const candidate = imageCandidates(step)[imageCandidateIndex];
  if (candidate) await selectImage(candidate.shot.id);
}

async function selectImage(imageId: string): Promise<void> {
  if (imageDialogStepIndex === undefined || !session.captureAnalysis || !storyEditor) return;
  const stepIndex = imageDialogStepIndex;
  const screenshot = hydrated.screenshots.find((shot) => shot.id === imageId);
  storyEditor.updateImage(stepIndex, screenshot);
  planSaves.markChanged();
  await persistPlan();
  imageDialogStepIndex = undefined;
  statusMessage = imageId ? "Image selected and saved" : "Text-only step saved";
  render();
  storyEditor?.scrollToStep(stepIndex);
}

function imageCandidates(step: CaptureStoryStep): ScreenshotCandidate[] {
  if (!showAllScreenshots) return rankScreenshotsForStep(step, hydrated.screenshots);
  return hydrated.screenshots.map((shot, index) => ({ shot, index, score: 0, reason: screenshotTimingLabel(shot, step) }));
}

function currentDialogStep(): CaptureStoryStep | undefined {
  if (imageDialogStepIndex === undefined || !session.captureAnalysis) return undefined;
  return normalizedStorySteps(session.captureAnalysis)[imageDialogStepIndex];
}

function scheduleSave(): void {
  planSaves.markChanged();
  statusMessage = "Saving…";
  updateSaveStatus();
  updatePdfAction();
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persistPlan().catch(showSaveError), 450);
}

async function persistPlan(): Promise<void> {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!session.captureAnalysis || !planSaves.dirty || !storyEditor) return;
  await planSaves.flush(async () => {
    if (!session.captureAnalysis || !storyEditor) return;
    const next = { ...session, captureAnalysis: storyEditor.value(session.captureAnalysis), status: "planned" as const, analysisError: undefined };
    const response = await send({ type: "SAVE_CAPTURE_STORY", session: next });
    if (!response.ok) throw new Error(response.error ?? "Story save failed.");
    session = response.session ?? next;
  });
  statusMessage = "Saved automatically";
  updateSaveStatus();
  updatePdfAction();
}

function flushPendingPlan(): void {
  if (planSaves.dirty) void persistPlan().catch(showSaveError);
}

function showSaveError(error: unknown): void {
  statusMessage = `Could not save yet. ${error instanceof Error ? error.message : String(error)}`;
  updateSaveStatus();
}

async function addStoryStep(): Promise<void> {
  if (!session.captureAnalysis || !storyEditor) return;
  const storySteps = normalizedStorySteps(storyEditor.value(session.captureAnalysis));
  const previous = storySteps.at(-1);
  const timestamp = previous?.endSeconds ?? session.transcript?.segments.at(-1)?.end ?? 0;
  storyEditor.appendStep({
    startSeconds: timestamp,
    endSeconds: timestamp,
    title: "New step",
    narrative: "Add the next part of the explanation.",
    transcript: "",
    pageUrl: previous?.pageUrl || session.tabUrl,
    pageTitle: previous?.pageTitle || session.tabTitle,
    showPageUrl: true,
    kind: "manual"
  }, hydrated.screenshots);
  planSaves.markChanged();
  await persistPlan();
  render();
  storyEditor?.scrollToStep(storySteps.length);
}

function normalizedStorySteps(analysis: CaptureAnalysis): CaptureStoryStep[] {
  const storySteps = buildCaptureStory(analysis, session.transcript, session.timeline, hydrated.screenshots);
  return storySteps.length ? storySteps : [{ startSeconds: 0, endSeconds: 0, title: "First step", narrative: "Add the first part of the explanation.", transcript: "", kind: "manual" }];
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

function updateEditorToolbar(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-editor-action]")) {
    const action = button.dataset.editorAction as StoryEditorAction;
    button.disabled = !(storyEditor?.canRun(action) ?? false);
    if (action !== "undo" && action !== "redo") button.setAttribute("aria-pressed", String(storyEditor?.isActive(action) ?? false));
  }
}

function updateSaveStatus(): void {
  const element = document.querySelector<HTMLElement>("#saveStatus");
  if (element) element.textContent = statusMessage;
}

function updatePdfAction(): void {
  const element = document.querySelector<HTMLButtonElement>("#generatePdf");
  if (!element) return;
  const action = getPlanPdfAction(session.status, planSaves.dirty);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
