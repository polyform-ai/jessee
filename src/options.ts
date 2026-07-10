import "./ui.css";
import { chooseExportFolder, deleteOldCaptureFolders, exportFolderName, hasExportFolder, restoreExportFolder } from "./localFiles";
import { clearApiKey, getSettings, pruneCaptureHistory, saveSettings } from "./storage";
import { createCustomTemplate, hasTemplateOverride, isBuiltInTemplateId, getTemplates } from "./templates";
import { postWebhook } from "./webhook";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
const root = app;
type TemplateMode = "view" | "edit" | "create";
let templateMode: TemplateMode = "view";
let profileDraft: { email: string; apiKey: string } | undefined;

void render();

async function render(message = ""): Promise<void> {
  await restoreExportFolder();
  const settings = await getSettings();
  const templates = getTemplates(settings);
  const selectedTemplateId = settings.selectedTemplateId ?? "debug-ticket";
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const selectedIsBuiltIn = selectedTemplate ? isBuiltInTemplateId(selectedTemplate.id) : false;
  const selectedHasOverride = selectedTemplate ? hasTemplateOverride(settings, selectedTemplate.id) : false;
  const customTemplates = settings.customTemplates ?? [];
  const canDeleteSelected = selectedTemplate && !isBuiltInTemplateId(selectedTemplate.id);
  const email = profileDraft?.email ?? settings.email ?? "";
  const apiKeyValue = profileDraft?.apiKey ?? (settings.openAiKey ? "••••••••••••••••" : "");
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
              <p>Used only when creating the PDF.</p>
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
          <p class="hint">The key is stored only in chrome.storage.local. Do not paste exposed or revoked keys.</p>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Templates</h2>
              <p>Choose, review, edit, or create the document structure JesSee uses.</p>
            </div>
          </div>
          <div class="field">
            <label for="templateSelect">Ticket template</label>
            <select id="templateSelect">
              ${templates.map((template) => `<option value="${escapeHtml(template.id)}" ${template.id === selectedTemplateId ? "selected" : ""}>${escapeHtml(template.name)}</option>`).join("")}
            </select>
          </div>
          ${templateMode === "view" ? `
            <div class="meta-grid">
              <div class="meta"><span>Mode</span><strong>Read only</strong></div>
              <div class="meta"><span>Type</span><strong>${selectedIsBuiltIn ? "Default" : "Custom"}</strong></div>
              <div class="meta"><span>Status</span><strong>${selectedHasOverride ? "Edited" : "Original"}</strong></div>
            </div>
            <div>
              <p class="kicker">Instructions</p>
              <div class="read-only-box">${escapeHtml(selectedTemplate?.instructions ?? "")}</div>
            </div>
            <div class="row">
              <button class="button primary" id="editTemplate">Edit</button>
              <button class="button secondary" id="newTemplate">New Template</button>
              ${selectedHasOverride ? `<button class="button secondary" id="resetTemplate">Reset</button>` : ""}
              ${canDeleteSelected ? `<button class="button secondary" id="deleteSelectedTemplate">Delete</button>` : ""}
            </div>
          ` : ""}
          ${templateMode === "edit" ? `
            <div class="field">
              <label for="templateName">Template name</label>
              <input id="templateName" type="text" autocomplete="off" value="${escapeHtml(selectedTemplate?.name ?? "")}" />
            </div>
            <div class="field">
              <label for="templateInstructions">Template instructions</label>
              <textarea id="templateInstructions" rows="9">${escapeHtml(selectedTemplate?.instructions ?? "")}</textarea>
            </div>
            <div class="row">
              <button class="button primary" id="saveTemplate">Save</button>
              <button class="button secondary" id="cancelTemplateMode">Cancel</button>
            </div>
            <p class="hint">${selectedIsBuiltIn ? "Saving edits creates a local override of the JesSee default." : "Changes are saved only on this computer."}</p>
          ` : ""}
          ${templateMode === "create" ? `
            <div class="field">
              <label for="templateName">Template name</label>
              <input id="templateName" type="text" autocomplete="off" placeholder="Release Notes" />
            </div>
            <div class="field">
              <label for="templateInstructions">Template instructions</label>
              <textarea id="templateInstructions" rows="9" placeholder="Tell JesSee how this PDF should be structured."></textarea>
            </div>
            <div class="row">
              <button class="button primary" id="createTemplate">Create</button>
              <button class="button secondary" id="cancelTemplateMode">Cancel</button>
            </div>
          ` : ""}
          ${customTemplates.length > 0 ? `
            <p class="hint">Saved local templates and edited defaults: ${customTemplates.length}</p>
          ` : ""}
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h2>Local Storage</h2>
              <p>Choose where captures, screenshots, JSON, and PDFs are saved.</p>
            </div>
          </div>
          <div class="meta">
            <span>Output folder</span>
            <strong>${hasExportFolder() ? escapeHtml(exportFolderName() ?? "Selected") : "Not selected"}</strong>
          </div>
          <div class="field">
            <label for="retentionDays">Delete captures after</label>
            <input id="retentionDays" type="number" min="1" max="365" value="${settings.retentionDays ?? 30}" />
          </div>
          <button class="button primary" id="chooseFolder">${hasExportFolder() ? "Change Folder" : "Choose Folder"}</button>
          <p class="hint">Each capture is saved in a dated subfolder with screen media, audio, screenshots, evidence JSON, ticket JSON, and PDF.</p>
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
    if (!email || !email.includes("@")) {
      await render("Enter a valid email address.");
      return;
    }
    if (!key && !settings.openAiKey) {
      await render("Enter a new key before saving.");
      return;
    }
    await saveSettings({ email, openAiKey: key && !key.includes("•") ? key : settings.openAiKey });
    profileDraft = undefined;
    const updated = await getSettings();
    if (!hadProfile && updated.email && updated.openAiKey) await postWebhook(updated, "new_user", { email: updated.email });
    await render("Saved.");
  });
  document.querySelector("#delete")?.addEventListener("click", async () => {
    await clearApiKey();
    await render("Deleted.");
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
  document.querySelector("#retentionDays")?.addEventListener("change", async () => {
    const value = Number(document.querySelector<HTMLInputElement>("#retentionDays")?.value ?? 30);
    const retentionDays = Math.min(365, Math.max(1, Math.round(Number.isFinite(value) ? value : 30)));
    await saveSettings({ retentionDays });
    try {
      await Promise.all([deleteOldCaptureFolders(retentionDays), pruneCaptureHistory(retentionDays)]);
      await render("Retention saved.");
    } catch (error) {
      await render(error instanceof Error ? error.message : String(error));
    }
  });
  document.querySelector("#templateSelect")?.addEventListener("change", async (event) => {
    const selected = event.target as HTMLSelectElement;
    templateMode = "view";
    await saveSettings({ selectedTemplateId: selected.value });
    await render("Template selected.");
  });
  document.querySelector("#editTemplate")?.addEventListener("click", async () => {
    templateMode = "edit";
    await render();
  });
  document.querySelector("#newTemplate")?.addEventListener("click", async () => {
    templateMode = "create";
    await render();
  });
  document.querySelector("#cancelTemplateMode")?.addEventListener("click", async () => {
    templateMode = "view";
    await render();
  });
  document.querySelector("#saveTemplate")?.addEventListener("click", async () => {
    const currentTemplateId = (document.querySelector<HTMLSelectElement>("#templateSelect")?.value ?? selectedTemplateId).trim();
    const currentTemplate = templates.find((template) => template.id === currentTemplateId);
    if (!currentTemplate) {
      await render("Choose a template first.");
      return;
    }
    const name = document.querySelector<HTMLInputElement>("#templateName")?.value.trim() ?? "";
    const instructions = document.querySelector<HTMLTextAreaElement>("#templateInstructions")?.value.trim() ?? "";
    if (!name || !instructions) {
      await render("Add a template name and instructions.");
      return;
    }
    const editedTemplate = {
      ...currentTemplate,
      name,
      instructions,
      builtIn: false
    };
    const customTemplates = settings.customTemplates ?? [];
    const nextTemplates = customTemplates.some((template) => template.id === editedTemplate.id)
      ? customTemplates.map((template) => (template.id === editedTemplate.id ? editedTemplate : template))
      : [...customTemplates, editedTemplate];
    await saveSettings({
      customTemplates: nextTemplates,
      selectedTemplateId: editedTemplate.id
    });
    templateMode = "view";
    await render(isBuiltInTemplateId(editedTemplate.id) ? "Template override saved." : "Template saved.");
  });
  document.querySelector("#resetTemplate")?.addEventListener("click", async () => {
    if (!selectedTemplate) return;
    const customTemplates = (settings.customTemplates ?? []).filter((template) => template.id !== selectedTemplate.id);
    await saveSettings({
      customTemplates,
      selectedTemplateId: selectedTemplate.id
    });
    templateMode = "view";
    await render("Template reset.");
  });
  document.querySelector("#createTemplate")?.addEventListener("click", async () => {
    const name = document.querySelector<HTMLInputElement>("#templateName")?.value.trim() ?? "";
    const instructions = document.querySelector<HTMLTextAreaElement>("#templateInstructions")?.value.trim() ?? "";
    if (!name || !instructions) {
      await render("Add a template name and instructions.");
      return;
    }
    const template = createCustomTemplate(name, instructions);
    await saveSettings({
      customTemplates: [...(settings.customTemplates ?? []), template],
      selectedTemplateId: template.id
    });
    templateMode = "view";
    await render("Template created.");
  });
  document.querySelector("#deleteSelectedTemplate")?.addEventListener("click", async () => {
    if (!selectedTemplate) return;
    const customTemplates = (settings.customTemplates ?? []).filter((template) => template.id !== selectedTemplate.id);
    await saveSettings({
      customTemplates,
      selectedTemplateId: "debug-ticket"
    });
    templateMode = "view";
    await render("Template deleted.");
  });
}

function preserveProfileDraft(): void {
  profileDraft = {
    email: document.querySelector<HTMLInputElement>("#email")?.value.trim() ?? "",
    apiKey: document.querySelector<HTMLInputElement>("#apiKey")?.value.trim() ?? ""
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}
