import "./ui.css";
import { hydrateSession } from "./artifacts";
import { buildCaptureStory, splitTranscriptIntoSentences } from "./captureStory";
import { saveCaptureHistory } from "./captureHistory";
import { downloadPlanPdf } from "./pdfDownload";
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
  const keyPoints = analysis.keyPoints?.length ? analysis.keyPoints : analysis.breakingPoints ?? [];

  root.innerHTML = `
    <main class="plan-page">
      <header class="plan-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Visual plan</p>
            <h1>${escapeHtml(session.tabTitle || analysis.userGoal || "JesSee capture")}</h1>
            <p class="hint">Review the user’s goal, exact words, page changes, and the screenshots that tell the story.</p>
          </div>
        </div>
        <div class="header-actions">
          <span class="save-status" id="saveStatus">${escapeHtml(statusMessage)}</span>
          <button class="button secondary compact" id="settings">Settings</button>
          <button class="button primary compact" id="generatePdf">Generate PDF</button>
        </div>
      </header>

      <div class="plan-layout">
        <section class="panel plan-copy">
          <div class="panel-header"><div><h2>What the user is communicating</h2><p>The goal and key points stay visible while you step through the story.</p></div></div>
          <div class="field"><label for="planGoal">Goal</label><textarea id="planGoal" rows="3">${escapeHtml(analysis.userGoal)}</textarea></div>
          <div class="field"><label for="planKeyPoints">Key points</label><textarea id="planKeyPoints" rows="6">${escapeHtml(keyPoints.join("\n"))}</textarea><p class="field-help">One important point per line.</p></div>
          <div class="field"><label for="planStory">Summary</label><textarea id="planStory" rows="5">${escapeHtml(analysis.story)}</textarea></div>
          <details class="transcript-panel" open>
            <summary><span>Transcript</span><strong>${transcriptSegments.length} timestamped sentence${transcriptSegments.length === 1 ? "" : "s"}</strong></summary>
            <div class="transcript-list">
              ${renderTranscript(transcriptSegments, storySteps)}
            </div>
          </details>
        </section>

        <section class="panel evidence-inspector story-inspector">
          <div class="panel-header">
            <div><h2>Story timeline</h2><p>${storySteps.length ? `Step ${activeStoryIndex + 1} of ${storySteps.length} · narration, actions, and page changes in order` : "No story steps available"}</p></div>
            <button class="button secondary compact" id="addStory">+ Add step</button>
          </div>
          ${storySteps.length && activeStep ? `
            <div class="story-stepper">
              <button class="button secondary" id="previousStory" ${activeStoryIndex === 0 ? "disabled" : ""}>← Previous step</button>
              <span>${formatTimeRange(activeStep.startSeconds, activeStep.endSeconds)}</span>
              <button class="button secondary" id="nextStory" ${activeStoryIndex === storySteps.length - 1 ? "disabled" : ""}>Next story step →</button>
            </div>
            <div class="moment-tabs" role="tablist" aria-label="Story steps">
              ${storySteps.map((item, index) => `<button class="moment-tab ${index === activeStoryIndex ? "active" : ""} ${item.kind === "page-change" ? "page-change" : ""}" data-story="${index}" role="tab" aria-label="Story step ${index + 1}: ${escapeHtml(item.title)}" aria-selected="${index === activeStoryIndex}">${item.kind === "page-change" ? "↗" : index + 1}</button>`).join("")}
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
            <div class="field">
              <label for="planShot">Screenshot illustrating this story step</label>
              <select id="planShot">
                <option value="">No screenshot</option>
                ${hydrated.screenshots.map((shot, index) => `<option value="${escapeHtml(shot.id)}" ${shot.id === activeStep.screenshotId ? "selected" : ""}>${String(index + 1).padStart(2, "0")} · ${formatMs(shot.capturedAtMs)} · ${escapeHtml(shot.title || shot.url || "Screenshot")}</option>`).join("")}
              </select>
            </div>
            <div class="image-stepper">
              <button class="button secondary" id="previousImage" ${selectedShotIndex <= 0 ? "disabled" : ""}>← Previous image</button>
              <span>${selectedShotIndex >= 0 ? `${selectedShotIndex + 1} of ${hydrated.screenshots.length}` : "No image"}</span>
              <button class="button secondary" id="nextImage" ${selectedShotIndex < 0 || selectedShotIndex >= hydrated.screenshots.length - 1 ? "disabled" : ""}>Next image →</button>
            </div>
            <div class="screenshot-stage">
              ${selectedShot ? `<img src="${selectedShot.dataUrl}" alt="Screenshot captured at ${formatMs(selectedShot.capturedAtMs)}" />` : `<div class="screenshot-empty">Choose a screenshot to preview it here.</div>`}
            </div>
            ${selectedShot ? `<div class="screenshot-meta"><strong>${formatMs(selectedShot.capturedAtMs)}</strong><span>${escapeHtml(selectedShot.title || selectedShot.url)}</span></div>` : ""}
          ` : `<div class="screenshot-empty">This capture does not have a timestamped transcript or story yet. Return to the recorder and create a plan to build the walkthrough.</div>`}
        </section>
      </div>
    </main>`;

  bindAutosave("#planGoal");
  bindAutosave("#planKeyPoints");
  bindAutosave("#planStory");
  bindAutosave("#planStepTitle");
  bindAutosave("#planNarrative");
  document.querySelector("#planShot")?.addEventListener("change", async () => {
    await persistPlan();
    await refreshHydratedSession();
  });
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".moment-tab")) {
    tab.addEventListener("click", async () => {
      await persistPlan();
      activeStoryIndex = Number(tab.dataset.story ?? 0);
      render();
    });
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
  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#generatePdf")?.addEventListener("click", () => void generatePdf());
}

