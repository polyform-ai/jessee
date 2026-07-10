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
  } finally {
    await context.close();
  }
});
