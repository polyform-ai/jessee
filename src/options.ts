import "./ui.css";
import {
  chooseExportFolder,
  deleteOldCaptureFolders,
  exportFolderName,
  hasExportFolder,
  restoreExportFolder,
  supportsExportFolderSelection
} from "./localFiles";
import { clearApiKey, getSession, getSettings, pruneCaptureHistory, saveSession, saveSettings } from "./storage";
import { postWebhook } from "./webhook";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;
let profileDraft: { email: string; apiKey: string } | undefined;

void render();

async function render(message = ""): Promise<void> {
  await restoreExportFolder();
  const settings = await getSettings();
  const microphones = await getMicrophones();
  const email = profileDraft?.email ?? settings.email ?? "";
  const apiKeyValue = profileDraft?.apiKey ?? (settings.openAiKey ? "••••••••••••••••" : "");
  const canChooseFolder = supportsExportFolderSelection();
  root.innerHTML = `
    <main class="page">
      <div class="stack">
        <section class="header header-panel">
          <div class="title-row">
            <img class="brand-mark" src="/icon.svg" alt="" />
            <div>
              <p class="kicker">Settings</p>
              <h1>JesSee</h1>
              <p class="hint">Help AI see what you see.</p>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>OpenAI</h2>
              <p>Used to transcribe the narration and create the visual story plan.</p>
            </div>
          </div>
          <div class="field">
            <label for="apiKey">OpenAI API key</label>
            <input id="apiKey" type="password" autocomplete="off" placeholder="sk-..." value="${escapeHtml(apiKeyValue)}" />
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(email)}" />
          </div>
          <div class="row">
            <button class="button primary" id="save">Save</button>
            <button class="button secondary" id="delete">Remove key</button>
          </div>
          <button class="button secondary" id="testAiSetup">Test AI setup</button>
          <p class="hint">Checks access to GPT-5.6 Sol and GPT-4o Transcribe Diarize before you record. JesSee never silently switches to an older model.</p>
          <div class="field">
            <label><input id="privateMode" type="checkbox" ${settings.privateMode ? "checked" : ""} /> Private Mode</label>
            <p class="hint">Keep screenshot pixels on this computer. JesSee sends narration, timestamps, timeline metadata, and screenshot IDs to create the plan, then attaches your selected local images to the PDF.</p>
          </div>
          <p class="hint">The key is stored only in this browser's local extension storage. Do not paste exposed or revoked keys.</p>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Microphone</h2>
              <p>Required before starting a capture.</p>
            </div>
          </div>
          <div class="meta">
            <span>Status</span>
            <strong>${settings.microphoneEnabledAt ? "Enabled" : "Not enabled"}</strong>
          </div>
          <div class="field">
            <label for="microphoneSelect">Microphone</label>
            <select id="microphoneSelect">
              <option value="">System default microphone</option>
              ${microphones.map((device) => `<option value="${escapeHtml(device.deviceId)}" ${device.deviceId === settings.selectedMicrophoneId ? "selected" : ""}>${escapeHtml(device.label || "Microphone")}</option>`).join("")}
            </select>
          </div>
          <button class="button primary" id="enableMicrophone">Enable Microphone</button>
          <p class="hint">Choose the microphone JesSee should record, then enable it here before starting a capture.</p>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Local Storage</h2>
              <p>${canChooseFolder ? "Choose where captures, screenshots, JSON, and PDFs are saved." : "Safari keeps captures in JesSee and downloads finished PDFs."}</p>
            </div>
          </div>
          <div class="meta">
            <span>${canChooseFolder ? "Output folder" : "Capture storage"}</span>
            <strong>${canChooseFolder ? (hasExportFolder() ? escapeHtml(exportFolderName() ?? "Selected") : "Not selected") : "JesSee local storage"}</strong>
          </div>
          <div class="field">
            <label for="retentionDays">Delete captures after</label>
            <input id="retentionDays" type="number" min="1" max="365" value="${settings.retentionDays ?? 30}" />
          </div>
          ${canChooseFolder ? `<button class="button primary" id="chooseFolder">${hasExportFolder() ? "Change Folder" : "Choose Folder"}</button>` : ""}
          <p class="hint">${canChooseFolder ? "Each capture is saved in a dated subfolder with screen media, audio, screenshots, the visual story plan, and PDF." : "Capture history and screenshots stay in Safari's extension storage. Your completed PDF downloads through Safari."}</p>
        </section>
        ${message ? `<p class="success">${escapeHtml(message)}</p>` : ""}
      </div>
    </main>
  `;
  document.querySelector("#save")?.addEventListener("click", async () => {
    const hadProfile = Boolean(settings.email && settings.openAiKey);
    const input = document.querySelector<HTMLInputElement>("#apiKey");
    const emailInput = document.querySelector<HTMLInputElement>("#email");
    const key = input?.value.trim();
    const email = emailInput?.value.trim() ?? "";
    const privateMode = document.querySelector<HTMLInputElement>("#privateMode")?.checked ?? false;
    if (!email || !email.includes("@")) {
      await render("Enter a valid email address.");
      return;
    }
    if (!key && !settings.openAiKey) {
      await render("Enter a new key before saving.");
      return;
    }
    await saveSettings({ email, openAiKey: key && !key.includes("•") ? key : settings.openAiKey, privateMode });
    profileDraft = undefined;
    const updated = await getSettings();
    if (!hadProfile && updated.email && updated.openAiKey) await postWebhook(updated, "new_user", { email: updated.email });
    await render("Saved.");
  });
  document.querySelector("#delete")?.addEventListener("click", async () => {
    await clearApiKey();
    await render("Deleted.");
  });
  document.querySelector("#testAiSetup")?.addEventListener("click", async () => {
    const input = document.querySelector<HTMLInputElement>("#apiKey");
    const draftKey = input?.value.trim();
    const candidateKey = draftKey && !draftKey.includes("•") ? draftKey : undefined;
    try {
      const response = await chrome.runtime.sendMessage({ type: "TEST_AI_SETUP", apiKey: candidateKey }) as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(response.error ?? "AI setup test failed.");
      if (candidateKey) await saveSettings({ openAiKey: candidateKey });
      await render("AI setup is ready: GPT-5.6 Sol and GPT-4o Transcribe Diarize are available.");
    } catch (error) {
      await render(error instanceof Error ? error.message : String(error));
    }
  });
  document.querySelector("#chooseFolder")?.addEventListener("click", async () => {
    try {
      preserveProfileDraft();
      await chooseExportFolder();
      await render("Folder selected.");
    } catch (error) {
      await render(error instanceof Error ? error.message : String(error));
    }
  });
  document.querySelector("#enableMicrophone")?.addEventListener("click", async () => {
    try {
      const selectedMicrophoneId = document.querySelector<HTMLSelectElement>("#microphoneSelect")?.value ?? "";
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints(selectedMicrophoneId) });
      for (const track of stream.getTracks()) track.stop();
      await saveSettings({ microphoneEnabledAt: Date.now(), selectedMicrophoneId });
      const session = await getSession();
      if (session.error) await saveSession({ ...session, error: undefined, status: session.status === "error" ? "idle" : session.status });
      await render("Microphone enabled.");
    } catch (error) {
      await render(microphoneErrorMessage(error));
    }
  });
  document.querySelector("#microphoneSelect")?.addEventListener("change", async (event) => {
    await saveSettings({ selectedMicrophoneId: (event.target as HTMLSelectElement).value });
    await render("Microphone selection saved. Click Enable Microphone to verify it.");
  });
  document.querySelector("#retentionDays")?.addEventListener("change", async () => {
    const value = Number(document.querySelector<HTMLInputElement>("#retentionDays")?.value ?? 30);
    const retentionDays = Math.min(365, Math.max(1, Math.round(Number.isFinite(value) ? value : 30)));
    await saveSettings({ retentionDays });
    try {
      await Promise.all([deleteOldCaptureFolders(retentionDays, true), pruneCaptureHistory(retentionDays)]);
      await render("Retention saved.");
    } catch (error) {
      await render(error instanceof Error ? error.message : String(error));
    }
  });
}

async function getMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  } catch {
    return [];
  }
}

function microphoneConstraints(deviceId: string): MediaTrackConstraints {
  return deviceId ? { deviceId: { exact: deviceId } } : {};
}

function preserveProfileDraft(): void {
  profileDraft = {
    email: document.querySelector<HTMLInputElement>("#email")?.value.trim() ?? "",
    apiKey: document.querySelector<HTMLInputElement>("#apiKey")?.value.trim() ?? ""
  };
}

function microphoneErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/dismiss|abort|cancel/i.test(message)) return "Microphone permission was dismissed. Click Enable Microphone again and allow access in your browser.";
  if (/denied|notallowed|not allowed|permission/i.test(message)) return "Microphone access is blocked. Enable it for JesSee in your browser's microphone settings, then try again.";
  return `Could not enable microphone. ${message}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
