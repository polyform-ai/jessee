import { afterEach, describe, expect, it, vi } from "vitest";
import { sendRuntimeMessage } from "../src/runtimeMessaging";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendRuntimeMessage", () => {
  it("uses the callback response when Safari returns no Promise", async () => {
    const session = { status: "idle", timeline: [], screenshots: [] } as const;
    const sendMessage = vi.fn((_message, callback) => {
      callback({ ok: true, session });
      return undefined;
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });

    await expect(sendRuntimeMessage({ type: "GET_SESSION" })).resolves.toEqual({ ok: true, session });
  });

  it("returns a useful failure when the background sends no response", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn((_message, callback) => callback(undefined)),
        lastError: undefined
      }
    });

    await expect(sendRuntimeMessage({ type: "GET_SESSION" })).resolves.toEqual(expect.objectContaining({
      ok: false,
      error: expect.stringContaining("background process")
    }));
  });

  it("rejects Safari runtime errors instead of reading an undefined response", async () => {
    const runtime: { lastError?: { message: string }; sendMessage?: ReturnType<typeof vi.fn> } = {};
    runtime.sendMessage = vi.fn((_message, callback) => {
      runtime.lastError = { message: "The background process was unavailable." };
      callback(undefined);
      delete runtime.lastError;
    });
    vi.stubGlobal("chrome", { runtime });

    await expect(sendRuntimeMessage({ type: "GET_SESSION" })).rejects.toThrow("background process was unavailable");
  });
});
