import "./ui.css";
import { hydrateSession } from "./artifacts";
import { saveCaptureHistory } from "./captureHistory";
import { downloadTicketPdf } from "./pdfDownload";
import { getSession, getSettings, saveSession } from "./storage";
import { getSelectedTemplate, templateSignature } from "./templates";
import type { CaptureAnalysis, RecordingSession, RuntimeMessage } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;

let session: RecordingSession;
let hydrated: RecordingSession;
let activeMomentIndex = 0;
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

  const moments = analysis.helpfulImageMoments;
  activeMomentIndex = Math.min(activeMomentIndex, Math.max(0, moments.length - 1));
  const moment = moments[activeMomentIndex];
  const selectedShot = hydrated.screenshots.find((shot) => shot.id === moment?.screenshotId);
  const selectedShotIndex = selectedShot ? hydrated.screenshots.findIndex((shot) => shot.id === selectedShot.id) : -1;

  root.innerHTML = `
    <main class="plan-page">
      <header class="plan-header">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div>
            <p class="kicker">Visual plan</p>
            <h1>${escapeHtml(session.tabTitle || analysis.userGoal || "JesSee capture")}</h1>
            <p class="hint">Edit the plan and inspect exactly which screenshots the PDF will use.</p>
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
          <div class="panel-header"><div><h2>Document plan</h2><p>Changes are saved automatically.</p></div></div>
          <div class="field"><label for="planGoal">Goal</label><textarea id="planGoal" rows="3">${escapeHtml(analysis.userGoal)}</textarea></div>
          <div class="field"><label for="planDelivery">Best delivery</label><textarea id="planDelivery" rows="3">${escapeHtml(analysis.bestDelivery)}</textarea></div>
          <div class="field"><label for="planStory">Story</label><textarea id="planStory" rows="5">${escapeHtml(analysis.story)}</textarea></div>
          <div class="field"><label for="planBreakingPoints">Breaking points</label><textarea id="planBreakingPoints" rows="5">${escapeHtml(analysis.breakingPoints.join("\n"))}</textarea></div>
        </section>

        <section class="panel evidence-inspector">
          <div class="panel-header">
            <div><h2>Screenshot evidence</h2><p>${moments.length ? `Planned image ${activeMomentIndex + 1} of ${moments.length}` : "No screenshots selected by the plan"}</p></div>
          </div>
          ${moments.length ? `
            <div class="moment-tabs" role="tablist" aria-label="Planned images">
              ${moments.map((item, index) => `<button class="moment-tab ${index === activeMomentIndex ? "active" : ""}" data-moment="${index}" role="tab" aria-selected="${index === activeMomentIndex}">${index + 1}</button>`).join("")}
            </div>
            <div class="field">
              <label for="planShot">Screenshot used for this part of the plan</label>
              <select id="planShot">
                <option value="">No screenshot</option>
                ${hydrated.screenshots.map((shot, index) => `<option value="${escapeHtml(shot.id)}" ${shot.id === moment.screenshotId ? "selected" : ""}>${String(index + 1).padStart(2, "0")} · ${formatMs(shot.capturedAtMs)} · ${escapeHtml(shot.title || shot.url || "Screenshot")}</option>`).join("")}
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
            <div class="field"><label for="planReason">Why this image belongs in the document</label><textarea id="planReason" rows="3">${escapeHtml(moment.reason)}</textarea></div>
          ` : `<div class="screenshot-empty">The AI did not select screenshot evidence for this plan. Return to the recorder and create a new capture if visual evidence is required.</div>`}
        </section>
      </div>
    </main>`;

  bindAutosave("#planGoal");
  bindAutosave("#planDelivery");
  bindAutosave("#planStory");
  bindAutosave("#planBreakingPoints");
  bindAutosave("#planReason");
  document.querySelector("#planShot")?.addEventListener("change", async () => {
    await persistPlan();
    await refreshHydratedSession();
  });
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".moment-tab")) {
    tab.addEventListener("click", async () => {
      await persistPlan();
      activeMomentIndex = Number(tab.dataset.moment ?? 0);
      render();
    });
  }
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
  const template = getSelectedTemplate(await getSettings());
  session = {
    ...session,
    captureAnalysis: nextAnalysis,
    captureAnalysisTemplateSignature: templateSignature(template),
    status: "planned",
    ticket: undefined,
    analysisError: undefined
  };
  await saveSession(session);
  await saveCaptureHistory(session, template.name);
  statusMessage = "Saved automatically";
  updateSaveStatus();
}

function collectAnalysis(current: CaptureAnalysis): CaptureAnalysis {
  const moments = current.helpfulImageMoments.map((moment, index) => index === activeMomentIndex ? {
    ...moment,
    screenshotId: document.querySelector<HTMLSelectElement>("#planShot")?.value || undefined,
    reason: document.querySelector<HTMLTextAreaElement>("#planReason")?.value.trim() ?? moment.reason
  } : moment);
  return {
    userGoal: document.querySelector<HTMLTextAreaElement>("#planGoal")?.value.trim() ?? current.userGoal,
    bestDelivery: document.querySelector<HTMLTextAreaElement>("#planDelivery")?.value.trim() ?? current.bestDelivery,
    story: document.querySelector<HTMLTextAreaElement>("#planStory")?.value.trim() ?? current.story,
    breakingPoints: (document.querySelector<HTMLTextAreaElement>("#planBreakingPoints")?.value ?? "").split("\n").map((item) => item.trim()).filter(Boolean),
    helpfulImageMoments: moments
  };
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
    const response = await send({ type: "GENERATE_TICKET" });
    if (!response.ok) throw new Error(response.error ?? "PDF generation failed.");
    session = await getSession();
    await downloadTicketPdf(session);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
