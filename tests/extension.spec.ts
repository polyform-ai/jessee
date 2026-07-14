import { test, expect, chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("loads extension settings page", async () => {
  execFileSync("npm", ["run", "build"], { cwd: resolve(__dirname, ".."), stdio: "inherit" });
  const extensionPath = resolve(__dirname, "../dist");
  const userDataDir = mkdtempSync(resolve(tmpdir(), "jessee-extension-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
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

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole("button", { name: "Open Settings" })).toBeVisible();

    await page.evaluate(async () => {
      const screenshot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
      await chrome.storage.local.set({
        recordingSession: {
          status: "planned",
          startedAt: Date.now() - 10_000,
          stoppedAt: Date.now(),
          timeline: [{ id: "page-change", type: "url-change", atMs: 2_000, url: "https://example.test/two", title: "Second state" }],
          transcript: {
            text: "Open the first state. Move to the second page.",
            segments: [
              { start: 0.5, end: 1, text: "Open the first state." },
              { start: 1.2, end: 2, text: "Move to the second page." }
            ]
          },
          screenshots: [
            { id: "shot-1", capturedAtMs: 1_000, url: "https://example.test/one", title: "First state", dataUrl: screenshot, annotations: [], redactions: [] },
            { id: "shot-2", capturedAtMs: 2_000, url: "https://example.test/two", title: "Second state", dataUrl: screenshot, annotations: [], redactions: [] }
          ],
          captureAnalysis: {
            userGoal: "Show a visual workflow",
            bestDelivery: "A concise guide",
            story: "Move from the first state to the second.",
            breakingPoints: [],
            keyPoints: ["The workflow starts on the first page", "The user then changes pages"],
            helpfulImageMoments: [
              { screenshotId: "shot-1", atSeconds: 1, reason: "Shows the first state" },
              { screenshotId: "shot-2", atSeconds: 2, reason: "Shows the second state" }
            ],
            storySteps: [
              { startSeconds: 0.5, endSeconds: 1, title: "Open the first state", narrative: "The walkthrough begins on the first page.", transcript: "Open the first state.", screenshotId: "shot-1", pageUrl: "https://example.test/one", pageTitle: "First state", kind: "narration" },
              { startSeconds: 2, endSeconds: 2, title: "Opened Second state", narrative: "The walkthrough moves to the second page.", transcript: "Move to the second page.", screenshotId: "shot-2", pageUrl: "https://example.test/two", pageTitle: "Second state", kind: "page-change" }
            ]
          }
        }
      });
    });
    await page.goto(`chrome-extension://${extensionId}/plan.html`);
    await expect(page.getByRole("heading", { name: "Story timeline" })).toBeVisible();
    await expect(page.getByRole("blockquote")).toHaveText("Open the first state.");
    await expect(page.getByRole("img", { name: "Screenshot captured at 1s" })).toBeVisible();
    await page.getByRole("button", { name: "Next story step" }).click();
    await expect(page.getByText("Page changed to", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Screenshot captured at 2s" })).toBeVisible();
    await page.getByRole("button", { name: "Add step" }).click();
    await expect(page.getByText("Added step", { exact: true })).toBeVisible();
    await page.getByLabel("What this part of the story communicates").fill("Add the final confirmation to the story.");
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.captureAnalysis?.storySteps?.find((step: { kind?: string }) => step.kind === "manual")?.narrative;
    })).toBe("Add the final confirmation to the story.");
    await expect(page.getByText("Saved automatically", { exact: true })).toBeVisible();
    await page.getByLabel("Goal").fill("Show the updated visual workflow");
    await expect.poll(() => page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      return stored.recordingSession?.captureAnalysis?.userGoal;
    })).toBe("Show the updated visual workflow");
    await page.evaluate(async () => {
      const stored = await chrome.storage.local.get("recordingSession");
      await chrome.storage.local.set({ recordingSession: { ...stored.recordingSession, status: "ready" } });
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
    await page.getByLabel("Summary").fill("A revised story must be regenerated.");
    await expect(page.getByRole("button", { name: "Generate PDF" })).toBeVisible();

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

    await expect.poll(() => capturePage.evaluate(() => (window as unknown as { shortcutEvents: string[] }).shortcutEvents)).toEqual([]);

    await capturePage.keyboard.press("c");
    await expect(capturePage.locator(".str-box")).toHaveCount(0);
    await expect(capturePage.getByText("Annotations cleared")).toBeVisible();
  } finally {
    await context.close();
  }
});
