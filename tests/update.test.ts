import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForJesseeUpdate, compareBrowserVersions } from "../src/update";

describe("JesSee updates", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getManifest: () => ({ version: "0.1.0.3", version_name: "0.1.0 alpha 3" })
      }
    });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/140 Safari/537.36" });
  });

  it("compares four-part browser versions numerically", () => {
    expect(compareBrowserVersions("0.1.0.10", "0.1.0.9")).toBe(1);
    expect(compareBrowserVersions("0.1.0.3", "0.1.0.3")).toBe(0);
    expect(compareBrowserVersions("0.1.0.2", "0.1.0.3")).toBe(-1);
  });

  it("reports an available release on the current browser channel", async () => {
    const state = await checkForJesseeUpdate(vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      version: "0.1.0-alpha.4",
      browserVersion: "0.1.0.4",
      publishedAt: "2026-09-13T00:00:00.000Z",
      notes: "Walkthrough library and update readiness.",
      chrome: { channel: "chrome-web-store", automaticUpdates: true, installUrl: "https://chromewebstore.google.com/detail/jessee/example" },
      safari: { channel: "developer-preview", automaticUpdates: false, installUrl: "https://jessee.ai/#download" }
    }), { status: 200 })) as typeof fetch);

    expect(state).toMatchObject({
      status: "available",
      installedVersion: "0.1.0.3",
      installedVersionName: "0.1.0 alpha 3",
      channel: { channel: "chrome-web-store", automaticUpdates: true }
    });
  });

  it("uses the Safari release channel in Safari", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Version/18.6 Safari/605.1.15" });
    const state = await checkForJesseeUpdate(vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      version: "0.1.0-alpha.4",
      browserVersion: "0.1.0.4",
      publishedAt: "2026-09-13T00:00:00.000Z",
      notes: "Walkthrough library and update readiness.",
      chrome: { channel: "chrome-web-store", automaticUpdates: true, installUrl: "https://chromewebstore.google.com/detail/jessee/example" },
      safari: { channel: "sparkle", automaticUpdates: true, installUrl: "https://jessee.ai/downloads/safari" }
    }), { status: 200 })) as typeof fetch);

    expect(state).toMatchObject({
      status: "available",
      channel: { channel: "sparkle", automaticUpdates: true }
    });
  });

  it("fails closed when release metadata is incomplete", async () => {
    const state = await checkForJesseeUpdate(vi.fn(async () => new Response(JSON.stringify({ version: "0.1.0-alpha.4" }), { status: 200 })) as typeof fetch);
    expect(state).toMatchObject({ status: "error", message: "Update service returned incomplete release metadata." });
  });

  it("rejects an untrusted install URL", async () => {
    const state = await checkForJesseeUpdate(vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: 1,
      version: "0.1.0-alpha.4",
      browserVersion: "0.1.0.4",
      publishedAt: "2026-09-13T00:00:00.000Z",
      notes: "Walkthrough library and update readiness.",
      chrome: { channel: "developer-preview", automaticUpdates: false, installUrl: "javascript:alert(1)" },
      safari: { channel: "developer-preview", automaticUpdates: false, installUrl: "https://jessee.ai/#download" }
    }), { status: 200 })) as typeof fetch);

    expect(state).toMatchObject({ status: "error", message: "Update service returned incomplete browser channel metadata." });
  });
});
