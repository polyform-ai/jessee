import "./hud.css";
import { formatRecordingElapsed, recordingHudShortcutMarkup } from "./recordingHud";
import type { RuntimeMessage } from "./types";

const root = document.querySelector<HTMLDivElement>("#hud");
if (!root) throw new Error("Missing #hud");

const startedAt = Number(new URLSearchParams(window.location.search).get("startedAt")) || Date.now();
let pinnedOpen = false;
let pointerInside = false;

root.innerHTML = `
  <aside class="recording-hud" aria-label="JesSee recording controls">
    <button class="recording-hud-summary" type="button" aria-expanded="false" aria-controls="recording-hud-panel">
      <span class="recording-dot" aria-hidden="true"></span>
      <span class="recording-label">Recording</span>
      <time class="recording-time">${formatRecordingElapsed(startedAt)}</time>
      <span class="recording-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="recording-hud-panel" id="recording-hud-panel">
      <strong>Keep the story clear</strong>
      <p>Hover here anytime. Your walkthrough keeps recording while you use these controls.</p>
      <div class="recording-guide" aria-label="Walkthrough guidance">
        <span>1 · Frame it</span><span>2 · Show it</span><span>3 · Land it</span>
      </div>
      <div class="recording-shortcuts" aria-label="Annotation shortcuts">${recordingHudShortcutMarkup()}</div>
      <button class="finish-recording" type="button">Finish recording</button>
    </div>
  </aside>`;

const hud = root.querySelector<HTMLElement>(".recording-hud");
const summary = root.querySelector<HTMLButtonElement>(".recording-hud-summary");
const finish = root.querySelector<HTMLButtonElement>(".finish-recording");
const timer = root.querySelector<HTMLTimeElement>(".recording-time");

if (!hud || !summary || !finish || !timer) throw new Error("Recording HUD did not render.");

hud.addEventListener("mouseenter", () => {
  pointerInside = true;
  setExpanded(true);
});
hud.addEventListener("mouseleave", () => {
  pointerInside = false;
  if (!pinnedOpen && !hud.contains(document.activeElement)) setExpanded(false);
});
hud.addEventListener("focusin", () => setExpanded(true));
hud.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!pinnedOpen && !pointerInside && !hud.contains(document.activeElement)) setExpanded(false);
  });
});

summary.addEventListener("click", () => {
  pinnedOpen = !pinnedOpen;
  setExpanded(pinnedOpen || pointerInside);
});

finish.addEventListener("click", async () => {
  finish.disabled = true;
  finish.textContent = "Finishing…";
  try {
    await chrome.runtime.sendMessage({ type: "CONTENT_STOP_CAPTURE" } satisfies RuntimeMessage);
  } catch (error) {
    finish.disabled = false;
    finish.textContent = "Try finishing again";
    finish.title = error instanceof Error ? error.message : String(error);
  }
});

for (const eventName of ["wheel", "touchmove", "contextmenu"]) {
  document.addEventListener(eventName, (event) => event.preventDefault(), { capture: true, passive: false });
}

document.addEventListener("pointermove", (event) => postToCapturePage({ type: "pointer", x: event.clientX, y: event.clientY }), true);
document.addEventListener("pointerdown", () => postToCapturePage({ type: "pointer-down" }), true);
document.addEventListener("pointerup", () => postToCapturePage({ type: "pointer-up" }), true);
document.addEventListener("pointercancel", () => postToCapturePage({ type: "pointer-up" }), true);

window.setInterval(() => {
  timer.textContent = formatRecordingElapsed(startedAt);
}, 1_000);
reportHeight();

function setExpanded(expanded: boolean): void {
  hud!.classList.toggle("is-expanded", expanded);
  summary!.setAttribute("aria-expanded", String(expanded));
  reportHeight();
}

function reportHeight(): void {
  window.requestAnimationFrame(() => {
    postToCapturePage({ type: "resize", height: Math.ceil(document.documentElement.scrollHeight) });
  });
}

function postToCapturePage(message: Record<string, unknown>): void {
  window.parent.postMessage({ source: "jessee-recording-hud", ...message }, "*");
}
