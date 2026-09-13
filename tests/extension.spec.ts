import { test, expect, chromium, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function replaceEditorText(locator: Locator, value: string): Promise<void> {
  await locator.click();
  await locator.evaluate((element, replacement) => {
    (element as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, replacement);
  }, value);
}

test("loads extension settings page", async () => {
  execFileSync("npm", ["run", "build"], { cwd: resolve(__dirname, ".."), stdio: "inherit" });
  const extensionPath = process.env.JESSEE_EXTENSION_PATH
    ? resolve(process.env.JESSEE_EXTENSION_PATH)
    : resolve(__dirname, "../dist");
  const userDataDir = mkdtempSync(resolve(tmpdir(), "jessee-extension-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    deviceScaleFactor: 2,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  try {
    let [serviceWorker] = context.serviceWorkers();
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.getByRole("heading", { name: "JesSee" })).toBeVisible();
    await expect(page.getByLabel("OpenAI API key")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test AI setup" })).toBeVisible();
    await page.getByRole("button", { name: "Test AI setup" }).click();
    const openAiPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "OpenAI" }) });
    await expect(openAiPanel.locator("#aiTestResult")).toBeVisible();
    await expect(openAiPanel.locator("#aiTestResult")).toContainText("OpenAI API key");

    if (process.env.JESSEE_VISUAL_QA) {
      const coachPage = await context.newPage();
      await coachPage.addInitScript(() => {
        Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
      });
      await coachPage.goto(`chrome-extension://${extensionId}/popup.html`);
      await coachPage.evaluate(async () => {
        await chrome.storage.local.set({
          settings: { email: "demo@example.test", openAiKey: "demo-key", microphoneEnabledAt: Date.now(), retentionDays: 30 }
        });
      });
      await coachPage.reload();
      await expect(coachPage.getByRole("heading", { name: "Ready to capture" })).toBeVisible();
      await coachPage.locator("main.app").screenshot({ path: resolve(__dirname, "../website/assets/capture-coach.png") });
      await coachPage.close();
    }

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();

    const controlsPage = await context.newPage();
    await controlsPage.goto(`chrome-extension://${extensionId}/controls.html`);
    await controlsPage.evaluate(async () => {
      await chrome.storage.local.set({
        settings: { email: "demo@example.test", openAiKey: "demo-key", microphoneEnabledAt: Date.now(), retentionDays: 30 },
        recordingSession: { status: "recording", startedAt: Date.now(), timeline: [], screenshots: [] }
      });
    });
    await controlsPage.reload();
    await expect(controlsPage.getByRole("heading", { name: "Recording your walkthrough" })).toBeVisible();
    await expect(controlsPage.getByText("Hold + drag to outline")).toBeVisible();
    await expect(controlsPage.getByRole("button", { name: "Open Library" })).toBeVisible();
    const activeHistoryPage = await context.newPage();
    await activeHistoryPage.goto(`chrome-extension://${extensionId}/history.html`);
    await expect(activeHistoryPage.getByRole("button", { name: "Capture in progress" })).toBeDisabled();
    await expect(activeHistoryPage.getByText("A capture is still recording or being prepared.", { exact: false })).toBeVisible();
    await activeHistoryPage.getByRole("button", { name: "Back to capture" }).click();
    await expect(activeHistoryPage).toHaveURL(`chrome-extension://${extensionId}/history.html`);
    await expect.poll(() => activeHistoryPage.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.status;
    })).toBe("recording");
    await activeHistoryPage.close();
    await controlsPage.getByRole("button", { name: "Finish Recording" }).click();
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.status;
    })).toBe("error");

    const fallbackScreenshot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
    const overviewScreenshot = process.env.JESSEE_VISUAL_QA
      ? `data:image/png;base64,${readFileSync(resolve(__dirname, "../website/assets/site-overview.png")).toString("base64")}`
      : fallbackScreenshot;
    const problemScreenshot = process.env.JESSEE_VISUAL_QA
      ? `data:image/png;base64,${readFileSync(resolve(__dirname, "../website/assets/site-problem.png")).toString("base64")}`
      : fallbackScreenshot;
    await page.evaluate(async ({ overviewScreenshot, problemScreenshot, fallbackScreenshot }) => {
      const additionalScreenshots = Array.from({ length: 24 }, (_, index) => ({
        id: `shot-${index + 3}`,
        capturedAtMs: 8_000 + index * 500,
        url: "https://jessee.ai/#problem",
        title: `Captured follow-up ${index + 1}`,
        dataUrl: fallbackScreenshot,
        annotations: [],
        redactions: []
      }));
      await chrome.storage.local.set({
        recordingSession: {
          status: "planned",
          startedAt: Date.now() - 10_000,
          stoppedAt: Date.now(),
          timeline: [{ id: "page-change", type: "url-change", atMs: 6_000, url: "https://jessee.ai/#problem", title: "JesSee - The communication gap" }],
          transcript: {
            text: "Start with the problem: text, screenshots, and video all lose a different part of the explanation. Then show how JesSee turns the walkthrough into a visual playbook.",
            segments: [
              { start: 0.5, end: 4, text: "Start with the problem: text, screenshots, and video all lose a different part of the explanation." },
              { start: 4.2, end: 7, text: "Then show how JesSee turns the walkthrough into a visual playbook." }
            ]
          },
          screenshots: [
            { id: "shot-1", capturedAtMs: 4_000, url: "https://jessee.ai/", title: "JesSee - Help AI see what you see", dataUrl: overviewScreenshot, annotations: [], redactions: [] },
            { id: "shot-2", capturedAtMs: 7_000, url: "https://jessee.ai/#problem", title: "JesSee - The communication gap", dataUrl: problemScreenshot, annotations: [], redactions: [] },
            ...additionalScreenshots
          ],
          captureAnalysis: {
            userGoal: "Explain why JesSee turns walkthroughs into visual playbooks",
            bestDelivery: "A concise visual explainer",
            story: "Show the communication gap, then explain the transformation from walkthrough to useful context.",
            breakingPoints: [],
            keyPoints: ["Text and screenshots arrive as disconnected clues", "Video contains more data than the useful moments require", "JesSee keeps narration and visual evidence together"],
            helpfulImageMoments: [
              { screenshotId: "shot-1", atSeconds: 4, reason: "Shows the product promise and transformation" },
              { screenshotId: "shot-2", atSeconds: 7, reason: "Shows the three disconnected input problems" }
            ],
            storySteps: [
              { startSeconds: 0.5, endSeconds: 4, title: "Frame the communication problem", narrative: "Text, screenshots, and video each lose a different part of the explanation.", transcript: "Start with the problem: text, screenshots, and video all lose a different part of the explanation.", screenshotId: "shot-1", pageUrl: "https://jessee.ai/", pageTitle: "JesSee - Help AI see what you see", kind: "narration" },
              { startSeconds: 6, endSeconds: 7, title: "Show what gets lost", narrative: "The problem becomes concrete before JesSee introduces the solution.", transcript: "Then show how JesSee turns the walkthrough into a visual playbook.", screenshotId: "shot-2", pageUrl: "https://jessee.ai/#problem", pageTitle: "JesSee - The communication gap", kind: "page-change" }
            ]
          }
        }
      });
    }, { overviewScreenshot, problemScreenshot, fallbackScreenshot });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`chrome-extension://${extensionId}/plan.html`);
    await expect(page.getByRole("heading", { name: "Make the document sound like you" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("toolbar", { name: "Story formatting" })).toBeVisible();
    await expect(page.locator("[data-story-step]" )).toHaveCount(2);
    await expect(page.getByRole("img", { name: /Selected visual for step 1/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Selected visual for step 2/ })).toBeVisible();
    await expect(page.getByText("What the user said", { exact: false })).toHaveCount(0);
    const firstStepBody = page.locator("[data-story-step]").first();
    await firstStepBody.locator("p").first().click();
    await page.getByRole("button", { name: "Bullet list" }).click();
    await expect(firstStepBody.locator("ul")).toBeVisible();
    await expect(firstStepBody.locator("ul")).toHaveCSS("list-style-type", "disc");
    const nestedListStyle = await page.evaluate(() => {
      const editor = document.createElement("div");
      editor.className = "story-editor-content";
      const step = document.createElement("section");
      step.dataset.storyStep = "";
      const outerList = document.createElement("ul");
      const item = document.createElement("li");
      const nestedList = document.createElement("ul");
      item.append(nestedList);
      outerList.append(item);
      step.append(outerList);
      editor.append(step);
      document.body.append(editor);
      const style = getComputedStyle(nestedList);
      const result = { listStyleType: style.listStyleType, paddingLeft: Number.parseFloat(style.paddingLeft) };
      editor.remove();
      return result;
    });
    expect(nestedListStyle.listStyleType).toBe("circle");
    expect(nestedListStyle.paddingLeft).toBeGreaterThan(0);
    const nestedOverviewListStyle = await page.evaluate(() => {
      const editor = document.createElement("div");
      editor.className = "story-editor-content";
      const overview = document.createElement("section");
      overview.dataset.storyOverview = "";
      const outerList = document.createElement("ul");
      const item = document.createElement("li");
      const nestedList = document.createElement("ul");
      item.append(nestedList);
      outerList.append(item);
      overview.append(outerList);
      editor.append(overview);
      document.body.append(editor);
      const style = getComputedStyle(nestedList);
      const result = { listStyleType: style.listStyleType, paddingLeft: Number.parseFloat(style.paddingLeft) };
      editor.remove();
      return result;
    });
    expect(nestedOverviewListStyle.listStyleType).toBe("circle");
    expect(nestedOverviewListStyle.paddingLeft).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(firstStepBody.locator("ul")).toHaveCount(0);
    if (process.env.JESSEE_VISUAL_QA) {
      await page.screenshot({ path: resolve(__dirname, "../website/assets/playbook-review.png") });
    }
    await page.getByRole("button", { name: "Change image for step 1" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Step through the captured moments" })).toBeVisible();
    if (process.env.JESSEE_VISUAL_QA) {
      await page.screenshot({ path: resolve(__dirname, "../test-results/image-picker-modal.png") });
    }
    await page.getByRole("button", { name: "All images" }).click();
    await expect(page.getByText("1 of 26", { exact: true })).toBeVisible();
    await expect(page.locator("[data-candidate-index]")).toHaveCount(9);
    await page.getByRole("button", { name: "Next captured image" }).click();
    await expect(page.getByText("2 of 26", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use this image" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("img", { name: /Selected visual for step 1: JesSee - The communication gap/ })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.captureAnalysis?.storySteps?.[0]?.screenshotId;
    })).toBe("shot-2");
    if (process.env.JESSEE_VISUAL_QA) {
      await page.screenshot({ path: resolve(__dirname, "../test-results/playbook-edit.png") });
    }
    await page.getByRole("button", { name: "Add another step" }).click();
    await expect(page.locator("[data-story-step]")).toHaveCount(3);
    const newStepNarrative = page.locator("[data-story-step]").nth(2).locator("p").first();
    await replaceEditorText(newStepNarrative, "Add the final confirmation to the story.");
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.captureAnalysis?.storySteps?.find((step: { kind?: string }) => step.kind === "manual")?.narrative;
    })).toBe("Add the final confirmation to the story.");
    await expect(page.getByText("Saved automatically", { exact: true })).toBeVisible();
    await replaceEditorText(page.locator("[data-story-title]"), "Show the updated visual workflow");
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.captureAnalysis?.userGoal;
    })).toBe("Show the updated visual workflow");

    if (process.env.JESSEE_VISUAL_QA) {
      await page.evaluate(async () => {
        const stored = await chrome.storage.local.get("settings");
        const original = stored.settings.captureHistory[0];
        const examples = [
          { id: "show-updated-workflow", title: "Show the updated visual workflow", offset: 0, hasPdf: false },
          { id: "explain-safari-install", title: "Explain the Safari installation flow", offset: 86_400_000, hasPdf: true },
          { id: "report-image-picker", title: "Report the image picker bug", offset: 172_800_000, hasPdf: true }
        ].map((example) => ({
          ...original,
          id: example.id,
          title: example.title,
          createdAt: original.createdAt - example.offset,
          hasPdf: example.hasPdf,
          session: {
            ...original.session,
            captureId: example.id,
            startedAt: original.session.startedAt - example.offset,
            stoppedAt: original.session.stoppedAt - example.offset,
            captureAnalysis: { ...original.session.captureAnalysis, userGoal: example.title }
          }
        }));
        await chrome.storage.local.set({ settings: { ...stored.settings, captureHistory: examples } });
      });
    }

    const historyPage = await context.newPage();
    await historyPage.setViewportSize({ width: 1440, height: 1000 });
    await historyPage.goto(`chrome-extension://${extensionId}/history.html`);
    await expect(historyPage.getByRole("heading", { name: "Your explanations stay useful." })).toBeVisible();
    await expect(historyPage.locator("[data-history-card]")).toHaveCount(process.env.JESSEE_VISUAL_QA ? 3 : 1);
    await expect(historyPage.locator("[data-history-thumbnail]:not([hidden])")).toHaveCount(process.env.JESSEE_VISUAL_QA ? 3 : 1);
    await expect(historyPage.getByRole("heading", { name: "Show the updated visual workflow" })).toBeVisible();
    await expect(historyPage.getByRole("button", { name: "Edit story" }).first()).toBeVisible();
    await expect(historyPage.getByRole("button", { name: "Download PDF" }).first()).toBeVisible();
    if (!process.env.JESSEE_VISUAL_QA) {
      await historyPage.evaluate(async () => {
        const stored = await chrome.storage.local.get("settings");
        const original = stored.settings.captureHistory[0];
        await chrome.storage.local.set({
          settings: {
            ...stored.settings,
            captureHistory: [{ ...original, title: "Freshly completed walkthrough" }]
          }
        });
      });
      await expect(historyPage.getByRole("heading", { name: "Freshly completed walkthrough" })).toBeVisible();
      await historyPage.evaluate(async () => {
        const stored = await chrome.storage.local.get("settings");
        const fresh = stored.settings.captureHistory[0];
        await chrome.storage.local.set({
          settings: {
            ...stored.settings,
            captureHistory: [{ ...fresh, title: "Show the updated visual workflow" }]
          }
        });
      });
      await expect(historyPage.getByRole("heading", { name: "Show the updated visual workflow" })).toBeVisible();
    }
    await historyPage.getByRole("searchbox", { name: "Search recordings" }).fill("no matching recording");
    await expect(historyPage.locator("[data-history-card]:not([hidden])")).toHaveCount(0);
    await historyPage.getByRole("searchbox", { name: "Search recordings" }).fill("updated visual");
    await expect(historyPage.locator("[data-history-card]:not([hidden])")).toHaveCount(1);
    if (process.env.JESSEE_VISUAL_QA) {
      await historyPage.getByRole("searchbox", { name: "Search recordings" }).fill("");
      await expect(historyPage.locator("[data-history-card]:not([hidden])")).toHaveCount(3);
      await historyPage.screenshot({ path: resolve(__dirname, "../website/assets/history-library.png"), fullPage: true });
    } else {
      await historyPage.getByRole("button", { name: "View recording" }).click();
      await expect(historyPage.getByRole("dialog")).toBeVisible();
      await expect(historyPage.getByText(/Start with the problem: text, screenshots, and video/)).toBeVisible();
      await historyPage.getByRole("button", { name: "Close recording preview" }).click();
      const historyDownload = historyPage.waitForEvent("download");
      await historyPage.getByRole("button", { name: "Download PDF" }).click();
      await historyDownload;
      await historyPage.getByRole("button", { name: "Edit story" }).click();
      await expect(historyPage).toHaveURL(`chrome-extension://${extensionId}/plan.html`);
      await expect(historyPage.getByRole("heading", { name: "Make the document sound like you" })).toBeVisible();
    }
    await historyPage.close();

    await page.evaluate(async (restoreShowcase) => {
      const stored = await chrome.storage.local.get("recordingSession");
      const recordingSession = stored.recordingSession;
      const captureAnalysis = restoreShowcase ? {
        ...recordingSession.captureAnalysis,
        userGoal: "Explain why JesSee turns walkthroughs into visual playbooks",
        storySteps: recordingSession.captureAnalysis.storySteps
          .filter((step: { kind?: string }) => step.kind !== "manual")
          .map((step: { title?: string; screenshotId?: string }) => step.title === "Frame the communication problem" ? { ...step, screenshotId: "shot-1" } : step)
      } : recordingSession.captureAnalysis;
      await chrome.storage.local.set({ recordingSession: { ...recordingSession, captureAnalysis, status: "ready" } });
    }, Boolean(process.env.JESSEE_VISUAL_QA));
    await page.reload();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
    if (process.env.JESSEE_VISUAL_QA) {
      const pdfDirectory = resolve(__dirname, "../output/pdf");
      mkdirSync(pdfDirectory, { recursive: true });
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download PDF" }).click();
      const download = await downloadPromise;
      await download.saveAs(resolve(pdfDirectory, "jessee-explains-jessee.pdf"));
    }
    await replaceEditorText(page.locator("[data-story-summary]"), "A revised story must be regenerated.");
    await expect(page.getByRole("button", { name: "Generate PDF" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Change image for step 1" })).toBeVisible();
    if (process.env.JESSEE_VISUAL_QA) {
      await page.screenshot({ path: resolve(__dirname, "../test-results/playbook-mobile.png") });
    }

    const capturePage = await context.newPage();
    await capturePage.route("https://jessee.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<main><h1>Keyboard annotation test</h1><p>Drag over this page.</p></main>
        <script>
          window.shortcutEvents = [];
          window.addEventListener("keydown", (event) => window.shortcutEvents.push("down:" + event.key.toLowerCase()));
          window.addEventListener("keyup", (event) => window.shortcutEvents.push("up:" + event.key.toLowerCase()));
        </script>`
    }));
    await capturePage.goto("https://jessee.test/demo");
    await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://jessee.test/*" });
      if (!tabs[0]?.id) throw new Error("Missing capture test tab");
      await chrome.tabs.sendMessage(tabs[0].id, { type: "SET_OVERLAY_MODE", mode: "cursor" });
    });
    await capturePage.mouse.move(180, 72);
    await expect(capturePage.locator(".str-cursor .str-pointer-shape")).toBeVisible();
    await expect(capturePage.locator("html")).toHaveClass(/str-recording-cursor-active/);
    if (process.env.JESSEE_VISUAL_QA) {
      await capturePage.screenshot({ path: resolve(__dirname, "../test-results/cursor.png") });
    }
    await capturePage.mouse.down();
    await expect(capturePage.locator(".str-cursor")).toHaveClass(/is-pressing/);
    if (process.env.JESSEE_VISUAL_QA) {
      await capturePage.screenshot({ path: resolve(__dirname, "../test-results/cursor-pressed.png") });
    }
    await capturePage.mouse.up();
    await expect(capturePage.locator(".str-cursor")).toHaveClass(/is-clicking/);
    await capturePage.evaluate(() => {
      (window as unknown as { shortcutEvents: string[] }).shortcutEvents = [];
    });
    await capturePage.keyboard.down("b");
    await capturePage.mouse.move(80, 80);
    await capturePage.mouse.down();
    await capturePage.mouse.move(260, 180);
    await capturePage.mouse.up();
    await capturePage.keyboard.up("b");
    await expect(capturePage.locator(".str-box.str-highlight")).toHaveCount(1);

    await capturePage.keyboard.down("r");
    await capturePage.mouse.move(300, 100);
    await capturePage.mouse.down();
    await capturePage.mouse.move(460, 200);
    await capturePage.mouse.up();
    await capturePage.keyboard.up("r");
    await expect(capturePage.locator(".str-box.str-redact")).toHaveCount(1);

    await capturePage.evaluate(() => {
      (window as unknown as { shortcutEvents: string[] }).shortcutEvents = [];
    });
    await expect.poll(() => capturePage.evaluate(() => (window as unknown as { shortcutEvents: string[] }).shortcutEvents)).toEqual([]);

    await capturePage.keyboard.press("c");
    await expect(capturePage.locator(".str-box")).toHaveCount(0);
    await expect(capturePage.locator(".str-shortcut-badge")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