function bindAutosave(selector: string): void {
  document.querySelector(selector)?.addEventListener("input", scheduleSave);
}

function scheduleSave(): void {
  statusMessage = "Saving…";
  updateSaveStatus();
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persistPlan(), 450);
}

async function persistPlan(): Promise<void> {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!session.captureAnalysis) return;
  const nextAnalysis = collectAnalysis(session.captureAnalysis);
  session = {
    ...session,
    captureAnalysis: nextAnalysis,
    status: "planned",
    analysisError: undefined
  };
  await saveSession(session);
  await saveCaptureHistory(session);
  statusMessage = "Saved automatically";
  updateSaveStatus();
}

function collectAnalysis(current: CaptureAnalysis): CaptureAnalysis {
  const storySteps = buildCaptureStory(current, session.transcript, session.timeline, hydrated.screenshots)
    .map((step, index) => index === activeStoryIndex ? {
      ...step,
      title: document.querySelector<HTMLInputElement>("#planStepTitle")?.value.trim() ?? step.title,
      narrative: document.querySelector<HTMLTextAreaElement>("#planNarrative")?.value.trim() ?? step.narrative,
      screenshotId: document.querySelector<HTMLSelectElement>("#planShot")?.value || undefined
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
  render();
}

async function stepStory(direction: -1 | 1): Promise<void> {
  await persistPlan();
  const storySteps = buildCaptureStory(session.captureAnalysis!, session.transcript, session.timeline, hydrated.screenshots);
  activeStoryIndex = Math.max(0, Math.min(storySteps.length - 1, activeStoryIndex + direction));
  render();
}

async function stepImage(direction: -1 | 1): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>("#planShot");
  if (!select) return;
  const currentIndex = hydrated.screenshots.findIndex((shot) => shot.id === select.value);
  const next = hydrated.screenshots[currentIndex + direction];
  if (!next) return;
  select.value = next.id;
  await persistPlan();
  await refreshHydratedSession();
}

async function refreshHydratedSession(): Promise<void> {
  hydrated = await hydrateSession(session);
  render();
}

async function generatePdf(): Promise<void> {
  await persistPlan();
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
