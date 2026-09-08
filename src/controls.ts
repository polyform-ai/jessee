import "./ui.css";
import { sendRuntimeMessage } from "./runtimeMessaging";
import { getSession, getSettings } from "./storage";

const app = document.querySelector<HTMLDivElement>("#controls");
if (!app) throw new Error("Missing #controls");
const root = app;
let actionError = "";

void refresh();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.recordingSession || changes.settings)) void refresh();
});

async function refresh(): Promise<void> {
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  const ready = Boolean(settings.email && settings.openAiKey && settings.microphoneEnabledAt);
  const recording = session.status === "recording" || session.status === "paused";
  const processing = session.status === "planning" || session.status === "generating";

  root.innerHTML = `
    <main class="app control-popover">
      <div class="header header-panel">
        <div class="title-row">
          <img class="brand-mark" src="/icon.svg" alt="" />
          <div><p class="kicker">JesSee</p><h1>${recording ? "Recording your walkthrough" : processing ? "Creating your plan" : "Capture what matters"}</h1></div>
        </div>
        <button class="icon-button" id="settings" aria-label="Open Settings" title="Settings">⚙</button>
      </div>
      <section class="panel control-panel">
        ${actionError ? `<p class="error" role="alert">${escapeHtml(actionError)}</p>` : ""}
        ${recording ? `
          <div class="recording-state"><span class="coach-status-dot" aria-hidden="true"></span><strong>Recording</strong></div>
          <p>The JesSee recorder is running behind your page.</p>
          <div class="shortcut-grid" aria-label="Screen annotation shortcuts">
            <div class="shortcut"><kbd>B</kbd><span>Hold + drag to outline</span></div>
            <div class="shortcut"><kbd>R</kbd><span>Hold + drag to redact</span></div>
            <div class="shortcut shortcut-wide"><kbd>C</kbd><span>Clear annotations</span></div>
          </div>
          <button class="button danger" id="stop">Finish Recording</button>
        ` : processing ? `
          <p>JesSee is transcribing the narration and matching it to the strongest visual evidence.</p>
        ` : ready ? `
          <p>Open the recorder, choose what to share, and JesSee will return you to the page before recording begins.</p>
          <button class="button primary" id="start">Start Recording</button>
        ` : `
          <p>Add your key and enable your microphone before the first recording.</p>
          <button class="button primary" id="setup">Finish Setup</button>
        `}
      </section>
    </main>
  `;

  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#setup")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#start")?.addEventListener("click", () => void openRecorder());
  document.querySelector("#stop")?.addEventListener("click", () => void stopRecording());
}

async function openRecorder(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "OPEN_RECORDER" });
    if (!response.ok) throw new Error(response.error ?? "Could not open the JesSee recorder.");
    window.close();
  } catch (error) {
    actionError = error instanceof Error ? error.message : String(error);
    await refresh();
  }
}

async function stopRecording(): Promise<void> {
  try {
    const response = await sendRuntimeMessage({ type: "STOP_CAPTURE" });
    if (!response.ok) throw new Error(response.error ?? "Could not stop the JesSee recording.");
    window.close();
  } catch (error) {
    actionError = error instanceof Error ? error.message : String(error);
    await refresh();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character] ?? character);
}
